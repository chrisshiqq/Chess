/** @typedef {import('./types').Board} Board */
/** @typedef {import('./types').Color} Color */

import { SEARCH_HASH_SYMBOL, cellToSearchCode } from '../engine/js/piece-code.js';

/**
 * @param {Board} board
 * @param {Color} turn
 */
export const generatePositionHash = (board, turn) => {
  let hash = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const code = cellToSearchCode(board[r][c]);
      if (!code) {
        hash += '.';
        continue;
      }
      const symbol = SEARCH_HASH_SYMBOL[code & 7];
      hash += code < 8 ? symbol : symbol.toLowerCase();
    }
    hash += '/';
  }
  return hash + turn;
};
