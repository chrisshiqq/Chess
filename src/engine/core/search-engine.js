import {
    configureSearch,
    noopSearchProgress,
    searchContext
} from './search-config.js';
import {
    getAnalysisMove,
    getPlayMove,
    openingBook,
    snapshotPerfStats
} from '../js/search.js';

const configureEngine = (options = {}, progress = noopSearchProgress) => {
    configureSearch(options);
    searchContext.reportSearchProgress = progress;
    openingBook.setEnabled(options.openingBookEnabled ?? true);
};

const finishEngineSearch = () => {
    searchContext.reportSearchProgress = noopSearchProgress;
};

export const createSearchEngine = ({ progress = noopSearchProgress } = {}) => ({
    search(mode, options) {
        return mode === 'analysis'
            ? this.analysis(options)
            : this.play(options);
    },

    play(options) {
        configureEngine(options, options.progress ?? progress);
        try {
            return getPlayMove(
                options.board,
                options.turn,
                options.depth,
                options.ply ?? 0,
                options.excludedRootMoves ?? []
            );
        } finally {
            finishEngineSearch();
        }
    },

    analysis(options) {
        configureEngine(options, options.progress ?? progress);
        try {
            return getAnalysisMove(
                options.board,
                options.turn,
                options.depth,
                options.ply ?? 0,
                options.excludedRootMoves ?? []
            );
        } finally {
            finishEngineSearch();
        }
    },

    snapshotPerfStats
});
