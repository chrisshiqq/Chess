export const searchContext = {
  profile: false,
  collectMetrics: false,
  nonRootPvs: false,
  stagedMovePicker: true,
  trueStagedGeneration: true,
  verifyTrueStagedGeneration: false,
  reuseQsMoveBuffers: true,
  reusePackedQsCaptures: true,
  verifyPackedQsCaptures: false,
  numericLeafSoA: true,
  verifyNumericLeafSoA: false,
  kingSafetyFastPath: true,
  verifyKingSafetyFastPath: false,
  preserveTtAcrossSearches: true,
  ttMaxAge: 1,
  ttReuseScope: 'default',
  ttSearchPly: 0,
  collectMoveSequence: true
};

export const configureSearch = ({
  profile = false,
  metrics = false,
  nonRootPvs = false,
  stagedMovePicker = true,
  trueStagedGeneration = true,
  verifyTrueStagedGeneration = false,
  reuseQsMoveBuffers = true,
  reusePackedQsCaptures = true,
  verifyPackedQsCaptures = false,
  numericLeafSoA = true,
  verifyNumericLeafSoA = false,
  kingSafetyFastPath = true,
  verifyKingSafetyFastPath = false,
  preserveTtAcrossSearches = true,
  ttMaxAge = 1,
  ttReuseScope = 'default',
  ply = 0
} = {}) => {
  searchContext.profile = !!profile;
  searchContext.collectMetrics = !!metrics;
  searchContext.nonRootPvs = !!nonRootPvs;
  searchContext.stagedMovePicker = !!stagedMovePicker;
  searchContext.trueStagedGeneration = !!trueStagedGeneration;
  searchContext.verifyTrueStagedGeneration = !!verifyTrueStagedGeneration;
  searchContext.reuseQsMoveBuffers = !!reuseQsMoveBuffers;
  searchContext.reusePackedQsCaptures = !!reusePackedQsCaptures;
  searchContext.verifyPackedQsCaptures = !!verifyPackedQsCaptures;
  searchContext.numericLeafSoA = !!numericLeafSoA;
  searchContext.verifyNumericLeafSoA = !!verifyNumericLeafSoA;
  searchContext.kingSafetyFastPath = !!kingSafetyFastPath;
  searchContext.verifyKingSafetyFastPath = !!verifyKingSafetyFastPath;
  searchContext.preserveTtAcrossSearches = !!preserveTtAcrossSearches;
  searchContext.ttMaxAge = Math.max(1, ttMaxAge | 0);
  searchContext.ttReuseScope = ttReuseScope == null ? null : String(ttReuseScope);
  searchContext.ttSearchPly = Math.max(0, ply | 0);
};
