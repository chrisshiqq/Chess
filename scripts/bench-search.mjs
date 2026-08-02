import { Worker } from 'worker_threads';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const source = readFileSync(join(__dirname, '../src/chess-worker.js'), 'utf8');
const wrappedWorker = `
const { parentPort } = require('worker_threads');
const self = { onmessage: null, postMessage: (msg) => parentPort.postMessage(msg) };
const console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
parentPort.on('message', (data) => self.onmessage?.({ data }));
${source}
`;

function printCpuProfile(profileDir, priorFiles) {
  const files = readdirSync(profileDir).filter((name) => name.endsWith('.cpuprofile') && !priorFiles.has(name));
  const profiles = files.map((file) => JSON.parse(readFileSync(join(profileDir, file), 'utf8')));
  const workerProfiles = profiles.filter((profile) => profile.nodes.some((node) => node.callFrame?.url === '[worker eval]'));
  const selected = workerProfiles.length ? workerProfiles : profiles;
  const totals = new Map();
  for (const profile of selected) {
    const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
    for (let i = 0; i < profile.samples.length; i++) {
      const frame = frames.get(profile.samples[i]);
      if (!frame || frame.functionName === '(idle)') continue;
      const url = frame.url ? frame.url.split(/[\\/]/).pop() : '';
      const label = `${frame.functionName || '(anonymous)'} @${url}:${(frame.lineNumber || 0) + 1}`;
      totals.set(label, (totals.get(label) || 0) + (profile.timeDeltas[i] || 0));
    }
  }
  const entries = [...totals.entries()].filter(([name]) => name.includes('@[worker eval]:'));
  const display = entries.length ? entries : [...totals.entries()];
  const totalUs = display.reduce((sum, [, us]) => sum + us, 0);
  if (!totalUs) return;
  console.log(`\n=== CPU Profile (${selected.length} worker files, ${(totalUs / 1000).toFixed(0)}ms worker self samples) ===`);
  console.log('Self time is sampled CPU time; it excludes child function time.');
  for (const [name, us] of display.sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`${(us / 1000).toFixed(0).padStart(7)}ms ${(100 * us / totalUs).toFixed(1).padStart(5)}% ${name}`);
  }
}

function makeInitialBoard() {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const back = ['chariot', 'horse', 'elephant', 'advisor', 'general', 'advisor', 'elephant', 'horse', 'chariot'];
  for (let c = 0; c < 9; c++) {
    board[0][c] = { type: back[c], color: 'red' };
    board[9][c] = { type: back[c], color: 'black' };
  }
  board[2][1] = { type: 'cannon', color: 'red' };
  board[2][7] = { type: 'cannon', color: 'red' };
  board[7][1] = { type: 'cannon', color: 'black' };
  board[7][7] = { type: 'cannon', color: 'black' };
  for (let c = 0; c < 9; c += 2) {
    board[3][c] = { type: 'soldier', color: 'red' };
    board[6][c] = { type: 'soldier', color: 'black' };
  }
  return board;
}

function runSearch(depth, exactRootScores, profile) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(wrappedWorker, { eval: true });
    const started = Date.now();
    worker.on('message', (message) => {
      if (message.type === 'SEARCH_COMPLETE') {
        worker.terminate();
        resolve({ wallMs: Date.now() - started, payload: message.payload });
      }
    });
    worker.on('error', reject);
    worker.postMessage({
      type: 'SEARCH',
      payload: {
        board: makeInitialBoard(), turn: 'red', depth, randomness: 0, gameId: 1,
        openingBookEnabled: false, ply: 0, enableTimeLimit: false, exactRootScores, profile
      }
    });
  });
}

function formatMove(move) {
  return move?.from && move?.to ? `${JSON.stringify(move.from)}->${JSON.stringify(move.to)}` : 'null';
}

function printSummary(label, run) {
  const { payload, wallMs } = run;
  const perf = payload.perf || {};
  console.log(`wall=${wallMs}ms thinkingTime=${payload.thinkingTime}ms best=${formatMove(payload.bestMove)} score=${payload.bestMoveScore} allMoves=${payload.allMovesWithScores?.length ?? 0}`);
  console.log(`  alphaBeta=${perf.alphaBetaCalls} legalityChecks=${perf.legalityChecks} legalSearched=${perf.legalMovesSearched}`);
  console.log(`  Zobrist: fullHash=${perf.fullHashCount} incrUpdates=${perf.incrementalHashUpdates}`);
  console.log(`  numericLeaf: count=${perf.fastLeafEvalCount} ms=${Math.round(perf.fastLeafEvalMs ?? 0)} prepare=${Math.round(perf.prepareSearchInfoMs ?? 0)}ms`);
  console.log(`  TT hits=${perf.tt?.hits} misses=${perf.tt?.misses} hitRate=${perf.tt?.hitRate}% stores=${perf.tt?.stores} updates=${perf.tt?.updatedStores ?? 0} evicted=${perf.tt?.lruEvictions}/${perf.tt?.evictionBatches ?? 0} depth/fallback=${perf.tt?.depthPreferredEvictions ?? 0}/${perf.tt?.fallbackEvictions ?? 0} size=${perf.tt?.currentSize}/${perf.tt?.maxSize} batch=${perf.tt?.evictionBatch}`);
  if (perf.profile) {
    console.log(`  profile: sort=${Math.round(perf.sortMovesMs)}ms/${perf.sortMovesCount} legality=${Math.round(perf.legalityCheckMs)}ms captureGen=${Math.round(perf.captureGenMs)}ms/${perf.captureGenCount} QS=${perf.quiescenceCalls}`);
  }
  return { label, wallMs, thinkingTimeMs: payload.thinkingTime, bestMove: formatMove(payload.bestMove), score: payload.bestMoveScore, perf };
}

const depth = Number(process.argv[2]) || 8;
const mode = (process.argv[3] || 'play').toLowerCase();
const pathMode = (process.argv[4] || 'cpuperf').toLowerCase();

if (pathMode === 'cpuperf' && process.env.BENCH_CPU_PROF_CHILD !== '1') {
  const profileDir = join(__dirname, 'profiles');
  mkdirSync(profileDir, { recursive: true });
  const previous = new Set(readdirSync(profileDir).filter((name) => name.endsWith('.cpuprofile')));
  const child = spawnSync(process.execPath, ['--cpu-prof', '--cpu-prof-dir', profileDir, scriptPath, String(depth), mode, 'cpuperf-run'], {
    stdio: 'inherit', env: { ...process.env, BENCH_CPU_PROF_CHILD: '1' }
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
  printCpuProfile(profileDir, previous);
  process.exit(0);
}

const profile = pathMode === 'profile';
const jobs = [];
if (mode === 'play' || mode === 'both') jobs.push({ label: 'play', exact: false });
if (mode === 'analysis' || mode === 'both') jobs.push({ label: 'analysis', exact: true });
if (!jobs.length) throw new Error(`Unknown mode: ${mode}`);

const results = [];
for (const job of jobs) {
  console.log(`\n=== Bench depth=${depth} ${job.label} (opening book off) ===`);
  results.push(printSummary(job.label, await runSearch(depth, job.exact, profile)));
}
const outPath = join(__dirname, `bench-d${depth}-${profile ? 'profile' : 'latest'}.json`);
writeFileSync(outPath, JSON.stringify({ depth, mode, profile, results }, null, 2));
console.log(`\nSaved JSON: ${outPath}`);
