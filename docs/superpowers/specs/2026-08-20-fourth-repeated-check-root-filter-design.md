# Fourth Repeated Check Root Filter Design

## Goal

Prevent AI search from considering a root move that would immediately recreate the same checking position for the fourth time. Legal second and third occurrences remain searchable, and search evaluation, move ordering, and playing strength remain unchanged for all remaining moves.

## Current Behavior

The UI waits for `SEARCH_COMPLETE`, applies the returned best move to a temporary board, and calls `checkRepetition`. When the best move would create the fourth repeated checking position, the UI adds that move to `excludedRootMoves` and starts another full search.

This is rules-correct, but the first search can spend most of its time preferring a move that cannot be played. The engine also presents that repeated-check line as its principal choice until the post-search check rejects it.

## Chosen Design

### Precompute Forbidden Resulting Positions

Before posting a search, the UI derives a small set of position hashes from `positionHistory`. A hash is forbidden for the current mover when:

- the same complete position, including side to move, already occurs at least three times;
- the recorded position is known to have resulted from a check by the current mover; and
- entering it again would therefore be the fourth occurrence.

The threshold remains four. A second or third repeated check is not filtered.

The history helper is a pure function in the repetition domain. It counts all entries for the exact hash and uses the stored mover, falling back to the turn suffix when necessary. A known checking occurrence is sufficient because check status is deterministic for an identical board and side to move.

### Share One Position Hash Implementation

The UI and search engine must calculate identical keys. Move `generatePositionHash` into a small shared JavaScript module that contains no React or Worker dependencies. The repetition TypeScript module re-exports or wraps it, while `search.js` imports the same runtime function directly.

The existing collision-free piece mapping and `/red` or `/black` suffix remain unchanged.

### Filter Only At The Root

Add an optional `forbiddenRootPositionHashes` field to the search request. The Worker forwards it to `getBestMove`.

`getBestMove` creates a `Set` only when the array is non-empty. During opening-book validation and ordinary root move generation, it temporarily applies a candidate, computes the resulting position hash with the opponent to move, restores the board, and rejects the candidate if the hash is forbidden.

When the forbidden set is empty, the helper returns immediately and performs no candidate hashing. Alpha-Beta, Quiescence, TT keys, evaluation, and non-root move generation are untouched.

### Retain Existing Move Exclusions

Keep `excludedRootMoves` and the post-search `checkMoveRepetition` retry loop.

- `forbiddenRootPositionHashes` is the normal fast path for an imminent fourth repeated check.
- `excludedRootMoves` remains a generic coordinate-based exclusion mechanism.
- The post-search check remains a safety net for incomplete legacy history, stale UI state, long-chase rules, or any mismatch between prefilter inputs and the final result.

Under normal repeated-check handling, the safety retry should no longer trigger.

## Data Flow

1. AI turn begins with the current board, mover, and `positionHistory`.
2. The UI computes forbidden fourth-check position hashes for that mover.
3. The UI posts `SEARCH`, including the hashes only when the set is non-empty.
4. The Worker decodes the board and forwards both hash exclusions and existing move exclusions.
5. Root generation filters opening-book and generated moves against both exclusion forms.
6. Search evaluates only remaining legal root moves.
7. The UI still validates the returned best move before executing it.

## Edge Cases

- If no forbidden hashes exist, behavior and search node counts must match the current implementation.
- If every root move is excluded, `getBestMove` returns the existing no-move result; the UI must not execute a move.
- Opening-book moves are subject to the same fourth-check restriction.
- Non-check repetition is not included in the prefilter and continues through existing draw or Auto-mode handling.
- Long-chase handling is unchanged and remains in the post-search path.
- A malformed history entry that cannot establish a prior check is not prefiltered; the post-search validation remains authoritative.

## Performance Constraints

The normal path must not hash candidate root positions when there are no forbidden hashes. In the rare active-filter case, only root candidates are hashed, adding roughly 30-50 scans of a 90-square board. This is negligible beside millions of search nodes and avoids a complete rejected search followed by a second search.

## Testing

- Repetition-domain tests: second and third occurrence allowed; fourth checking occurrence produces a forbidden hash; non-check and opponent-mover histories do not.
- Shared-hash tests: UI/domain and engine consumers use the same collision-free function.
- Engine root tests: forbidden resulting hash removes the matching root move, including an opening-book candidate.
- Regression fixture: the move-47 position filters the repeated checking rook move and directly selects rook back eight.
- Search equivalence: an empty forbidden-hash list preserves best move, score, Alpha-Beta node count, and legal-move count.
- Performance: depth 10 and 12 benchmarks show no identifiable normal-path regression; the repeated-check fixture completes one search rather than search-then-research.

## Non-Goals

- Penalizing repeated checks before the fourth occurrence.
- Carrying repetition history through the full Alpha-Beta tree.
- Changing check, chase, draw, TT, or evaluation rules.
- Removing the existing post-search safety validation.
