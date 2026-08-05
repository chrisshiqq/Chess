import type { Board, CompactBoard, Piece, PieceType } from '../types';
import type { WireBoard } from './protocol';

const PIECE_TYPES: PieceType[] = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier'
];

const isCompactBoard = (board: WireBoard): board is CompactBoard => {
  for (const row of board) {
    for (const square of row) {
      if (typeof square === 'number') return true;
      if (square !== null) return false;
    }
  }
  return false;
};

export const encodeBoard = (board: Board): CompactBoard => board.map((row) =>
  row.map((piece) => piece == null
    ? -1
    : PIECE_TYPES.indexOf(piece.type) + (piece.color === 'black' ? PIECE_TYPES.length : 0))
);

export const decodeBoard = (board: WireBoard): Board => {
  if (!Array.isArray(board) || board.length !== 10 || board.some((row) => !Array.isArray(row) || row.length !== 9)) {
    throw new TypeError('Invalid board shape');
  }
  if (!isCompactBoard(board)) return board;

  return board.map((row) => row.map((code) => {
    if (code === -1) return null;
    if (!Number.isInteger(code) || code < 0 || code >= PIECE_TYPES.length * 2) {
      throw new TypeError(`Invalid compact piece code: ${code}`);
    }
    return {
      type: PIECE_TYPES[code % PIECE_TYPES.length],
      color: code < PIECE_TYPES.length ? 'red' : 'black'
    } as Piece;
  }));
};

export const formatMove = (move: { from?: { r: number; c: number }; to?: { r: number; c: number } } | null | undefined): string =>
  move?.from && move?.to
    ? `(${move.from.r},${move.from.c})->(${move.to.r},${move.to.c})`
    : 'none';

