import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePositionHash } from '../../domain/position-hash.js';
import {
  createInitialSearchBoard,
  encodeBoardToSearchCodes,
  searchCodeToPiece
} from './piece-code.js';
import {
  checkGameState,
  evaluateBoard,
  evaluatePiece,
  getValidMoves,
  hydrateRelationsFromMasks,
  isCheck,
  openingBook,
  searchTestApi
} from './search.js';

const objectInitial = () => {
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
};

const summarizeEval = (result) => ({
  red: result.red.total,
  black: result.black.total,
  material: result.red.material - result.black.material,
  pieces: result.piecesInfo.length,
  redCheck: !!result.boardInfo.redIsInCheck,
  blackCheck: !!result.boardInfo.blackIsInCheck
});

test('开局对象盘与搜索码盘 squareCodes 一致', () => {
  const objectBoard = objectInitial();
  const searchBoard = createInitialSearchBoard();
  assert.deepEqual(
    searchTestApi.readSquareCodes(objectBoard),
    searchTestApi.readSquareCodes(searchBoard)
  );
  assert.deepEqual(encodeBoardToSearchCodes(objectBoard), searchBoard);
});

test('evaluateBoard 对象盘与搜索码盘总分一致', () => {
  const objectEval = evaluateBoard(objectInitial(), 'red', 'early');
  const codeEval = evaluateBoard(createInitialSearchBoard(), 'red', 'early');
  assert.deepEqual(summarizeEval(objectEval), summarizeEval(codeEval));
  assert.equal(objectEval.piecesInfo.every((info) => info.pieceCode > 0), true);
  assert.equal(codeEval.piecesInfo[0].pieceCode, 2);
});

test('点棋评估：对象盘与搜索码盘关系 mask 一致', () => {
  const objectUi = evaluatePiece(objectInitial(), 'red', 'early');
  const codeUi = evaluatePiece(createInitialSearchBoard(), 'red', 'early');
  hydrateRelationsFromMasks(objectUi.piecesInfo, objectUi.boardInfo);
  hydrateRelationsFromMasks(codeUi.piecesInfo, codeUi.boardInfo);
  assert.deepEqual(
    Array.from(objectUi.boardInfo.attackMask),
    Array.from(codeUi.boardInfo.attackMask)
  );
  assert.deepEqual(
    Array.from(objectUi.boardInfo.guardMask),
    Array.from(codeUi.boardInfo.guardMask)
  );
  assert.equal(objectUi.boardInfo.redIsInCheck, false);
  assert.equal(codeUi.boardInfo.blackIsInCheck, false);
  const redChariot = codeUi.piecesInfo.find((info) => info.r === 0 && info.c === 0);
  assert.ok(redChariot.control.length > 0);
});

test('开局未被将，有合法着', () => {
  const board = createInitialSearchBoard();
  assert.equal(isCheck(board, 'red'), false);
  assert.equal(checkGameState(board, 'red').status, 'playing');
  assert.ok(getValidMoves(board, { r: 2, c: 1 }).length > 0);
});

test('记谱往返：炮二平五', () => {
  const moves = openingBook.notationToMoves(['炮二平五']);
  assert.deepEqual(moves, [{ from: { r: 2, c: 7 }, to: { r: 2, c: 4 } }]);
  const before = objectInitial();
  const after = objectInitial();
  after[2][4] = after[2][7];
  after[2][7] = null;
  const notation = openingBook.movesToNotation([before, after], moves);
  assert.equal(notation[0], '炮二平五');
});

test('记谱往返：搜索码局面 + 马二进三', () => {
  const start = createInitialSearchBoard();
  const moves = openingBook.notationToMoves(['马二进三'], start);
  assert.deepEqual(moves, [{ from: { r: 0, c: 7 }, to: { r: 2, c: 6 } }]);
  const after = encodeBoardToSearchCodes(start);
  after[2][6] = after[0][7];
  after[0][7] = 0;
  const notation = openingBook.movesToNotation([start, after], moves);
  assert.equal(notation[0], '马二进三');
});

test('开局库灌库哈希与 pieceState 一致，能查出着', () => {
  openingBook.setEnabled(true);
  const move = { from: { r: 2, c: 1 }, to: { r: 2, c: 4 } };
  openingBook.addOpeningLine([move], [77]);
  const found = openingBook.getBookMove(createInitialSearchBoard(), 0);
  assert.ok(found);
  assert.equal(found.from.r, move.from.r);
  assert.equal(found.from.c, move.from.c);
  assert.equal(found.to.r, move.to.r);
  assert.equal(found.to.c, move.to.c);
  const hash = searchTestApi.hashConsistency(objectInitial());
  assert.equal(hash.match, true);
  assert.equal(hash.bookMatch, true);
  assert.equal(hash.mirroredMatch, true);
});

test('position-hash 对象盘与搜索码盘相同', () => {
  const objectBoard = objectInitial();
  const searchBoard = createInitialSearchBoard();
  assert.equal(
    generatePositionHash(objectBoard, 'red'),
    generatePositionHash(searchBoard, 'red')
  );
  assert.notEqual(
    generatePositionHash(objectBoard, 'red'),
    generatePositionHash(objectBoard, 'black')
  );
  assert.equal(searchCodeToPiece(2).type, 'chariot');
});

test('开局红方合法着数量稳定', () => {
  const legal = searchTestApi.allLegalMoves(createInitialSearchBoard(), 'red');
  assert.equal(legal.length, searchTestApi.allLegalMoves(objectInitial(), 'red').length);
  assert.ok(legal.length >= 40);
});
