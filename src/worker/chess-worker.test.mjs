import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSearchBoard } from '../engine/js/piece-code.js';
import { handleWorkerRequest } from './chess-worker.ts';

const request = (message) => new Promise((resolve, reject) => {
  handleWorkerRequest(message, (response) => {
    if (response.type === 'WORKER_ERROR') {
      reject(new Error(response.error));
      return;
    }
    resolve(response);
  });
});

const search = (board, exactRootScores) => new Promise((resolve, reject) => {
  handleWorkerRequest({
    type: 'SEARCH',
    payload: { board, turn: 'red', depth: 2, gameId: 1, openingBookEnabled: false, exactRootScores }
  }, (response) => {
    if (response.type === 'WORKER_ERROR') reject(new Error(response.error));
    if (response.type === 'SEARCH_COMPLETE') resolve(response.payload);
  });
});

test('play omits variations and analysis returns a variation for each root move', async () => {
  const board = createInitialSearchBoard();
  const play = await search(board, false);
  const analysis = await search(board, true);

  assert.notEqual(play.bestMove, null);
  assert.deepEqual(play.bestMoveSequence, []);
  assert.ok(play.allMovesWithScores.every(({ moveSequence }) => moveSequence.length === 0));
  assert.equal(analysis.bestMoveSequence[0], analysis.bestMove);
  assert.ok(analysis.allMovesWithScores.length > 0);
  assert.ok(analysis.allMovesWithScores.every(({ move, moveSequence }) => moveSequence[0] === move));
});

test('setup inspection handles a side without a general', async () => {
  const board = createInitialSearchBoard();
  board[0][4] = 0;
  const payload = { board, requestId: 'setup' };
  const check = await request({ type: 'isCheck', payload: { ...payload, color: 'red' } });
  const moves = await request({ type: 'getValidMoves', payload: { ...payload, pos: { r: 2, c: 1 } } });
  const state = await request({ type: 'checkGameState', payload: { ...payload, turn: 'red' } });
  assert.equal(check.isCheck, true);
  assert.deepEqual(moves.moves, []);
  assert.deepEqual(state.state, { status: 'checkmate', winner: 'black' });
});

test('Worker 点棋/合法着/评估直接吃搜索码盘', async () => {
  const board = createInitialSearchBoard();
  const cannon = { r: 2, c: 1 };

  const moves = await request({
    type: 'getValidMoves',
    payload: { board, pos: cannon, requestId: 'm1' }
  });
  assert.ok(moves.moves.length > 0);

  const inspected = await request({
    type: 'inspectSquare',
    payload: { board, pos: cannon, turn: 'red', needMoves: true, requestId: 'i1' }
  });
  assert.ok(inspected.moves.length > 0);
  assert.ok(inspected.evaluation.material > 0);

  const evaled = await request({
    type: 'evaluateBoard',
    payload: { board, turn: 'red', requestId: 'e1' }
  });
  assert.ok(evaled.evaluation.red.total !== undefined);

  const check = await request({
    type: 'isCheck',
    payload: { board, color: 'red', requestId: 'c1' }
  });
  assert.equal(check.isCheck, false);

  const state = await request({
    type: 'checkGameState',
    payload: { board, turn: 'red', requestId: 'g1' }
  });
  assert.equal(state.state.status, 'playing');

  const notation = await request({
    type: 'notationToMoves',
    payload: { notation: ['炮二平五'], initialBoard: board, requestId: 'n1' }
  });
  assert.deepEqual(notation.moves, [{ from: { r: 2, c: 7 }, to: { r: 2, c: 4 } }]);
});
