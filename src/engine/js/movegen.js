import { COLS } from './board.js';

export const MOVE_TO_MASK = 0x7f;
export const encodeMove = (from, to) => ((from.r * COLS + from.c) << 7) | (to.r * COLS + to.c);

export { getValidMoves } from './search-ui.js';
