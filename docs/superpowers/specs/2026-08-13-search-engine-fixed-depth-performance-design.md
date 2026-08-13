# Search Engine Fixed-Depth Performance Design

Date: 2026-08-13

## Goal

Reduce the wall-clock time required by the Play search to complete a fixed depth while preserving its observable search result. For the benchmark position, the best move and score must remain identical at each verification depth.

This work targets the modular JavaScript engine in `src/engine/js/search.js`. Analysis-mode behavior, UI evaluation output, and search selectivity settings are outside the optimization scope unless a shared implementation can be changed without altering their results.

## Evidence

The existing depth-12 Play profile reports approximately 24.7 seconds of thinking time. The largest instrumented costs are:

- numeric leaf evaluation: about 9.3 seconds across 12.9 million cache misses;
- leaf relation calculation: about 6.3 seconds;
- move preparation: about 3.0 seconds;
- capture generation: about 1.3 seconds;
- legality checks: about 1.2 seconds;
- move sorting: about 1.1 seconds.

The first optimization therefore belongs in the numeric leaf evaluation and relation-calculation path. Search-tree changes such as more aggressive LMR, NMP, or pruning are deliberately excluded because they can improve time by changing which nodes are searched and can change tactical results.

## Approach

Use a measurement-led, behavior-preserving hot-path refactor:

1. Establish a repeated depth-10 Play baseline using the existing benchmark workload and default search switches.
2. Profile the current implementation and trace the dominant leaf-evaluation cost to a specific repeated scan, allocation, or call pattern.
3. Add a focused automated equivalence or invariant check before changing production code. The check must fail when the proposed optimized path is absent or deliberately mismatched.
4. Make one small optimization in the confirmed hot path. Prefer reuse of existing packed piece state, typed arrays, and scratch buffers over a new abstraction.
5. Compare repeated depth-10 runs against the baseline, then validate at depth 12 if the shorter benchmark shows a stable improvement.
6. Retain the change only when the result is equivalent and the timing improvement is reproducible.

## Behavioral Constraints

For the standard initial-position benchmark at a given depth, the refactor must preserve:

- best move;
- best-move score;
- completed depth;
- legal move semantics and checkmate/stalemate handling;
- default search configuration and pruning parameters.

Node counts may differ only if the implementation removes redundant work without changing move ordering, bounds, or pruning decisions. Any material node-count change must be investigated as a possible semantic change rather than accepted as a performance gain.

## Benchmark Method

Use `node scripts/bench-search.mjs <depth> play latest` directly so the interactive pause in `bench.bat` does not affect automation. Do not overwrite or normalize the user's existing `bench.bat` changes.

The primary comparison is repeated depth-10 Play runs in the same environment. Report median thinking time, individual timings, best move, score, alpha-beta calls, leaf-evaluation count, and relevant profile counters. Use depth 12 as the final representative verification when practical.

Metrics instrumentation adds overhead, so before/after runs must use identical flags. CPU/profile runs locate costs; non-profile runs determine the delivered speedup.

## Acceptance Criteria

The refactor is accepted only if all of the following hold:

- the project build succeeds;
- the focused equivalence/invariant check passes;
- best move, score, and completed depth match the baseline;
- repeated depth-10 runs show a stable improvement, with the median at least 5% faster to exceed ordinary run-to-run noise;
- depth-12 verification, when run, does not contradict the depth-10 result;
- no unrelated files or user changes are modified.

If the first confirmed optimization fails the 5% threshold, revert only that optimization and report the measured result. A second optimization requires a new profile-backed hypothesis, not an accumulation of speculative edits.

## Risks And Controls

Scratch-state reuse can introduce recursion aliasing. Any reused buffer must be indexed by search ply or fully consumed before recursion. Packed-state shortcuts can drift from object-board behavior, so equivalence checks must cover representative positions or the existing verification mode when available.

Microbenchmark noise is controlled with repeated runs and medians. A faster result caused by changed best move, score, node count, or pruning configuration is rejected as a semantic change.

## Deliverables

- a narrowly scoped refactor in the search engine hot path;
- a focused automated regression/equivalence check;
- before/after benchmark evidence;
- a concise review of the performance root cause, change, measured gain, and residual risks.
