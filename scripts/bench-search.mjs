import { Worker } from 'worker_threads';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../src/chess-worker.js'), 'utf8');
const wrapped = `
const { parentPort } = require('worker_threads');
const self = {
  onmessage: null,
  postMessage: (msg) => parentPort.postMessage(msg)
};
parentPort.on('message', (data) => { if (self.onmessage) self.onmessage({ data }); });
${src}
`;

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

function runSearch(depth) {
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
        enableTimeLimit: false
      }
    });
  });
}

const depths = process.argv.slice(2).map(Number).filter((n) => n > 0);
const list = depths.length ? depths : [4, 5];

for (const d of list) {
  console.log(`\n=== Bench depth=${d} (opening, book off) ===`);
  const { elapsed, payload } = await runSearch(d);
  console.log(`wall=${elapsed}ms thinkingTime=${payload.thinkingTime}ms best=${JSON.stringify(payload.bestMove?.from)}->${JSON.stringify(payload.bestMove?.to)} score=${payload.bestMoveScore} allMoves=${payload.allMovesWithScores?.length ?? 0}`);
}
