# Search Engine Fixed-Depth Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce fixed-depth Play search time by at least 5% while preserving the benchmark best move, score, completed depth, and search configuration.

**Architecture:** Keep the existing packed SoA leaf evaluator and change only its QS capture-producing path. The current `calculatePackedSearchLeafRelationsNumericWithCaptures` duplicates the complete relation traversal and accounts for 21.8% of sampled self time; the proposed path runs the smaller `calculatePackedSearchLeafRelationsNumericFast` relation builder, then collects captures for only the side to move with the existing packed move generator. Retain the integrated implementation as a verification oracle, not as the default path.

**Tech Stack:** JavaScript ES modules, Node.js `node:test`, Vite/TypeScript build, existing worker benchmark and V8 CPU profiler.

---

## File Structure

- Modify `src/engine/js/search.js`: add the separated packed-capture collector, route normal numeric leaf evaluation through it, retain the integrated relation/capture function only for verification, and expose a narrow test API.
- Create `scripts/test-search-captures.mjs`: assert exact packed capture order for representative rook/cannon/horse positions and both sides to move.
- Modify `package.json`: add a repeatable `test:search` command.
- Do not modify `bench.bat`; it contains pre-existing user changes.

### Task 1: Record A Repeated Baseline

**Files:**
- Read: `scripts/bench-search.mjs`
- Read: `scripts/bench-d10-latest.json`
- Do not commit generated benchmark JSON.

- [ ] **Step 1: Run five identical depth-10 Play searches**

Run each command separately so the worker and TT start cold each time:

```powershell
node scripts/bench-search.mjs 10 play latest
```

After each run, record these fields from `scripts/bench-d10-latest.json` in scratch notes outside tracked files:

```text
results[0].thinkingTimeMs
results[0].bestMove
results[0].score
results[0].perf.alphaBetaCalls
results[0].perf.fastLeafEvalCount
results[0].perf.leafRelations.calls
```

Expected: all five runs produce the same best move, score, alpha-beta count, leaf count, and completed search depth; only timing varies.

- [ ] **Step 2: Calculate the baseline median**

Run with the five recorded millisecond values substituted literally:

```powershell
$searchTimes = @(3300, 3310, 3320, 3330, 3340) | Sort-Object
$searchTimes[[math]::Floor($searchTimes.Count / 2)]
```

Expected: one median value. Replace the example values with actual measurements and keep the value in the task notes for the final report.

- [ ] **Step 3: Confirm the profile hypothesis**

Run:

```powershell
node scripts/bench-search.mjs 10 play cpuperf
```

Expected: `calculatePackedSearchLeafRelationsNumericWithCaptures` remains the largest or one of the largest engine self-time frames. If it is no longer material, stop and re-profile before editing.

### Task 2: Lock Packed Capture Order With A Failing Test

**Files:**
- Create: `scripts/test-search-captures.mjs`
- Modify: `package.json`
- Test: `scripts/test-search-captures.mjs`

- [ ] **Step 1: Add the search test command**

Add this script entry to `package.json`:

```json
"test:search": "node --test scripts/test-search-captures.mjs"
```

- [ ] **Step 2: Write the failing capture-order test**

Create `scripts/test-search-captures.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchTestApi } from '../src/engine/js/search.js';

const boardFrom = (pieces) => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, type, color] of pieces) board[r][c] = { type, color };
  return board;
};

const decode = (move) => ({
  from: { r: ((move >>> 7) / 9) | 0, c: (move >>> 7) % 9 },
  to: { r: ((move & 127) / 9) | 0, c: (move & 127) % 9 }
});

test('packed captures keep source-square and piece-destination order', () => {
  const board = boardFrom([
    [0, 4, 'general', 'red'],
    [9, 4, 'general', 'black'],
    [5, 4, 'soldier', 'red'],
    [2, 0, 'cannon', 'red'],
    [2, 2, 'soldier', 'red'],
    [2, 5, 'chariot', 'black'],
    [4, 0, 'chariot', 'red'],
    [4, 3, 'soldier', 'black'],
    [4, 4, 'horse', 'red']
  ]);

  assert.deepEqual(searchTestApi.collectPackedCaptures(board, 'red').map(decode), [
    { from: { r: 2, c: 0 }, to: { r: 2, c: 5 } },
    { from: { r: 4, c: 0 }, to: { r: 4, c: 3 } },
    { from: { r: 4, c: 4 }, to: { r: 2, c: 5 } }
  ]);
});

test('packed capture collection filters by side to move', () => {
  const board = boardFrom([
    [0, 4, 'general', 'red'],
    [9, 4, 'general', 'black'],
    [5, 4, 'soldier', 'red'],
    [4, 0, 'chariot', 'red'],
    [4, 3, 'chariot', 'black']
  ]);

  assert.deepEqual(searchTestApi.collectPackedCaptures(board, 'black').map(decode), [
    { from: { r: 4, c: 3 }, to: { r: 4, c: 0 } }
  ]);
});
```

