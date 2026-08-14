import test from 'node:test';
import assert from 'node:assert/strict';

import { searchTestApi } from '../src/engine/js/search.js';

const boardFrom = (pieces) => {
  const board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [r, c, type, color] of pieces) {
    board[r][c] = { type, color };
  }
  return board;
};

const decode = (move) => {
  const from = move >>> 7;
  const to = move & 0x7f;
  return {
    from: { r: Math.floor(from / 9), c: from % 9 },
    to: { r: Math.floor(to / 9), c: to % 9 }
  };
};

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

  assert.deepEqual(
    searchTestApi.collectPackedCaptures(board, 'red').map(decode),
    [
      { from: { r: 2, c: 0 }, to: { r: 2, c: 5 } },
      { from: { r: 4, c: 0 }, to: { r: 4, c: 3 } },
      { from: { r: 4, c: 4 }, to: { r: 2, c: 5 } }
    ]
  );
});

test('packed capture collection filters by side to move', () => {
  const board = boardFrom([
    [0, 4, 'general', 'red'],
    [9, 4, 'general', 'black'],
    [5, 4, 'soldier', 'red'],
    [4, 0, 'chariot', 'red'],
    [4, 3, 'chariot', 'black']
  ]);

  assert.deepEqual(
    searchTestApi.collectPackedCaptures(board, 'black').map(decode),
    [
      { from: { r: 4, c: 3 }, to: { r: 4, c: 0 } }
    ]
  );
});
