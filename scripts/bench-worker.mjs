import { parentPort } from 'node:worker_threads';
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { createSearchEngine } from '../src/engine/core/index.js';

console.log = () => {};
const searchEngine = createSearchEngine();

parentPort.on('message', ({ type, payload }) => {
  if (type !== 'SEARCH') return;

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
  const mode = payload.mode === 'analysis' || payload.exactRootScores
    ? 'analysis'
    : 'play';
  const result = searchEngine.search(mode, {
    ...payload,
    progress: () => {}
  });
  const thinkingTime = Math.round(performance.now() - started);
  gc.heapAfter = process.memoryUsage().heapUsed;
  observer.disconnect();
  const fromBook = !!result.fromBook;

  parentPort.postMessage({
    type: 'SEARCH_COMPLETE',
    payload: {
      ...result,
      gameId: payload.gameId,
      fromBook,
      thinkingTime,
      perf: searchEngine.snapshotPerfStats(),
      gc,
    }
  });
});
