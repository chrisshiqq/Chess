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

// UI/worker wire format: -1 is empty; red pieces are 0-6 and black are 7-13.
export type CompactBoard = number[][];
export type CompactBoardRow = number[];
