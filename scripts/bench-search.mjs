import { Worker } from 'worker_threads';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const workerPath = new URL('./bench-worker.mjs', import.meta.url);

function printCpuProfile(profileDir, priorFiles) {
  const files = readdirSync(profileDir).filter((name) => name.endsWith('.cpuprofile') && !priorFiles.has(name));
  const profiles = files.map((file) => JSON.parse(readFileSync(join(profileDir, file), 'utf8')));
  const workerProfiles = profiles.filter((profile) => profile.nodes.some((node) =>
    /[\\/]src[\\/]engine[\\/]js[\\/]/.test(node.callFrame?.url || '')
  ));
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
  const entries = [...totals.entries()].filter(([name]) => /@(search|movegen|board)\.js:/.test(name));
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

function runSearch(depth, exactRootScores, profile, metrics, lmrMinMove, nmpMinDepth, nmpReduction) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { type: 'module' });
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
        openingBookEnabled: false, ply: 0, enableTimeLimit: false, exactRootScores, profile, metrics, lmrMinMove, nmpMinDepth, nmpReduction
      }
    });
  });
}

function formatMove(move) {
  return move?.from && move?.to ? `${JSON.stringify(move.from)}->${JSON.stringify(move.to)}` : 'null';
}

function printDepthOrdering(byDepth) {
  if (!byDepth || typeof byDepth !== 'object') return;
  const depths = Object.keys(byDepth).sort((a, b) => Number(a) - Number(b));
  if (!depths.length) return;
  console.log('  moveOrdering by depth:');
  for (const d of depths) {
    const row = byDepth[d] || {};
    console.log(`    d=${d}`);
    console.log(`      firstLegalMoves=${row.firstLegalMoves ?? 0}`);
    console.log(`      firstLegalCutoffs=${row.firstLegalCutoffs ?? 0}`);
    console.log(`      firstLegalCutoffRate=${row.firstLegalCutoffRate ?? 0}%`);
    console.log(`      avgFirstLegalMoveIndex=${row.averageFirstLegalMoveIndex ?? 0}`);
  }
}

