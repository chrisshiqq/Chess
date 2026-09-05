import type { Board, CompactBoard, Move, Piece } from '../domain/types';
import type { EncodedMove, WireBoard } from './protocol';
import {
    cellToSearchCode,
    encodeBoardToSearchCodes,
    isCompactBoard,
    searchCodeToPiece
} from './js/piece-code.js';

export const encodeBoard = (board: WireBoard): CompactBoard => encodeBoardToSearchCodes(board);

export const decodeBoard = (board: WireBoard): Board => {
  if (!Array.isArray(board) || board.length !== 10 || board.some((row) => !Array.isArray(row) || row.length !== 9)) {
    throw new TypeError('Invalid board shape');
  }
  if (!isCompactBoard(board)) return board;

  return board.map((row) => row.map((code) => {
    if (typeof code !== 'number') return code as Piece | null;
    return searchCodeToPiece(cellToSearchCode(code)) as Piece | null;
  }));
};

const MOVE_TO_MASK = 0x7f;

export const decodeSquare = (sq: number): { r: number; c: number } => ({
  r: (sq / 9) | 0,
  c: sq % 9
});

export const decodeSquares = (squares: number[] | null | undefined): Array<{ r: number; c: number }> => {
  if (!squares || squares.length === 0) return [];
  const decoded: Array<{ r: number; c: number }> = [];
  for (let i = 0; i < squares.length; i++) {
    decoded.push(decodeSquare(squares[i]));
  }
  return decoded;
};

export const decodeMove = (move: EncodedMove | Move | null | undefined): Move | null => {
  if (move == null) return null;
  if (typeof move !== 'number') return move;
  const from = move >>> 7;
  const to = move & MOVE_TO_MASK;
  return {
    from: { r: (from / 9) | 0, c: from % 9 },
    to: { r: (to / 9) | 0, c: to % 9 }
  };
};

export const decodeMoves = (moves: Array<EncodedMove | Move> | null | undefined): Move[] => {
  if (!moves || moves.length === 0) return [];
  const decoded: Move[] = [];
  for (let i = 0; i < moves.length; i++) {
    const move = decodeMove(moves[i]);
    if (move) decoded.push(move);
  }
  return decoded;
};

export const decodeAnalysisMoves = (
  rows: Array<{ move: EncodedMove | Move; score: number; moveSequence?: Array<EncodedMove | Move> }> | null | undefined
): Array<{ move: Move; score: number; moveSequence: Move[] }> => {
  if (!rows || rows.length === 0) return [];
  const decoded: Array<{ move: Move; score: number; moveSequence: Move[] }> = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const move = decodeMove(row.move);
    if (!move) continue;
    decoded.push({
      move,
      score: row.score,
      moveSequence: decodeMoves(row.moveSequence)
    });
  }
  return decoded;
};

export const previewMove = (move: EncodedMove | Move | null | undefined): string => {
  const decoded = decodeMove(move);
  return decoded?.from && decoded?.to
    ? `${decoded.from.r},${decoded.from.c}->${decoded.to.r},${decoded.to.c}`
    : '';
};

export const formatMove = (
  move: EncodedMove | { from?: { r: number; c: number }; to?: { r: number; c: number } } | null | undefined
): string => {
  const decoded = typeof move === 'number' ? decodeMove(move) : move;
  return decoded?.from && decoded?.to
    ? `(${decoded.from.r},${decoded.from.c})->(${decoded.to.r},${decoded.to.c})`
    : 'none';
};