- [ ] **Step 3: Run the test and verify RED**

Run:

```powershell
npm run test:search
```

Expected: FAIL during module import because `searchTestApi` is not exported. This proves the new contract is not accidentally testing existing behavior.

### Task 3: Separate Relation Building From QS Capture Collection

**Files:**
- Modify: `src/engine/js/search.js:2585`
- Modify: `src/engine/js/search.js:3327`
- Modify: `src/engine/js/search.js:7638`
- Test: `scripts/test-search-captures.mjs`

- [ ] **Step 1: Add a packed-state capture collector**

Immediately after `calculatePackedSearchLeafRelationsNumericFast`, add a helper that reuses the established packed pseudo-move generator and preserves the old ascending source-square order:

```js
const collectPackedCapturesFromPieceState = (pieceState, capturePlayer, destination) => {
    const captures = destination;
    captures.length = 0;
    const captureIsRed = capturePlayer === 'red';
    const squareToSlot = pieceState.squareToSlot;
    const squareCodes = pieceState.squareCodes;
    const pieceCodes = pieceState.pieceCodes;
    for (let fromSq = 0; fromSq < REL_SQUARES; fromSq++) {
        const slot = squareToSlot[fromSq];
        if (slot < 0) continue;
        const pieceCode = pieceCodes[slot];
        if ((pieceCode < 8) !== captureIsRed) continue;
        appendSearchPseudoMovesForPiece(captures, fromSq, pieceCode, squareCodes, true);
    }
    return captures;
};
```

- [ ] **Step 2: Route the normal with-captures path through the small relation builder**

Change the non-verification branch in `calculatePackedSearchLeafRelationsNumeric` to:

```js
if (!searchContext.verifyLineOccupancyLookup) {
    calculatePackedSearchLeafRelationsNumericFast(pieceState, aliveMask);
    if (withCaptures) {
        collectPackedCapturesFromPieceState(pieceState, capturePlayer, scratchPackedCaptures);
    }
    return;
}
```

Do not delete `calculatePackedSearchLeafRelationsNumericWithCaptures`; the verification path uses it as an independent oracle.

- [ ] **Step 3: Make verification compare integrated and separated paths**

In the `verifyLineOccupancyLookup` branch, first run `calculatePackedSearchLeafRelationsNumericWithCaptures` with the requested lookup setting and snapshot relation masks, mobility, and capture order into the existing `verify*` buffers. Then run:

```js
calculatePackedSearchLeafRelationsNumericFast(pieceState, aliveMask);
if (withCaptures) {
    collectPackedCapturesFromPieceState(pieceState, capturePlayer, scratchPackedCaptures);
}
```

Compare the same fields already checked at lines 3381-3403: attack-by-slot, guard-by-slot, red/black palace attack bits, red/black mobility, capture count, and every encoded capture in order. Restore `searchContext.lineOccupancyLookup` in a `finally` block so a mismatch cannot leak configuration into later searches.

- [ ] **Step 4: Add the narrow test API**

Near the final exports, add:

```js
const searchTestApi = {
  collectPackedCaptures(board, capturePlayer) {
    const pieceState = createSearchPieceState(board, 'mid');
    return collectPackedCapturesFromPieceState(pieceState, capturePlayer, []).slice();
  }
};
```

