import type { Color, PieceType, Position } from './types';

export { generatePositionHash } from './position-hash.js';

export type PositionHistoryEntry = {
  hash: string;
  mover?: Color;
  capturedTarget?: { type: PieceType; position: Position };
  initiator?: Color;
  isCheck?: boolean;
  isChase?: boolean;
};

const inferMoverFromHash = (hash: string): Color | undefined => {
  const nextTurn = hash.slice(hash.lastIndexOf('/') + 1);
  if (nextTurn === 'red') return 'black';
  if (nextTurn === 'black') return 'red';
  return undefined;
};

export const getForbiddenRepeatedCheckHashes = (
  history: PositionHistoryEntry[],
  mover: Color,
  limit = 4
): string[] => {
  const threshold = Math.max(1, limit - 1);
  const counts = new Map<string, number>();
  const checkingHashes = new Set<string>();

  for (const entry of history) {
    counts.set(entry.hash, (counts.get(entry.hash) ?? 0) + 1);
    const entryMover = entry.mover ?? inferMoverFromHash(entry.hash);
    if (entry.isCheck && entryMover === mover) checkingHashes.add(entry.hash);
  }

  return [...checkingHashes].filter(
    (hash) => (counts.get(hash) ?? 0) >= threshold
  );
};

export const countPositionOccurrences = (
  history: PositionHistoryEntry[],
  hash: string
): number => history.reduce((count, entry) => count + (entry.hash === hash ? 1 : 0), 0);

export const violatesRepeatedCheckCycle = (
  history: PositionHistoryEntry[],
  resultingHash: string,
  candidateIsCheck: boolean,
  limit = 4
): boolean => candidateIsCheck && countPositionOccurrences(history, resultingHash) + 1 >= limit;

export const isReplyingToOpponentCheck = (
  history: PositionHistoryEntry[],
  mover: Color
): boolean => {
  const previous = history[history.length - 1];
  if (!previous?.isCheck) return false;
  const previousMover = previous.mover || inferMoverFromHash(previous.hash);
  return previousMover != null && previousMover !== mover;
};
