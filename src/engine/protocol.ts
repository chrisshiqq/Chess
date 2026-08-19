import type { Board, Color, CompactBoard, Move, PieceType, Position } from '../domain/types';

export type WireBoard = Board | CompactBoard;

export interface SearchOptions {
  board: WireBoard;
  turn: Color;
  depth: number;
  gameId: number;
  openingBookEnabled?: boolean;
  ply?: number;
  enableTimeLimit?: boolean;
  exactRootScores?: boolean;
  excludedRootMoves?: Move[];
  profile?: boolean;
  metrics?: boolean;
  lmrMinDepth?: number;
  lmrMinMove?: number;
  lmrMaxReduction?: number;
  nmpMinDepth?: number;
  nmpReduction?: number;
  ttMaxAge?: number;
}

export type WorkerRequest =
  | { type: 'SEARCH'; payload: SearchOptions }
  | { type: 'getValidMoves'; payload: { board: WireBoard; pos: Position; requestId: string } }
  | { type: 'getPieceRelations'; payload: { board: WireBoard; pos: Position; requestId: string } }
  | {
      type: 'inspectSquare';
      payload: {
        board: WireBoard;
        pos: Position;
        turn: Color | null;
        needMoves?: boolean;
        requestId: string;
      };
    }
  | { type: 'checkGameState'; payload: { board: WireBoard; turn: Color; requestId: string } }
  | { type: 'evaluateBoard'; payload: { board: WireBoard; turn: Color | null; requestId: string; isReplay?: boolean; depth?: number } }
  | { type: 'evaluatePiece'; payload: { board: WireBoard; pos: Position; turn: Color | null; requestId: string } }
  | { type: 'isCheck'; payload: { board: WireBoard; color: Color; requestId: string } }
  | { type: 'isValidPlacement'; payload: { type: PieceType; color: Color; r: number; c: number; requestId: string } }
  | { type: 'addOpeningLineFromString'; payload: { moves: string; weights?: number[] } }
  | { type: 'movesToNotation'; payload: { boardHistory: Board[]; moveHistory: Move[]; requestId: string } }
  | { type: 'notationToMoves'; payload: { notation: string | string[]; initialBoard?: WireBoard; requestId: string } }
  | { type: 'setValueWeights'; payload: Partial<Record<'material' | 'position' | 'threat' | 'safety' | 'mobility', number>> };

export interface SearchMoveScore {
  move: Move;
  score: number;
  moveSequence: Move[];
}

export interface SearchCompletePayload {
  bestMove: Move | null;
  secondBestMove: Move | null;
  gameId: number;
  fromBook: boolean;
  thinkingTime: number;
  moveSequence: Move[];
  secondMoveSequence: Move[];
  bestMoveScore: number;
  secondBestMoveScore: number;
  allMovesWithScores: SearchMoveScore[];
  completedDepth?: number;
  perf: unknown;
}

export interface SearchProgressPayload {
  gameId: number;
  phase: 'root-eval' | 'start' | 'depth' | 'book';
  turn?: Color;
  maxDepth?: number;
  completedDepth?: number;
  rootMoves?: number;
  bestMove?: Move | null;
  score?: number;
  elapsedMs?: number;
}

export type WorkerResponse =
  | { type: 'SEARCH_STARTED'; payload: { gameId: number; turn: Color; depth: number; ply: number; enableTimeLimit: boolean } }
  | { type: 'SEARCH_PROGRESS'; payload: SearchProgressPayload }
  | { type: 'SEARCH_COMPLETE'; payload: SearchCompletePayload }
  | { type: 'validMoves'; moves: Position[]; requestId: string }
  | { type: 'pieceRelations'; relations: unknown; requestId: string }
  | {
      type: 'squareInspected';
      requestId: string;
      moves: Position[];
      evaluation: unknown;
      relations: unknown;
    }
  | { type: 'gameState'; state: unknown; requestId: string }
  | { type: 'detailedEvaluation'; evaluation: unknown; requestId: string }
  | { type: 'pieceEvaluation'; evaluation: unknown; requestId: string }
  | { type: 'check'; isCheck: boolean; requestId: string }
  | { type: 'validPlacement'; isValid: boolean; requestId: string }
  | { type: 'openingLineAdded'; success: boolean }
  | { type: 'notation'; notation: string | string[]; requestId: string }
  | { type: 'moves'; moves: Move[]; requestId: string }
  | { type: 'log'; data: string }
  | { type: 'WORKER_ERROR'; error: string; requestType?: string; requestId?: string };
