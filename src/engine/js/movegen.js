import { COLS, SQ_COL, SQ_ROW } from './board.js';

export const MOVE_TO_MASK = 0x7f;
export const encodeMove = (from, to) => ((from.r * COLS + from.c) << 7) | (to.r * COLS + to.c);
export const encodeMoveFromCoords = (fr, fc, tr, tc) => ((fr * COLS + fc) << 7) | (tr * COLS + tc);
export const isEncodedMove = (move) => typeof move === 'number';
export const moveFromSq = (move) => isEncodedMove(move) ? (move >>> 7) : move.from.r * COLS + move.from.c;
export const moveToSq = (move) => isEncodedMove(move) ? (move & MOVE_TO_MASK) : move.to.r * COLS + move.to.c;
export const moveFromR = (move) => SQ_ROW[moveFromSq(move)];
export const moveFromC = (move) => SQ_COL[moveFromSq(move)];
export const moveToR = (move) => SQ_ROW[moveToSq(move)];
export const moveToC = (move) => SQ_COL[moveToSq(move)];

export const moveToObject = (move) => {
  if (!isEncodedMove(move)) return move;
  const from = moveFromSq(move);
  const to = moveToSq(move);
  return {
    from: { r: SQ_ROW[from], c: SQ_COL[from] },
    to: { r: SQ_ROW[to], c: SQ_COL[to] }
  };
};

export { getValidMoves } from './search.js';