function printSummary(label, run) {
  const { payload, wallMs } = run;
  const perf = payload.perf || {};
  const tt = perf.tt || {};
  const top = perf.moveOrdering?.topMoveSources || {};
  const staged = perf.stagedGeneration;
  const ks = perf.kingSafety;
  const relations = perf.leafRelations;
  const lmr = perf.lmr;
  const pvs = perf.pvs;
  const nmp = perf.nmp;

  console.log(`wallMs=${wallMs}`);
  console.log(`thinkingTimeMs=${payload.thinkingTime}`);
  console.log(`best=${formatMove(payload.bestMove)}`);
  console.log(`score=${payload.bestMoveScore}`);
  console.log(`completedDepth=${payload.completedDepth ?? 0}`);
  console.log(`allMoves=${payload.allMovesWithScores?.length ?? 0}`);
  const scoredMoves = payload.allMovesWithScores || [];
  if (scoredMoves.length) {
    const withPv = scoredMoves.filter((item) => (item.moveSequence || []).length > 1).length;
    const topPv = (scoredMoves[0]?.moveSequence || []).map((move) => formatMove(move)).slice(0, 6);
    console.log(`rootPvMoves=${withPv}/${scoredMoves.length}`);
    console.log(`topPv=${topPv.join(' | ') || 'empty'}`);
  }
  console.log(`alphaBeta=${perf.alphaBetaCalls}`);
  console.log(`legalSearched=${perf.legalMovesSearched}`);
  console.log(`numericLeafCount=${perf.fastLeafEvalCount}`);
  if (perf.profile) {
    console.log(`numericLeafMs=${Math.round(perf.fastLeafEvalMs ?? 0)}`);
    console.log(`prepareSearchInfoMs=${Math.round(perf.prepareSearchInfoMs ?? 0)}`);
  }

  const evalCacheHits = perf.staticEvalCacheHits ?? 0;
  const evalCacheMisses = perf.staticEvalCacheMisses ?? 0;
  const evalCacheAccesses = evalCacheHits + evalCacheMisses;
  const evalCacheHitRate = evalCacheAccesses > 0
    ? (evalCacheHits / evalCacheAccesses * 100).toFixed(2)
    : '0.00';
  console.log('evalCache:');
  console.log(`  hits=${evalCacheHits}`);
  console.log(`  misses=${evalCacheMisses}`);
  console.log(`  hitRate=${evalCacheHitRate}%`);
  console.log(`  entries=${perf.evalCacheSize ?? 0}`);
  console.log(`  memoryMiB=${((perf.evalCacheBytes ?? 0) / 1048576).toFixed(2)}`);

  console.log('TT:');
  console.log(`  hits=${tt.hits}`);
  console.log(`  misses=${tt.misses}`);
  console.log(`  hitRate=${tt.hitRate}%`);
  console.log(`  stores=${tt.stores}`);
  console.log(`  updates=${tt.updatedStores ?? 0}`);
  console.log(`  lruEvictions=${tt.lruEvictions}`);
  console.log(`  depthPreferredEvictions=${tt.depthPreferredEvictions ?? 0}`);
  console.log(`  currentSize=${tt.currentSize}`);
  console.log(`  maxSize=${tt.maxSize}`);

  if (perf.moveOrdering) {
    console.log('ordering top:');
    console.log(`  tt=${top.tt ?? 0}`);
    console.log(`  killer=${top.killer ?? 0}`);
    console.log(`  capture=${top.capture ?? 0}`);
    console.log(`  quiet=${top.quiet ?? 0}`);
    printDepthOrdering(perf.moveOrdering.byDepth);
  }

  if (staged) {
    console.log('stagedGen:');
    console.log(`  nodes=${staged.nodes}`);
    console.log(`  stages=${JSON.stringify(staged.stages)}`);
    console.log(`  generated=${JSON.stringify(staged.generated)}`);
    console.log(`  quietSkipped=${staged.quietSkipped}`);
    console.log(`  quietSkipRate=${staged.quietSkipRate}%`);
  }

  if (ks) {
    console.log('kingSafety:');
    console.log(`  fullChecks=${ks.fullChecks}`);
    console.log(`  fastSkips=${ks.fastSkips}`);
    console.log(`  skipRate=${ks.skipRate}%`);
    console.log(`  fullReasons=${JSON.stringify(ks.fullReasons ?? {})}`);
    if (ks.isCheckFromStateCalls != null) {
      const scanned = ks.isCheckFromStateCalls;
      const skipped = ks.isCheckFromStateSkipped || 0;
      const wouldScan = scanned + skipped;
      console.log(`  isCheckFromState scanned=${scanned}`);
      console.log(`  isCheckFromState skipped=${skipped}`);
      console.log(`  isCheckFromState saved=${skipped}/${wouldScan} (${wouldScan ? ((skipped / wouldScan) * 100).toFixed(2) : 0}%)`);
    }
  }

  const checkFilter = perf.checkFilter;
  if (checkFilter) {
    console.log('checkFilter:');
    console.log(`  attempts=${checkFilter.attempts}`);
    console.log(`  rejects=${checkFilter.rejects}`);
    console.log(`  fallthrough=${checkFilter.fallthrough}`);
    console.log(`  rejectRate=${checkFilter.rejectRate}%`);
    console.log(`  fullTrue=${checkFilter.fullTrue}`);
    console.log(`  fullFalse=${checkFilter.fullFalse}`);
  }

  if (relations && perf.profile) {
    console.log('leafRelations:');
    console.log(`  relationMs=${Math.round(relations.relationMs ?? 0)}`);
    console.log(`  tacticalMs=${Math.round(relations.tacticalMs ?? 0)}`);
  }

  if (lmr) {
    console.log('lmr:');
    console.log(`  minDepth=${lmr.minDepth}`);
    console.log(`  minMove=${lmr.minMove}`);
    console.log(`  attempts=${lmr.attempts}`);
    console.log(`  reSearches=${lmr.reSearches}`);
    console.log(`  reSearchRate=${lmr.reSearchRate}%`);
  }

  if (pvs) {
    console.log('pvs:');
    console.log(`  attempts=${pvs.attempts}`);
    console.log(`  reSearches=${pvs.reSearches}`);
    console.log(`  reSearchRate=${pvs.reSearchRate}%`);
  }

  if (nmp) {
    console.log('nmp:');
    console.log(`  minDepth=${nmp.minDepth}`);
    console.log(`  reduction=${nmp.reduction}`);
    console.log(`  attempts=${nmp.attempts}`);
    console.log(`  cutoffs=${nmp.cutoffs}`);
    console.log(`  cutoffRate=${nmp.cutoffRate}%`);
  }

  const gc = payload.gc;
  if (gc) {
    const toMiB = (bytes) => (bytes / 1048576).toFixed(2);
    console.log('gc:');
    console.log(`  count=${gc.count}`);
    console.log(`  durationMs=${gc.durationMs.toFixed(2)}`);
    console.log(`  heapBeforeMiB=${toMiB(gc.heapBefore)}`);
    console.log(`  heapAfterMiB=${toMiB(gc.heapAfter)}`);
    console.log(`  deltaMiB=${toMiB(gc.heapAfter - gc.heapBefore)}`);
  }

  if (perf.profile) {
    console.log('profile:');
    console.log(`  sortMovesMs=${Math.round(perf.sortMovesMs)}`);
    console.log(`  sortMovesCount=${perf.sortMovesCount}`);
    console.log(`  legalityCheckMs=${Math.round(perf.legalityCheckMs)}`);
    console.log(`  captureGenMs=${Math.round(perf.captureGenMs)}`);
    console.log(`  captureGenCount=${perf.captureGenCount}`);
    console.log(`  quiescenceCalls=${perf.quiescenceCalls}`);
  }

  return {
    label,
    wallMs,
    thinkingTimeMs: payload.thinkingTime,
    bestMove: formatMove(payload.bestMove),
    score: payload.bestMoveScore,
    completedDepth: payload.completedDepth ?? 0,
    perf
  };
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
const metrics = process.env.BENCH_METRICS !== '0';
const lmrMinMove = Number(process.env.BENCH_LMR_MIN_MOVE ?? 5);
const nmpMinDepth = Number(process.env.BENCH_NMP_MIN_DEPTH ?? 3);
const nmpReduction = Number(process.env.BENCH_NMP_REDUCTION ?? 2);
const jobs = [];
if (mode === 'play' || mode === 'both') jobs.push({ label: 'play', exact: false });
if (mode === 'analysis' || mode === 'both') jobs.push({ label: 'analysis', exact: true });
if (!jobs.length) throw new Error(`Unknown mode: ${mode}`);

const results = [];
for (const job of jobs) {
  console.log(`\n=== Bench depth=${depth} ${job.label} (opening book off) ===`);
  results.push(printSummary(job.label, await runSearch(depth, job.exact, profile, metrics, lmrMinMove, nmpMinDepth, nmpReduction)));
}
const outPath = join(__dirname, `bench-d${depth}-${profile ? 'profile' : 'latest'}.json`);
writeFileSync(outPath, JSON.stringify({ depth, mode, profile, metrics, lmrMinMove, nmpMinDepth, nmpReduction, results }, null, 2));
console.log(`\nSaved JSON: ${outPath}`);
