import assert from 'node:assert/strict';
import {
  countPositionOccurrences,
  isReplyingToOpponentCheck,
  violatesRepeatedCheckCycle
} from '../src/repetitionRules.ts';

const entry = (mover, isCheck) => ({
  hash: `board/${mover === 'red' ? 'black' : 'red'}`,
  mover,
  isCheck
});

// Same shape as the reported game: check A, dodge, check B, return.
const threeCyclesBeforeReply = [
  { ...entry('red', false), hash: 'home/black' },
  { ...entry('black', true), hash: 'check-a/red' },
  { ...entry('red', false), hash: 'dodge/black' },
  { ...entry('black', true), hash: 'check-b/red' },
  { ...entry('red', false), hash: 'home/black' },
  { ...entry('black', true), hash: 'check-a/red' },
  { ...entry('red', false), hash: 'dodge/black' },
  { ...entry('black', true), hash: 'check-b/red' },
  { ...entry('red', false), hash: 'home/black' },
  { ...entry('black', true), hash: 'check-a/red' },
  { ...entry('red', false), hash: 'dodge/black' },
  { ...entry('black', true), hash: 'check-b/red' }
];

assert.equal(isReplyingToOpponentCheck(threeCyclesBeforeReply, 'red'), true);
const afterThirdReply = [
  ...threeCyclesBeforeReply,
  { ...entry('red', false), hash: 'home/black' }
];
assert.equal(countPositionOccurrences(afterThirdReply, 'home/black'), 4);
assert.equal(violatesRepeatedCheckCycle(afterThirdReply, 'check-a/red', true), true);
assert.equal(violatesRepeatedCheckCycle(afterThirdReply, 'different-check/red', true), false);
assert.equal(violatesRepeatedCheckCycle(afterThirdReply, 'check-a/red', false), false);

const legacyHistory = threeCyclesBeforeReply.map(({ mover: _mover, ...item }) => item);
assert.equal(isReplyingToOpponentCheck(legacyHistory, 'red'), true);

console.log('Repetition rule tests passed.');
