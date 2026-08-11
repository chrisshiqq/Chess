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
  profile?: boolean;
  metrics?: boolean;
  stagedMovePicker?: boolean;
  trueStagedGeneration?: boolean;
  playerRelativeMoveScan?: boolean;
  reuseQsMoveBuffers?: boolean;
  reusePackedQsCaptures?: boolean;
  lineOccupancyLookup?: boolean;
  verifyLineOccupancyLookup?: boolean;
  kingSafetyFastPath?: boolean;
  lmr?: boolean;
  lmrMinDepth?: number;
  lmrMinMove?: number;
  lmrMaxReduction?: number;
  nmp?: boolean;
  nmpMinDepth?: number;
  nmpReduction?: number;
  preserveTtAcrossSearches?: boolean;
  currentGenerationTtPriority?: boolean;
  ttMaxAge?: number;
  collectMoveSequence?: boolean;
}

export type WorkerRequest =
  | { type: 'SEARCH'; payload: SearchOptions }
  | { type: 'getValidMoves'; payload: { board: WireBoard; pos: Position; requestId?: string } }
  | { type: 'getPieceRelations'; payload: { board: WireBoard; pos: Position } }
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
  | { type: 'checkGameState'; payload: { board: WireBoard; turn: Color; requestId?: number } }
  | { type: 'evaluateBoard'; payload: { board: WireBoard; turn: Color | null } }
  | { type: 'evaluatePiece'; payload: { board: WireBoard; pos: Position; turn: Color | null } }
  | { type: 'isCheck'; payload: { board: WireBoard; color: Color; requestId?: number } }
  | { type: 'isValidPlacement'; payload: { type: PieceType; color: Color; r: number; c: number } }
  | { type: 'addOpeningLineFromString'; payload: { moves: string; weights?: number[] } }
  | { type: 'movesToNotation'; payload: { boardHistory: Board[]; moveHistory: Move[] } }
  | { type: 'notationToMoves'; payload: { notation: string; initialBoard: WireBoard } }
  | { type: 'setValueWeights'; payload: Partial<Record<'material' | 'position' | 'threat' | 'tactic' | 'safety' | 'mobility', number>> };

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
  | { type: 'validMoves'; moves: Position[]; requestId?: string }
  | { type: 'pieceRelations'; relations: unknown }
  | {
      type: 'squareInspected';
      requestId: string;
      moves: Position[];
      evaluation: unknown;
      relations: unknown;
    }
  | { type: 'gameState'; state: unknown; requestId?: number }
  | { type: 'detailedEvaluation'; evaluation: unknown }
  | { type: 'pieceEvaluation'; evaluation: unknown }
  | { type: 'check'; isCheck: boolean; requestId?: number }
  | { type: 'validPlacement'; isValid: boolean }
  | { type: 'openingLineAdded'; success: boolean }
  | { type: 'notation'; notation: string | string[] }
  | { type: 'moves'; moves: Move[] }
  | { type: 'log'; data: string }
  | { type: 'WORKER_ERROR'; error: string; requestType?: string };
