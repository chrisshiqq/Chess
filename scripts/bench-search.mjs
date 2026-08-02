import { Worker } from 'worker_threads';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const src = readFileSync(join(__dirname, '../src/chess-worker.js'), 'utf8');
const wrapped = `
const { parentPort } = require('worker_threads');
const self = {
  onmessage: null,
  postMessage: (msg) => parentPort.postMessage(msg)
};
// Worker console forwarding on Windows can corrupt UTF-8 and duplicates benchmark summaries.
const console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
parentPort.on('message', (data) => { if (self.onmessage) self.onmessage({ data }); });
${src}
`;

function printCpuProfile(profileDir, priorFiles) {
  const files = readdirSync(profileDir)
    .filter((name) => name.endsWith('.cpuprofile') && !priorFiles.has(name));
  const profiles = files.map((file) => ({
    file,
    profile: JSON.parse(readFileSync(join(profileDir, file), 'utf8'))
  }));
  const workerProfiles = profiles.filter(({ profile }) =>
    profile.nodes.some((node) => node.callFrame?.url === '[worker eval]')
  );
  const selectedProfiles = workerProfiles.length > 0 ? workerProfiles : profiles;
  const totals = new Map();
  let activeUs = 0;

  for (const { profile } of selectedProfiles) {
    const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
    for (let i = 0; i < profile.samples.length; i++) {
      const delta = profile.timeDeltas[i] || 0;
      const frame = frames.get(profile.samples[i]);
      if (!frame || frame.functionName === '(idle)') continue;
      const url = frame.url ? frame.url.split(/[\\/]/).pop() : '';
      const name = `${frame.functionName || '(anonymous)'} @${url}:${(frame.lineNumber || 0) + 1}`;
      activeUs += delta;
      totals.set(name, (totals.get(name) || 0) + delta);
    }
  }

  if (activeUs === 0) {
    console.log('\nCPU profile did not contain active worker samples.');
    return;
  }

  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const workerFrames = sorted.filter(([name]) => name.includes('@[worker eval]:'));
  const display = workerFrames.length > 0 ? workerFrames : sorted;
  const displayUs = display.reduce((sum, [, us]) => sum + us, 0);

  console.log(`\n=== CPU Profile (${selectedProfiles.length} worker files, ${(displayUs / 1000).toFixed(0)}ms worker self samples) ===`);
  console.log('Self time is sampled CPU time; it excludes child function time.');
  for (const [name, us] of display.slice(0, 20)) {
    console.log(`${(us / 1000).toFixed(0).padStart(7)}ms ${(100 * us / displayUs).toFixed(1).padStart(5)}% ${name}`);
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

function runSearch(depth, exactRootScores, opts = {}) {
  return new Promise((resolve, reject) => {
    const w = new Worker(wrapped, { eval: true });
    const t0 = Date.now();
    w.on('message', (msg) => {
      if (msg.type === 'SEARCH_COMPLETE') {
        const elapsed = Date.now() - t0;
        w.terminate();
        resolve({ elapsed, payload: msg.payload });
      }
    });
    w.on('error', reject);
    w.postMessage({
      type: 'SEARCH',
      payload: {
        board: makeInitialBoard(),
        turn: 'red',
        depth,
        randomness: 0,
        gameId: 1,
        openingBookEnabled: false,
        ply: 0,
        enableTimeLimit: false,
        exactRootScores,
        deferLegality: opts.deferLegality !== false,
        incrementalZobrist: opts.incrementalZobrist !== false,
        leafAttackBits: opts.leafAttackBits !== false,
        relationMasks: opts.relationMasks !== false,
        fastLeafEval: opts.fastLeafEval !== false,
        fastLeafRelations: opts.fastLeafRelations !== false,
        fastSort: opts.fastSort !== false,
        fastPseudoMoves: opts.fastPseudoMoves !== false,
        numericCheck: opts.numericCheck !== false,
        fastZobrist: opts.fastZobrist !== false,
        pieceList: opts.pieceList !== false,
        ttEvictionBatch: opts.ttEvictionBatch,
        profile: opts.profile === true,
        zobristVerify: !!opts.zobristVerify,
        collectMoveSequence: opts.collectMoveSequence
      }
    });
  });
}

function fmtMove(m) {
  if (!m?.from || !m?.to) return 'null';
  return `${JSON.stringify(m.from)}->${JSON.stringify(m.to)}`;
}

function summarize(label, elapsed, payload) {
  const p = payload.perf || {};
  return {
    label,
    wallMs: elapsed,
    thinkingTimeMs: payload.thinkingTime,
    bestMove: fmtMove(payload.bestMove),
    score: payload.bestMoveScore,
    secondBest: fmtMove(payload.secondBestMove),
    secondScore: payload.secondBestMoveScore,
    allMoves: payload.allMovesWithScores?.length ?? 0,
    completedDepth: payload.completedDepth,
    deferLegality: p.deferLegality,
    incrementalZobrist: p.incrementalZobrist,
    leafAttackBits: p.leafAttackBits,
    relationMasks: p.relationMasks,
    fastLeafRelations: p.fastLeafRelations,
    fastSort: p.fastSort,
    fastPseudoMoves: p.fastPseudoMoves,
    numericCheck: p.numericCheck,
    fastZobrist: p.fastZobrist,
    pieceList: p.pieceList,
    fastLeafEval: p.fastLeafEval,
    fastLeafEvalCount: p.fastLeafEvalCount,
    fastLeafEvalMs: p.fastLeafEvalMs,
    profile: p.profile ? {
      prepareCheckMs: p.prepareCheckMs,
      prepareMoveGenMs: p.prepareMoveGenMs,
      sortMovesCount: p.sortMovesCount,
      sortMovesMs: p.sortMovesMs,
      legalityCheckMs: p.legalityCheckMs,
      captureGenCount: p.captureGenCount,
      captureGenMs: p.captureGenMs,
      quiescenceCalls: p.quiescenceCalls,
      quiescenceCaptureMoves: p.quiescenceCaptureMoves,
      staticEvalCacheHits: p.staticEvalCacheHits,
      staticEvalCacheMisses: p.staticEvalCacheMisses
    } : null,
    alphaBetaCalls: p.alphaBetaCalls,
    legalityChecks: p.legalityChecks,
    pseudoMovesGenerated: p.pseudoMovesGenerated,
    illegalMovesSkipped: p.illegalMovesSkipped,
    legalMovesSearched: p.legalMovesSearched,
    fullHashCount: p.fullHashCount,
    incrementalHashUpdates: p.incrementalHashUpdates,
    hashMismatches: p.hashMismatches,
    evaluateBoardMs: p.evaluateBoardMs,
    prepareSearchInfoMs: p.prepareSearchInfoMs,
    evaluateBoard: p.evaluateBoard,
    prepareSearchInfo: p.prepareSearchInfo,
    tt: p.tt,
    byDepth: p.byDepth
  };
}

function printSummary(s) {
  console.log(
    `wall=${s.wallMs}ms thinkingTime=${s.thinkingTimeMs}ms ` +
    `best=${s.bestMove} score=${s.score} allMoves=${s.allMoves}`
  );
  console.log(
    `  alphaBeta=${s.alphaBetaCalls} legalityChecks=${s.legalityChecks} ` +
    `legalSearched=${s.legalMovesSearched}`
  );
  console.log(
    `  Zobrist: incr=${s.incrementalZobrist} fullHash=${s.fullHashCount} ` +
    `incrUpdates=${s.incrementalHashUpdates} mismatches=${s.hashMismatches}`
  );
  console.log(
    `  leafAttackBits=${s.leafAttackBits} relationMasks=${s.relationMasks} ` +
    `fastLeafEval=${s.fastLeafEval} fastLeafRelations=${s.fastLeafRelations} fastSort=${s.fastSort} fastPseudoMoves=${s.fastPseudoMoves} numericCheck=${s.numericCheck} fastZobrist=${s.fastZobrist} pieceList=${s.pieceList} count=${s.fastLeafEvalCount} ms=${Math.round(s.fastLeafEvalMs ?? 0)}`
  );
  if (s.evaluateBoardMs != null) {
    const evalPct = s.thinkingTimeMs ? (100 * s.evaluateBoardMs / s.thinkingTimeMs).toFixed(1) : '?';
    const prepPct = s.thinkingTimeMs ? (100 * s.prepareSearchInfoMs / s.thinkingTimeMs).toFixed(1) : '?';
    console.log(
      `  time: eval=${Math.round(s.evaluateBoardMs)}ms (${evalPct}%) ` +
      `prepare=${Math.round(s.prepareSearchInfoMs)}ms (${prepPct}%)`
    );
  }
  if (s.tt) {
    console.log(
      `  TT hits=${s.tt.hits} misses=${s.tt.misses} hitRate=${s.tt.hitRate}% stores=${s.tt.stores} ` +
      `updates=${s.tt.updatedStores ?? 0} evicted=${s.tt.lruEvictions}/${s.tt.evictionBatches ?? 0} batch=${s.tt.evictionBatch}`
    );
  }
  if (s.profile) {
    console.log(
      `  profile (overlapping): prepCheck=${Math.round(s.profile.prepareCheckMs)}ms ` +
      `prepMoves=${Math.round(s.profile.prepareMoveGenMs)}ms ` +
      `sort=${Math.round(s.profile.sortMovesMs)}ms/${s.profile.sortMovesCount} ` +
      `legality=${Math.round(s.profile.legalityCheckMs)}ms ` +
      `captureGen=${Math.round(s.profile.captureGenMs)}ms/${s.profile.captureGenCount}`
    );
    console.log(
      `  QS: calls=${s.profile.quiescenceCalls} captureMoves=${s.profile.quiescenceCaptureMoves} ` +
      `evalCache hit/miss=${s.profile.staticEvalCacheHits}/${s.profile.staticEvalCacheMisses}`
    );
  }
}

function printLegalityCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  console.log('\n=== Compare (eager filter -> defer legality) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`legalityChecks: ${before.legalityChecks} -> ${after.legalityChecks}`);
  console.log(`bestMove+score identical: ${sameBest}`);
}

function printZobristCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (full hash+string TT -> incremental+numeric TT) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`fullHashCount: ${before.fullHashCount} -> ${after.fullHashCount}`);
  console.log(`incrementalHashUpdates: ${before.incrementalHashUpdates} -> ${after.incrementalHashUpdates}`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`TT hitRate: ${before.tt?.hitRate}% -> ${after.tt?.hitRate}%`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printAttackBitsCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  const evalBefore = before.evaluateBoardMs ?? 0;
  const evalAfter = after.evaluateBoardMs ?? 0;
  const evalSpeedup = evalBefore / Math.max(1, evalAfter);
  console.log('\n=== Compare (controller grid -> leaf attack bitmaps) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`evaluateBoardMs: ${Math.round(evalBefore)}ms -> ${Math.round(evalAfter)}ms  (x${evalSpeedup.toFixed(2)})`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printRelationMasksCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  const evalBefore = before.evaluateBoardMs ?? 0;
  const evalAfter = after.evaluateBoardMs ?? 0;
  const evalSpeedup = evalBefore / Math.max(1, evalAfter);
  console.log('\n=== Compare (relation lists -> square Uint32 masks) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`evaluateBoardMs: ${Math.round(evalBefore)}ms -> ${Math.round(evalAfter)}ms  (x${evalSpeedup.toFixed(2)})`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printMoveSequenceCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (collect moveSequence in play -> skip in play) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`evaluateBoardMs: ${Math.round(before.evaluateBoardMs ?? 0)}ms -> ${Math.round(after.evaluateBoardMs ?? 0)}ms`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printFastSortCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (generic sort -> search-state numeric sort) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printFastPseudoMovesCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (object pseudo moves -> encoded search pseudo moves) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printNumericCheckCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (object-board check -> numeric search-state check) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalityChecks: ${before.legalityChecks} -> ${after.legalityChecks}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printFastZobristCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (Map/string Zobrist lookup -> direct Zobrist index) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`hash mismatches: ${before.hashMismatches} -> ${after.hashMismatches}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printLeafEvalCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (full leaf evaluator -> allocation-free leaf evaluator) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`full evaluateBoardMs: ${Math.round(before.evaluateBoardMs ?? 0)}ms -> ${Math.round(after.evaluateBoardMs ?? 0)}ms`);
  console.log(`fast leaf: ${before.fastLeafEvalCount ?? 0}/${Math.round(before.fastLeafEvalMs ?? 0)}ms -> ${after.fastLeafEvalCount ?? 0}/${Math.round(after.fastLeafEvalMs ?? 0)}ms`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printPieceListCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (board scans -> maintained search piece list) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`fast leaf: ${Math.round(before.fastLeafEvalMs ?? 0)}ms -> ${Math.round(after.fastLeafEvalMs ?? 0)}ms`);
  console.log(`prepareSearchInfo: ${Math.round(before.prepareSearchInfoMs ?? 0)}ms -> ${Math.round(after.prepareSearchInfoMs ?? 0)}ms`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printTTEvictionCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (single-entry FIFO -> batched FIFO TT eviction) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`TT hitRate: ${before.tt?.hitRate}% -> ${after.tt?.hitRate}%`);
  console.log(`TT evicted: ${before.tt?.lruEvictions}/${before.tt?.evictionBatches} -> ${after.tt?.lruEvictions}/${after.tt?.evictionBatches}`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

function printLeafRelationsCompare(before, after) {
  const speedup = before.wallMs / Math.max(1, after.wallMs);
  const sameBest = before.bestMove === after.bestMove && before.score === after.score;
  const sameTree =
    before.alphaBetaCalls === after.alphaBetaCalls &&
    before.legalMovesSearched === after.legalMovesSearched;
  console.log('\n=== Compare (generic leaf relations -> specialized leaf relations) ===');
  console.log(`wall: ${before.wallMs}ms -> ${after.wallMs}ms  (x${speedup.toFixed(2)})`);
  console.log(`thinkingTime: ${before.thinkingTimeMs}ms -> ${after.thinkingTimeMs}ms`);
  console.log(`fast leaf: ${Math.round(before.fastLeafEvalMs ?? 0)}ms -> ${Math.round(after.fastLeafEvalMs ?? 0)}ms`);
  console.log(`alphaBeta: ${before.alphaBetaCalls} -> ${after.alphaBetaCalls}`);
  console.log(`legalSearched: ${before.legalMovesSearched} -> ${after.legalMovesSearched}`);
  console.log(`search tree identical (ab+legal): ${sameTree}`);
  console.log(`bestMove+score identical: ${sameBest}`);
  console.log(`  before: ${before.bestMove} score=${before.score}`);
  console.log(`  after:  ${after.bestMove} score=${after.score}`);
}

// usage:
//   node scripts/bench-search.mjs 8 play                  # cpuperf by default
//   node scripts/bench-search.mjs 8 play compare          # legality A/B
//   node scripts/bench-search.mjs 8 play zobrist          # zobrist A/B
//   node scripts/bench-search.mjs 8 play attackbits       # leaf attack bitmap A/B
//   node scripts/bench-search.mjs 8 play relmasks         # relation mask A/B
//   node scripts/bench-search.mjs 8 play moveseq          # moveSequence A/B
//   node scripts/bench-search.mjs 8 both leafeval          # search-only leaf evaluator A/B
//   node scripts/bench-search.mjs 8 both leafrelations     # specialized leaf relation A/B
//   node scripts/bench-search.mjs 8 both fastpseudomoves   # encoded search pseudo moves A/B
//   node scripts/bench-search.mjs 8 both numericcheck      # numeric search-state check A/B
//   node scripts/bench-search.mjs 8 both fastzobrist       # direct Zobrist index A/B
//   node scripts/bench-search.mjs 8 both piecelist         # maintained search piece list A/B
//   node scripts/bench-search.mjs 8 both ttfifo            # TT eviction batch A/B
//   node scripts/bench-search.mjs 8 play profile           # diagnostic timing (not a speed benchmark)
//   node scripts/bench-search.mjs 8 play cpuperf           # V8 --cpu-prof self-time report
//   node scripts/bench-search.mjs 8 play incr|full
const depth = Number(process.argv[2]) || 6;
const mode = (process.argv[3] || 'both').toLowerCase();
const pathMode = (process.argv[4] || 'cpuperf').toLowerCase();

if (pathMode === 'cpuperf' && process.env.BENCH_CPU_PROF_CHILD !== '1') {
  const profileDir = join(__dirname, 'profiles');
  mkdirSync(profileDir, { recursive: true });
  const priorFiles = new Set(readdirSync(profileDir).filter((name) => name.endsWith('.cpuprofile')));
  const child = spawnSync(
    process.execPath,
    ['--cpu-prof', '--cpu-prof-dir', profileDir, scriptPath, String(depth), mode, 'cpuperf-run'],
    {
      stdio: 'inherit',
      env: { ...process.env, BENCH_CPU_PROF_CHILD: '1' }
    }
  );
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
  printCpuProfile(profileDir, priorFiles);
  process.exit(0);
}

const jobs = [];
if (mode === 'play' || mode === 'both') jobs.push({ label: 'play(exactRootScores=false)', exact: false });
if (mode === 'analysis' || mode === 'both') jobs.push({ label: 'analysis(exactRootScores=true)', exact: true });

const results = [];
let outName = `bench-d${depth}-latest.json`;

for (const job of jobs) {
  if (pathMode === 'compare') {
    outName = `bench-d${depth}-legality.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} EAGER (deferLegality=false) ===`);
    const beforeRun = await runSearch(depth, job.exact, { deferLegality: false, incrementalZobrist: true, leafAttackBits: true, relationMasks: true });
    const before = summarize('eager', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} DEFER (deferLegality=true) ===`);
    const afterRun = await runSearch(depth, job.exact, { deferLegality: true, incrementalZobrist: true, leafAttackBits: true, relationMasks: true });
    const after = summarize('defer', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printLegalityCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'zobrist' || pathMode === 'hash') {
    outName = `bench-d${depth}-zobrist.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} FULL (incrementalZobrist=false) ===`);
    const beforeRun = await runSearch(depth, job.exact, { deferLegality: true, incrementalZobrist: false, leafAttackBits: true, relationMasks: true });
    const before = summarize('full', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} INCR (incrementalZobrist=true) ===`);
    const afterRun = await runSearch(depth, job.exact, { deferLegality: true, incrementalZobrist: true, leafAttackBits: true, relationMasks: true });
    const after = summarize('incr', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printZobristCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'attackbits' || pathMode === 'bits' || pathMode === 'leafbits') {
    outName = `bench-d${depth}-attackbits.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} GRID (leafAttackBits=false) ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: false,
      relationMasks: false
    });
    const before = summarize('grid', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} BITS (leafAttackBits=true) ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: false
    });
    const after = summarize('bits', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printAttackBitsCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'relmasks' || pathMode === 'masks' || pathMode === 'relationmasks') {
    outName = `bench-d${depth}-relmasks.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} LISTS (relationMasks=false) ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: false
    });
    const before = summarize('lists', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} MASKS (relationMasks=true) ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true
    });
    const after = summarize('masks', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printRelationMasksCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'moveseq' || pathMode === 'sequence' || pathMode === 'pv') {
    outName = `bench-d${depth}-moveseq.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} COLLECT_MOVE_SEQUENCE=true ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      collectMoveSequence: true
    });
    const before = summarize('collect-moveseq', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} COLLECT_MOVE_SEQUENCE=false ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      collectMoveSequence: false
    });
    const after = summarize('skip-moveseq', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printMoveSequenceCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'leafeval' || pathMode === 'leaf' || pathMode === 'fastleaf') {
    outName = `bench-d${depth}-leafeval.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} FULL LEAF EVALUATOR ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: false
    });
    const before = summarize('full-leaf-evaluator', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} ALLOCATION-FREE LEAF EVALUATOR ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true
    });
    const after = summarize('fast-leaf-evaluator', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printLeafEvalCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'leafrelations' || pathMode === 'leafrel' || pathMode === 'relations') {
    outName = `bench-d${depth}-leafrelations.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} GENERIC LEAF RELATIONS ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: false
    });
    const before = summarize('generic-leaf-relations', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} SPECIALIZED LEAF RELATIONS ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true
    });
    const after = summarize('specialized-leaf-relations', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printLeafRelationsCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'fastsort' || pathMode === 'sort') {
    outName = `bench-d${depth}-fastsort.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} GENERIC MOVE SORT ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: false,
      pieceList: true
    });
    const before = summarize('generic-move-sort', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} SEARCH-STATE NUMERIC SORT ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: true,
      pieceList: true
    });
    const after = summarize('search-state-numeric-sort', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printFastSortCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'fastpseudomoves' || pathMode === 'pseudomoves' || pathMode === 'fastmoves') {
    outName = `bench-d${depth}-fastpseudomoves.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} OBJECT PSEUDO MOVES ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: true,
      fastPseudoMoves: false,
      pieceList: true
    });
    const before = summarize('object-pseudo-moves', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} ENCODED SEARCH PSEUDO MOVES ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: true,
      fastPseudoMoves: true,
      pieceList: true
    });
    const after = summarize('encoded-search-pseudo-moves', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printFastPseudoMovesCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'numericcheck' || pathMode === 'check') {
    outName = `bench-d${depth}-numericcheck.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} OBJECT-BOARD CHECK ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: true,
      fastPseudoMoves: true,
      numericCheck: false,
      pieceList: true
    });
    const before = summarize('object-board-check', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} NUMERIC SEARCH-STATE CHECK ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: true,
      fastPseudoMoves: true,
      numericCheck: true,
      pieceList: true
    });
    const after = summarize('numeric-search-state-check', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printNumericCheckCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'fastzobrist' || pathMode === 'zobristindex') {
    outName = `bench-d${depth}-fastzobrist.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} MAP/STRING ZOBRIST LOOKUP ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: true,
      fastPseudoMoves: true,
      numericCheck: true,
      fastZobrist: false,
      pieceList: true,
      zobristVerify: depth <= 4
    });
    const before = summarize('map-string-zobrist-lookup', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} DIRECT ZOBRIST INDEX ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      fastLeafRelations: true,
      fastSort: true,
      fastPseudoMoves: true,
      numericCheck: true,
      fastZobrist: true,
      pieceList: true,
      zobristVerify: depth <= 4
    });
    const after = summarize('direct-zobrist-index', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printFastZobristCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'piecelist' || pathMode === 'pieces' || pathMode === 'plist') {
    outName = `bench-d${depth}-piecelist.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} BOARD SCANS ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      pieceList: false
    });
    const before = summarize('board-scans', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} MAINTAINED PIECE LIST ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      pieceList: true
    });
    const after = summarize('maintained-piece-list', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printPieceListCompare(before, after);
    results.push({ job: job.label, before, after });
  } else if (pathMode === 'ttfifo' || pathMode === 'ttbatch' || pathMode === 'eviction') {
    outName = `bench-d${depth}-ttfifo.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} SINGLE-ENTRY FIFO ===`);
    const beforeRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      pieceList: true,
      ttEvictionBatch: 1
    });
    const before = summarize('single-entry-fifo', beforeRun.elapsed, beforeRun.payload);
    printSummary(before);

    console.log(`\n=== Bench depth=${depth} ${job.label} BATCHED FIFO (1024) ===`);
    const afterRun = await runSearch(depth, job.exact, {
      deferLegality: true,
      incrementalZobrist: true,
      leafAttackBits: true,
      relationMasks: true,
      fastLeafEval: true,
      pieceList: true,
      ttEvictionBatch: 1024
    });
    const after = summarize('batched-fifo-1024', afterRun.elapsed, afterRun.payload);
    printSummary(after);

    printTTEvictionCompare(before, after);
    results.push({ job: job.label, before, after });
  } else {
    const incr =
      pathMode === 'full' || pathMode === 'false' ? false :
      pathMode === 'incr' || pathMode === 'true' || pathMode === '' ? true :
      true;
    const defer =
      pathMode === 'eager' ? false :
      true;
    const bits =
      pathMode === 'grid' ? false :
      true;
    const masks =
      pathMode === 'lists' ? false :
      true;
    const profile = pathMode === 'profile';
    const tag = `${incr ? 'INCR' : 'FULL'}/${masks ? 'MASKS' : 'LISTS'}${profile ? '/PROFILE' : ''}`;
    outName = `bench-d${depth}-${profile ? 'profile' : 'latest'}.json`;
    console.log(`\n=== Bench depth=${depth} ${job.label} ${tag} (opening, book off) ===`);
    const { elapsed, payload } = await runSearch(depth, job.exact, {
      deferLegality: defer,
      incrementalZobrist: incr,
      leafAttackBits: bits,
      relationMasks: masks,
      profile
    });
    const s = summarize(tag.toLowerCase(), elapsed, payload);
    printSummary(s);
    results.push({ job: job.label, result: s });
  }
}

const outJson = join(__dirname, outName);
writeFileSync(outJson, JSON.stringify({ depth, pathMode: pathMode || 'incr', results, at: new Date().toISOString() }, null, 2));
console.log(`\nSaved JSON: ${outJson}`);
