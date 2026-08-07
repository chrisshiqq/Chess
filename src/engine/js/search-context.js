export const searchContext = {
  profile: false,
  collectMetrics: false,
  stagedMovePicker: true,
  trueStagedGeneration: true,
  playerRelativeMoveScan: true,
  reuseQsMoveBuffers: true,
  reusePackedQsCaptures: true,
  numericLeafSoA: true,
  kingSafetyFastPath: true,
  preserveTtAcrossSearches: true,
  currentGenerationTtPriority: true,
  ttMaxAge: 1,
  ttReuseScope: 'default',
  ttSearchPly: 0,
  collectMoveSequence: true
};

export const configureSearch = ({
  profile = false,
  metrics = false,
  stagedMovePicker = true,
  trueStagedGeneration = true,
  playerRelativeMoveScan = true,
  reuseQsMoveBuffers = true,
  reusePackedQsCaptures = true,
  numericLeafSoA = true,
  kingSafetyFastPath = true,
  preserveTtAcrossSearches = true,
  currentGenerationTtPriority = true,
  ttMaxAge = 1,
  ttReuseScope = 'default',
  ply = 0
} = {}) => {
  searchContext.profile = !!profile;
  searchContext.collectMetrics = !!metrics;
  searchContext.stagedMovePicker = !!stagedMovePicker;
  searchContext.trueStagedGeneration = !!trueStagedGeneration;
  searchContext.playerRelativeMoveScan = !!playerRelativeMoveScan;
  searchContext.reuseQsMoveBuffers = !!reuseQsMoveBuffers;
  searchContext.reusePackedQsCaptures = !!reusePackedQsCaptures;
  searchContext.numericLeafSoA = !!numericLeafSoA;
  searchContext.kingSafetyFastPath = !!kingSafetyFastPath;
  searchContext.preserveTtAcrossSearches = !!preserveTtAcrossSearches;
  searchContext.currentGenerationTtPriority = !!currentGenerationTtPriority;
  searchContext.ttMaxAge = Math.max(1, ttMaxAge | 0);
  searchContext.ttReuseScope = ttReuseScope == null ? null : String(ttReuseScope);
  searchContext.ttSearchPly = Math.max(0, ply | 0);
};
