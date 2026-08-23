import { parentPort } from 'node:worker_threads';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { configureSearch } from '../src/engine/js/search-context.js';
import { getBestMove, openingBook, snapshotPerfStats } from '../src/engine/js/search.js';

console.log = () => {};

parentPort.on('message', ({ type, payload }) => {
  if (type !== 'SEARCH') return;

  configureSearch(payload);
  openingBook.setEnabled(payload.openingBookEnabled ?? true);
  const gc = { count: 0, durationMs: 0, heapBefore: 0, heapAfter: 0 };
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gc.count++;
      gc.durationMs += entry.duration;
    }
  });
  observer.observe({ entryTypes: ['gc'], buffered: false });
  gc.heapBefore = process.memoryUsage().heapUsed;
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
  gc.heapAfter = process.memoryUsage().heapUsed;
  observer.disconnect();
  const bookMove = openingBook.getBookMove(payload.board, payload.ply ?? 0);
  const fromBook = !!bookMove && JSON.stringify(bookMove) === JSON.stringify(result.bestMove);

  parentPort.postMessage({
    type: 'SEARCH_COMPLETE',
    payload: {
      ...result,
      gameId: payload.gameId,
      fromBook,
      thinkingTime,
      perf: snapshotPerfStats(),
      gc
    }
  });
});
