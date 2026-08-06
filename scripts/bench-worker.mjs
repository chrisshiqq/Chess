import { parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { configureSearch } from '../src/engine/js/search-context.js';
import { getBestMove, openingBook, snapshotPerfStats } from '../src/engine/js/search.js';

console.log = () => {};

parentPort.on('message', ({ type, payload }) => {
  if (type !== 'SEARCH') return;

  configureSearch(payload);
  openingBook.setEnabled(payload.openingBookEnabled ?? true);
  const started = performance.now();
  const result = getBestMove(
    payload.board,
    payload.turn,
    payload.depth,
    payload.ply ?? 0,
    payload.enableTimeLimit ?? false,
    payload.exactRootScores ?? false
  );
  const thinkingTime = Math.round(performance.now() - started);
  const bookMove = openingBook.getBookMove(payload.board, payload.ply ?? 0);
  const fromBook = !!bookMove && JSON.stringify(bookMove) === JSON.stringify(result.bestMove);

  parentPort.postMessage({
    type: 'SEARCH_COMPLETE',
    payload: {
      ...result,
      gameId: payload.gameId,
      fromBook,
      thinkingTime,
      perf: snapshotPerfStats()
    }
  });
});
