/** @typedef {import('./types').Board} Board */
/** @typedef {import('./types').Color} Color */

const POSITION_HASH_SYMBOLS = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  horse: 'H',
  chariot: 'R',
  cannon: 'C',
  soldier: 'S'
};

/**
 * @param {Board} board
 * @param {Color} turn
 */
export const generatePositionHash = (board, turn) => {
  let hash = '';
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const piece = board[r][c];
      if (!piece) {
        hash += '.';
        continue;
      }
      const symbol = POSITION_HASH_SYMBOLS[piece.type];
      hash += piece.color === 'red' ? symbol : symbol.toLowerCase();
    }
    hash += '/';
  }
  return hash + turn;
};
