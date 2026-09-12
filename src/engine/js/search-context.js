export let searchProfile = false;
export let collectSearchMetrics = false;
export let searchLmrMinDepth = 3;
export let searchLmrMinMove = 5;
export let searchLmrMaxReduction = 2;
export let searchNmpMinDepth = 3;
export let searchNmpReduction = 2;

export const searchContext = {
  profile: searchProfile,
  collectMetrics: collectSearchMetrics,
  // LMR：靠后的安静着先减深空窗搜索，fail-high 再全深回搜
  lmrMinDepth: searchLmrMinDepth,
  // 合法着序号 >= minMove 才 LMR；5 = 前 4 手全深（防守/冷着更不易被过早减深）
  lmrMinMove: searchLmrMinMove,
  // 减深上限：原先公式在 d12 可减到只剩 1–2 层，战术漏着严重
  lmrMaxReduction: searchLmrMaxReduction,
  // NMP：仅在非 PV、未被将且仍有车马炮时尝试，禁止连续空步
  nmpMinDepth: searchNmpMinDepth,
  nmpReduction: searchNmpReduction,
  ttMaxAge: 1,
  ttReuseScope: 'default',
  ttSearchPly: 0,
  // 分析最后一层精确回搜的根着法数量；0=不限制
  exactRootLimit: 0,
  /** @type {null | ((info: Record<string, unknown>) => void)} */
  reportSearchProgress: null
};

export const configureSearch = ({
  profile = false,
  metrics = false,
  lmrMinDepth = 3,
  lmrMinMove = 5,
  lmrMaxReduction = 2,
  nmpMinDepth = 3,
  nmpReduction = 2,
  ttMaxAge = 1,
  ttReuseScope = 'default',
  ply = 0,
  exactRootLimit = 0
} = {}) => {
  searchProfile = !!profile;
  collectSearchMetrics = !!metrics;
  searchLmrMinDepth = Math.max(2, lmrMinDepth | 0);
  searchLmrMinMove = Math.max(2, lmrMinMove | 0);
  searchLmrMaxReduction = Math.max(1, lmrMaxReduction | 0);
  searchNmpMinDepth = Math.max(2, nmpMinDepth | 0);
  searchNmpReduction = Math.max(1, nmpReduction | 0);
  searchContext.profile = searchProfile;
  searchContext.collectMetrics = collectSearchMetrics;
  searchContext.lmrMinDepth = searchLmrMinDepth;
  searchContext.lmrMinMove = searchLmrMinMove;
  searchContext.lmrMaxReduction = searchLmrMaxReduction;
  searchContext.nmpMinDepth = searchNmpMinDepth;
  searchContext.nmpReduction = searchNmpReduction;
  searchContext.ttMaxAge = Math.max(1, ttMaxAge | 0);
  searchContext.ttReuseScope = ttReuseScope == null ? null : String(ttReuseScope);
  searchContext.ttSearchPly = Math.max(0, ply | 0);
  searchContext.exactRootLimit = Math.max(0, exactRootLimit | 0);
};
