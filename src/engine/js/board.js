export const ROWS = 10;
export const COLS = 9;
export const REL_SQUARES = ROWS * COLS;

export const PIECE_TYPES = Object.freeze({
  GENERAL: 'general',
  CHARIOT: 'chariot',
  CANNON: 'cannon',
  HORSE: 'horse',
  ELEPHANT: 'elephant',
  ADVISOR: 'advisor',
  SOLDIER: 'soldier'
});

export const SQ_ROW = new Uint8Array(REL_SQUARES);
export const SQ_COL = new Uint8Array(REL_SQUARES);

for (let sq = 0; sq < REL_SQUARES; sq++) {
  SQ_ROW[sq] = (sq / COLS) | 0;
  SQ_COL[sq] = sq % COLS;
}

// isBoardShape removed (unused)

