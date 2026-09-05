import { COLS } from './board.js';

export const MOVE_TO_MASK = 0x7f;
export const encodeMove = (from, to) => ((from.r * COLS + from.c) << 7) | (to.r * COLS + to.c);
export const isEncodedMove = (move) => typeof move === 'number';
export const moveFromSq = (move) => isEncodedMove(move) ? (move >>> 7) : move.from.r * COLS + move.from.c;
export const moveToSq = (move) => isEncodedMove(move) ? (move & MOVE_TO_MASK) : move.to.r * COLS + move.to.c;

export { getValidMoves } from './search.js';
