export const VALUE_WEIGHTS = {
  material: 1,
  position: 1,
  threat: 1,
  safety: 1,
  mobility: 1
};

export const setValueWeights = (weights) => {
  Object.assign(VALUE_WEIGHTS, weights);
};

export const evaluatePieceInfo = (pieceInfo) => ({
  material: pieceInfo.materialValue * VALUE_WEIGHTS.material,
  position: pieceInfo.positionValue * VALUE_WEIGHTS.position,
  mobility: pieceInfo.mobilityValue * VALUE_WEIGHTS.mobility,
  threat: pieceInfo.threatValue * VALUE_WEIGHTS.threat,
  safety: pieceInfo.safetyValue * VALUE_WEIGHTS.safety
});

export {
  evaluateBoard,
  evaluateBoardForUi,
  getGamePhase,
  hydrateRelationsFromMasks
} from './search.js';

