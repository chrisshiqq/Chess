import assert from 'node:assert/strict';
import { decodeBoard, encodeBoard } from '../src/engine/codec.ts';
import { configureSearch, searchContext } from '../src/engine/js/search-context.js';
import { isValidPlacement } from '../src/engine/js/rules.js';

const board = Array.from({ length: 10 }, () => Array(9).fill(null));
board[0][4] = { type: 'general', color: 'red' };
board[2][1] = { type: 'cannon', color: 'red' };
board[9][4] = { type: 'general', color: 'black' };

const compact = encodeBoard(board);
assert.equal(compact[0][4], 0);
assert.equal(compact[2][1], 5);
assert.equal(compact[9][4], 7);
assert.deepEqual(decodeBoard(compact), board);
assert.throws(() => decodeBoard(Array.from({ length: 10 }, () => Array(9).fill(99))), /piece code/);

configureSearch({ profile: true, metrics: true, stagedMovePicker: false });
assert.equal(searchContext.profile, true);
assert.equal(searchContext.collectMetrics, true);
assert.equal(searchContext.stagedMovePicker, false);
configureSearch();
assert.equal(searchContext.profile, false);
assert.equal(searchContext.collectMetrics, false);
assert.equal(searchContext.stagedMovePicker, true);

assert.equal(isValidPlacement('general', 'red', 1, 4), true);
assert.equal(isValidPlacement('general', 'red', 3, 4), false);
assert.equal(isValidPlacement('soldier', 'red', 4, 1), false);
assert.equal(isValidPlacement('soldier', 'red', 5, 1), true);

console.log('Engine module tests passed.');

