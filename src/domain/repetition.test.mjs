import assert from 'node:assert/strict';
import test from 'node:test';

const positionHash = await import('./position-hash.js');
const repetition = await import('./repetition.ts');

const emptyBoard = () => Array.from({ length: 10 }, () => Array(9).fill(null));

test('repetition domain uses the shared position hash implementation', () => {
  const board = emptyBoard();
  board[0][0] = { type: 'chariot', color: 'red' };
  assert.equal(
    repetition.generatePositionHash(board, 'black'),
    positionHash.generatePositionHash(board, 'black')
  );
});

test('position hash distinguishes every piece identity component', () => {
  assert.equal(typeof repetition.generatePositionHash, 'function');

  const redChariot = emptyBoard();
  redChariot[0][0] = { type: 'chariot', color: 'red' };
  const redCannon = emptyBoard();
  redCannon[0][0] = { type: 'cannon', color: 'red' };
  const blackChariot = emptyBoard();
  blackChariot[0][0] = { type: 'chariot', color: 'black' };

  const chariotHash = repetition.generatePositionHash(redChariot, 'red');
  assert.notEqual(chariotHash, repetition.generatePositionHash(redCannon, 'red'));
  assert.notEqual(chariotHash, repetition.generatePositionHash(blackChariot, 'red'));
  assert.notEqual(chariotHash, repetition.generatePositionHash(redChariot, 'black'));
});

test('all piece type and color combinations have unique position hashes', () => {
  const types = [
    'general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'
  ];
  const hashes = [];
  for (const color of ['red', 'black']) {
    for (const type of types) {
      const board = emptyBoard();
      board[0][0] = { type, color };
      hashes.push(repetition.generatePositionHash(board, 'red'));
    }
  }
  assert.equal(new Set(hashes).size, hashes.length);
});

test('position hash keeps the turn suffix used by repetition history', () => {
  const hash = repetition.generatePositionHash(emptyBoard(), 'black');
  assert.equal(hash.slice(hash.lastIndexOf('/') + 1), 'black');
});
