export const searchContext = {
  profile: false,
  collectMetrics: false,
  stagedMovePicker: true,
  trueStagedGeneration: true,
  playerRelativeMoveScan: true,
  reuseQsMoveBuffers: true,
  reusePackedQsCaptures: true,
  numericLeafSoA: true,
  lineOccupancyLookup: true,
  verifyLineOccupancyLookup: false,
  kingSafetyFastPath: true,
  // LMR：靠后的安静着先减深空窗搜索，fail-high 再全深回搜
  lmr: true,
  lmrMinDepth: 3,
  // 合法着序号 >= minMove 才 LMR；5 = 前 4 手全深（防守/冷着更不易被过早减深）
  lmrMinMove: 5,
  // 减深上限：原先公式在 d12 可减到只剩 1–2 层，战术漏着严重
  lmrMaxReduction: 2,
  // 树内 PVS：首着全窗，其后空窗探测，fail-high 再全窗回搜
  internalPvs: true,
  // NMP：仅在非 PV、未被将且仍有车马炮时尝试，禁止连续空步
  nmp: true,
  nmpMinDepth: 3,
  nmpReduction: 2,
  preserveTtAcrossSearches: true,
  currentGenerationTtPriority: true,
  ttMaxAge: 1,
  ttReuseScope: 'default',
  ttSearchPly: 0,
  collectMoveSequence: true,
  /** @type {null | ((info: Record<string, unknown>) => void)} */
  reportSearchProgress: null
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
  lineOccupancyLookup = true,
  verifyLineOccupancyLookup = false,
  kingSafetyFastPath = true,
  lmr = true,
  lmrMinDepth = 3,
  lmrMinMove = 5,
  lmrMaxReduction = 2,
  internalPvs = true,
  nmp = true,
  nmpMinDepth = 3,
  nmpReduction = 2,
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
  searchContext.lineOccupancyLookup = !!lineOccupancyLookup;
  searchContext.verifyLineOccupancyLookup = !!verifyLineOccupancyLookup;
  searchContext.kingSafetyFastPath = !!kingSafetyFastPath;
  searchContext.lmr = !!lmr;
  searchContext.lmrMinDepth = Math.max(2, lmrMinDepth | 0);
  searchContext.lmrMinMove = Math.max(2, lmrMinMove | 0);
  searchContext.lmrMaxReduction = Math.max(1, lmrMaxReduction | 0);
  searchContext.internalPvs = !!internalPvs;
  searchContext.nmp = !!nmp;
  searchContext.nmpMinDepth = Math.max(2, nmpMinDepth | 0);
  searchContext.nmpReduction = Math.max(1, nmpReduction | 0);
  searchContext.preserveTtAcrossSearches = !!preserveTtAcrossSearches;
  searchContext.currentGenerationTtPriority = !!currentGenerationTtPriority;
  searchContext.ttMaxAge = Math.max(1, ttMaxAge | 0);
  searchContext.ttReuseScope = ttReuseScope == null ? null : String(ttReuseScope);
  searchContext.ttSearchPly = Math.max(0, ply | 0);
};
