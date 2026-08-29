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
): boolean => isReplyingToOpponentInitiative(history, mover, 'check');

/** 上一手是对方发起的长将或长捉，本方这步是被动应对，不须变招。 */
export const isReplyingToOpponentInitiative = (
  history: PositionHistoryEntry[],
  mover: Color,
  kind: 'check' | 'chase' | 'either' = 'either'
): boolean => {
  const previous = history[history.length - 1];
  if (!previous) return false;
  if (kind === 'check' && !previous.isCheck) return false;
  if (kind === 'chase' && !previous.isChase) return false;
  if (kind === 'either' && !previous.isCheck && !previous.isChase) return false;
  const previousMover = previous.mover || inferMoverFromHash(previous.hash);
  return previousMover != null && previousMover !== mover;
};
