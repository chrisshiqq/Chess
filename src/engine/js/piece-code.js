// 棋子唯一编码：与搜索 squareCodes / 存档 / 棋谱局面相同。
// 0 空；红 1–7；黑 9–15（类型 + 8）。8 不用。
// 类型：1将 2车 3马 4象 5仕 6炮 7兵

export const PIECE_EMPTY = 0;

export const SEARCH_TYPE = Object.freeze({
    general: 1,
    chariot: 2,
    horse: 3,
    elephant: 4,
    advisor: 5,
    cannon: 6,
    soldier: 7
});

export const SEARCH_TYPE_NAME = Object.freeze([
    '', 'general', 'chariot', 'horse', 'elephant', 'advisor', 'cannon', 'soldier'
]);

// 搜索码 → Zobrist 下标（将仕象马车炮兵，黑 +7）
export const SEARCH_CODE_TO_ZOBRIST = new Int8Array([
    -1, 0, 4, 3, 2, 1, 5, 6,
    -1, 7, 11, 10, 9, 8, 12, 13
]);

export const pieceToSearchCode = (piece) => {
    if (!piece) return PIECE_EMPTY;
    const type = SEARCH_TYPE[piece.type];
    if (!type) return PIECE_EMPTY;
    return type + (piece.color === 'red' ? 0 : 8);
};

export const searchCodeToPiece = (code) => {
    const type = SEARCH_TYPE_NAME[code & 7];
    if (!type) return null;
    return { type, color: code < 8 ? 'red' : 'black' };
};

export const isCompactBoard = (board) => {
    if (!Array.isArray(board)) return false;
    for (let r = 0; r < board.length; r++) {
        const row = board[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (typeof cell === 'number') return true;
            if (cell != null) return false;
        }
    }
    return false;
};

export const cellToSearchCode = (cell) => {
    if (cell == null) return PIECE_EMPTY;
    if (typeof cell === 'number') {
        return (cell < 1 || cell === 8 || cell > 15) ? PIECE_EMPTY : cell;
    }
    return pieceToSearchCode(cell);
};

export const searchCodeToKey = (code) => {
    const name = SEARCH_TYPE_NAME[code & 7];
    if (!name) return '';
    return (code < 8 ? 'red-' : 'black-') + name;
};

export const SEARCH_HASH_SYMBOL = Object.freeze(['', 'G', 'R', 'H', 'E', 'A', 'C', 'S']);

export const createInitialSearchBoard = () => {
    const board = Array.from({ length: 10 }, () => Array(9).fill(0));
    const back = [2, 3, 4, 5, 1, 5, 4, 3, 2];
    for (let c = 0; c < 9; c++) {
        board[0][c] = back[c];
        board[9][c] = back[c] + 8;
    }
    board[2][1] = 6;
    board[2][7] = 6;
    board[7][1] = 14;
    board[7][7] = 14;
    for (let c = 0; c < 9; c += 2) {
        board[3][c] = 7;
        board[6][c] = 15;
    }
    return board;
};

export const encodeBoardToSearchCodes = (board) => {
    const out = new Array(10);
    for (let r = 0; r < 10; r++) {
        const src = board[r];
        const row = new Array(9);
        for (let c = 0; c < 9; c++) {
            row[c] = cellToSearchCode(src ? src[c] : null);
        }
        out[r] = row;
    }
    return out;
};
