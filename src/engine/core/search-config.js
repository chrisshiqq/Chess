export let searchProfile = false;
export let collectSearchMetrics = false;
export let searchLmrMinDepth = 3;
export let searchLmrMinMove = 5;
export let searchLmrMaxReduction = 2;
export let searchNmpMinDepth = 3;
export let searchNmpReduction = 2;

/** @type {(info: Record<string, unknown>) => void} */
export const noopSearchProgress = () => {};

export const searchContext = {
    profile: searchProfile,
    collectMetrics: collectSearchMetrics,
    lmrMinDepth: searchLmrMinDepth,
    lmrMinMove: searchLmrMinMove,
    lmrMaxReduction: searchLmrMaxReduction,
    nmpMinDepth: searchNmpMinDepth,
    nmpReduction: searchNmpReduction,
    ttMaxAge: 1,
    ttReuseScope: 'default',
    ttSearchPly: 0,
    exactRootLimit: 0,
    reportSearchProgress: noopSearchProgress
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
