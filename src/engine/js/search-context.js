export const searchContext = {
  profile: false,
  collectMetrics: false,
  nonRootPvs: false,
  stagedMovePicker: true,
  reuseQsMoveBuffers: true,
  reusePackedQsCaptures: true,
  verifyPackedQsCaptures: false,
  kingSafetyFastPath: true,
  verifyKingSafetyFastPath: false,
  collectMoveSequence: true
};

export const configureSearch = ({
  profile = false,
  metrics = false,
  nonRootPvs = false,
  stagedMovePicker = true,
  reuseQsMoveBuffers = true,
  reusePackedQsCaptures = true,
  verifyPackedQsCaptures = false,
  kingSafetyFastPath = true,
  verifyKingSafetyFastPath = false
} = {}) => {
  searchContext.profile = !!profile;
  searchContext.collectMetrics = !!metrics;
  searchContext.nonRootPvs = !!nonRootPvs;
  searchContext.stagedMovePicker = !!stagedMovePicker;
  searchContext.reuseQsMoveBuffers = !!reuseQsMoveBuffers;
  searchContext.reusePackedQsCaptures = !!reusePackedQsCaptures;
  searchContext.verifyPackedQsCaptures = !!verifyPackedQsCaptures;
  searchContext.kingSafetyFastPath = !!kingSafetyFastPath;
  searchContext.verifyKingSafetyFastPath = !!verifyKingSafetyFastPath;
};

