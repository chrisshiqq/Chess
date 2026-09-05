export type Color = 'red' | 'black';

export type PieceType =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'chariot'
  | 'cannon'
  | 'soldier';

export interface Piece {
  type: PieceType;
  color: Color;
}

export interface Position {
  r: number;
  c: number;
}

export interface Move {
  from: Position;
  to: Position;
  score?: number;
}

export type Board = (Piece | null)[][];

export interface GameStatusResult {
  status: 'playing' | 'checkmate' | 'stalemate' | 'setup' | 'draw';
  winner?: Color;
}

export interface GameState {
  board: Board;
  turn: Color;
  selected: Position | null;
  validMoves: Position[];
  winner: Color | null;
  history: Board[];
}

// 与搜索 squareCodes / 棋谱局面相同：0 空，红 1–7，黑 9–15（1将 2车 3马 4象 5仕 6炮 7兵）。
export type CompactBoard = number[][];
export type CompactBoardRow = number[];
