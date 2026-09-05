import { VALUE_WEIGHTS } from './search.js';

export const evaluatePieceInfo = (pieceInfo) => ({
  material: pieceInfo.materialValue * VALUE_WEIGHTS.material,
  position: pieceInfo.positionValue * VALUE_WEIGHTS.position,
  mobility: pieceInfo.mobilityValue * VALUE_WEIGHTS.mobility,
  threat: pieceInfo.threatValue * VALUE_WEIGHTS.threat,
  safety: pieceInfo.safetyValue * VALUE_WEIGHTS.safety
});

export {
  VALUE_WEIGHTS,
  evaluateBoard,
  evaluatePiece,
  getGamePhase,
  hydrateRelationsFromMasks,
  setValueWeights
} from './search.js';