Add `searchTestApi` to the existing export list. The API exposes encoded moves only and does not mutate global search state.

- [ ] **Step 5: Run the test and verify GREEN**

Run:

```powershell
npm run test:search
```

Expected: 2 tests pass.

- [ ] **Step 6: Exercise the independent runtime oracle**

Run:

```powershell
$env:BENCH_VERIFY_LINE_OCCUPANCY_LOOKUP='1'
node scripts/bench-search.mjs 6 play latest
Remove-Item Env:BENCH_VERIFY_LINE_OCCUPANCY_LOOKUP
```

Expected: search completes without any relation, mobility, palace-control, capture-count, or capture-order mismatch.

- [ ] **Step 7: Commit the tested refactor**

```powershell
git add package.json scripts/test-search-captures.mjs src/engine/js/search.js
git commit -m "perf: separate leaf relations from capture packing"
```

Expected: commit includes only those three files; `bench.bat` remains unstaged.

### Task 4: Verify Behavior And Performance

**Files:**
- Verify: `src/engine/js/search.js`
- Verify: `scripts/test-search-captures.mjs`
- Do not commit generated benchmark JSON or profile files.

- [ ] **Step 1: Run unit and build verification**

Run:

```powershell
npm run test:search
npm run build
git diff --check
```

Expected: tests pass, Vite build succeeds, and `git diff --check` produces no output.

- [ ] **Step 2: Run five post-change depth-10 searches**

Run this command five times separately:

```powershell
node scripts/bench-search.mjs 10 play latest
```

Expected for every run: best move, score, completed depth, alpha-beta calls, leaf count, and relation call count match Task 1. Record each `thinkingTimeMs` and calculate the median with the PowerShell command from Task 1.

- [ ] **Step 3: Apply the acceptance gate**

Calculate:

```powershell
$improvement = 100 * ($baselineMedian - $optimizedMedian) / $baselineMedian
'{0:N2}%' -f $improvement
```

Expected: at least `5.00%`. If it is below 5%, do not stack another speculative edit; revert only the performance commit with `git revert <commit>` and return to profiling with a new hypothesis.

- [ ] **Step 4: Confirm the hot frame moved**

Run:

```powershell
node scripts/bench-search.mjs 10 play cpuperf
```

Expected: `calculatePackedSearchLeafRelationsNumericWithCaptures` is absent from the normal hot path. `calculatePackedSearchLeafRelationsNumericFast` plus capture generation should consume materially less combined self time than the previous 21.8% integrated frame.

- [ ] **Step 5: Run the representative depth-12 verification**

Run:

```powershell
node scripts/bench-search.mjs 12 play latest
```

Expected: best move and score match the recorded depth-12 baseline (`{r:2,c:1}->{r:4,c:1}`, score `-23`), completed depth is 12, and timing does not contradict the depth-10 improvement.

- [ ] **Step 6: Inspect final scope**

Run:

```powershell
git status --short
git show --stat --oneline HEAD
```

Expected: the implementation commit contains `package.json`, `scripts/test-search-captures.mjs`, and `src/engine/js/search.js`; the user's pre-existing `bench.bat` modification remains untouched. Remove or leave untracked generated benchmark/profile artifacts according to their pre-run tracked state, without deleting user files.

### Task 5: Report The Review And Measured Result

**Files:**
- Read: `docs/superpowers/specs/2026-08-13-search-engine-fixed-depth-performance-design.md`
- Read: benchmark notes from Tasks 1 and 4.

- [ ] **Step 1: Prepare the final performance report**

Report these exact facts:

```text
Root cause: duplicated full relation traversal in the QS capture-producing numeric leaf path.
Change: small relation builder plus side-specific packed capture collection; integrated path retained as verification oracle.
Correctness: unit capture-order tests, runtime oracle, build, best move/score/depth, and invariant counters.
Performance: five before times and median; five after times and median; percentage improvement; depth-12 result.
Residual risk: benchmark position coverage and V8/JIT variability across hardware/browser versions.
```

- [ ] **Step 2: Do not claim success without fresh evidence**

All numbers in the report must come from commands run after the final code change. If depth 12 cannot be completed, explicitly report that gap rather than substituting the old profile result.
