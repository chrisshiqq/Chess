const ADVISOR_SQUARES = {
  red: new Set(['0,3', '0,5', '1,4', '2,3', '2,5']),
  black: new Set(['7,3', '7,5', '8,4', '9,3', '9,5'])
};

const ELEPHANT_SQUARES = {
  red: new Set(['0,2', '0,6', '2,0', '2,4', '2,8', '4,2', '4,6']),
  black: new Set(['5,2', '5,6', '7,0', '7,4', '7,8', '9,2', '9,6'])
};

export const isValidPlacement = (type, color, r, c) => {
  const isRed = color === 'red';
  switch (type) {
    case 'general':
      return c >= 3 && c <= 5 && (isRed ? r >= 0 && r <= 2 : r >= 7 && r <= 9);
    case 'advisor':
      return ADVISOR_SQUARES[color].has(`${r},${c}`);
    case 'elephant':
      return ELEPHANT_SQUARES[color].has(`${r},${c}`);
    case 'soldier': {
      const crossedRiver = isRed ? r >= 5 : r <= 4;
      if (crossedRiver) return true;
      if ((c & 1) !== 0) return false;
      return isRed ? r === 3 || r === 4 : r === 5 || r === 6;
    }
    default:
      return true;
  }
};

export {
  checkGameState,
  isCheck,
  syncGeneralPosCache
} from './search.js';

