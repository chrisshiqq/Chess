export type Color = 'red' | 'black';

export type PieceType = 
  | 'general'  // Jiang/Shuai
  | 'advisor'  // Shi
  | 'elephant' // Xiang
  | 'horse'    // Ma
  | 'chariot'  // Ju
  | 'cannon'   // Pao
  | 'soldier'; // Zu/Bing

export type Skin = 'stone-board' | 'wood-board' | 'paper-board' | 'glass-board';

export type PieceMaterial = 'wood' | 'stone' | 'metal' | 'glass';

export type DifficultyLevel = 'easy' | 'medium'| 'hard';

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
  score?: number; // For AI evaluation
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

// 紧凑棋盘格式：10行9列的二维数组，每个元素是-1（空）或0-13（棋子）
// 红方棋子：0-6，黑方棋子：7-13
// 类型映射：general:0/7, advisor:1/8, elephant:2/9, horse:3/10, chariot:4/11, cannon:5/12, soldier:6/13
export type CompactBoard = number[][];
// 紧凑棋盘的一行
export type CompactBoardRow = number[];