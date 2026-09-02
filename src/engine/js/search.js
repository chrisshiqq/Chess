/* eslint-disable no-restricted-globals */

import { COLS, PIECE_TYPES, REL_SQUARES, ROWS, SQ_COL, SQ_ROW } from './board.js';
import {
    MOVE_TO_MASK,
    encodeMove,
    encodeMoveFromCoords,
    isEncodedMove,
    moveFromC,
    moveFromR,
    moveFromSq,
    moveToC,
    moveToR,
    moveToSq
} from './movegen.js';
import { searchContext } from './search-context.js';
import { isValidPlacement } from './rules.js';

// 评估分项权重。必须放在本模块，不能从 evaluation.js 回引：
// Worker 先加载 evaluation.js 时，打包后顶层读 VALUE_WEIGHTS 会撞 TDZ。
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

// 材料值权重配置
const MATERIAL_VALUES = {
    general: 10000,  // 将/帅
    chariot: 900,     // 车
    cannon: {
        early: 450,    // 开局阶段
        mid: 400,      // 中局阶段
        late: 400      // 残局阶段
    },                // 炮
    horse: {
        early: 400,    // 开局阶段
        mid: 450,      // 中局阶段
        late: 450      // 残局阶段
    },                // 马
    elephant: 200,    // 象/相
    advisor: 200,     // 士/仕
    soldier: {
        early: 100,    // 开局阶段
        mid: 200,      // 中局阶段
        late: 450      // 残局阶段
    }                  // 兵/卒
};

// 评估算法参数配置 - 集中定义所有权重系数和加成数字
const EVALUATION_PARAMETERS = {
    // 机动值参数
    mobility: {
        baseMoveValue: 1,      // 基础移动价值
    },
    // 将军：仅作小额先手加分，禁止按将/帅材料值(10000)计入威胁/SEE
    check: {
        bonus: 80
    }
};

const CHECK_BONUS = EVALUATION_PARAMETERS.check.bonus;

// 位置评估表 - 基于棋子类型和位置
const POSITION_TABLES = {
    // 兵/卒位置表 (红方视角)
    soldier: [
        [0, 5, 10, 15, 20, 15, 10, 5, 0],
        [5, 15, 20, 25, 25, 25, 20, 15, 5],
        [10, 15, 20, 25, 25, 25, 20, 15, 10],
        [10, 15, 25, 30, 30, 30, 25, 15, 10],
        [10, 15, 20, 25, 25, 25, 20, 15, 10],
        [5, 0, 5, 0, 5, 0, 5, 0, 5],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    // 车位置表 (红方视角)
    chariot: [
        [5, 10, 10, 10, 10, 10, 10, 10, 5],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 15, 20, 20, 20, 20, 20, 15, 10],
        [10, 12, 15, 15, 15, 15, 15, 12, 10],
        [10, 12, 15, 15, 15, 15, 15, 12, 10],
        [5, 10, 8, 10, 5, 10, 8, 10, 5],
        [10, 10, 5, 15, 0, 15, 5, 10, 10],
        [0, 5, 10, 5, 5, 5, 10, 5, 0]
    ],
    // 马位置表 (红方视角)
    horse: [
        [0, -5, 0, 0, 0, 0, 0, -5, 0],
        [0, 5, 25, 10, 10, 10, 25, 5, 0],
        [5, 5, 20, 25, 25, 25, 20, 5, 5],
        [5, 20, 10, 25, 0, 25, 10, 20, 5],
        [0, 5, 15, 20, 20, 20, 15, 5, 0],
        [0, 5, 25, 20, 0, 20, 25, 5, 0],
        [0, 5, 10, 15, 15, 15, 10, 5, 0],
        [5, 0, 5, 5, 0, 5, 5, 0, 5],
        [0, 0, 0, 5, -20, 5, 0, 0, 0],
        [0, 0, 0, 5, 0, 5, 0, 0, 0]
    ],
    // 炮位置表 (红方视角)
    cannon: [
        [10, 20, 15, 10, 0, 10, 15, 20, 10],
        [0, 5, 5, 10, 10, 10, 5, 5, 0],
        [0, 5, 5, 10, 10, 10, 5, 5, 0],
        [5, 5, 15, 5, 25, 5, 15, 5, 5],
        [0, 5, 5, 5, 5, 5, 5, 5, 0],
        [0, 15, 5, 5, 10, 5, 5, 15, 0],
        [0, 5, 5, 5, 5, 5, 5, 5, 0],
        [10, 10, 15, 20, 30, 20, 15, 10, 10], 
        [0, 5, 5, 10, 10, 10, 5, 5, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ],
    // 象位置表 (红方视角)
    elephant: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 10, 0, 0, 0, 10, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [5, 0, 0, 0, 20, 0, 0, 0, 5],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 10, 0, 0, 0, 10, 0, 0]
    ],
    // 士位置表 (红方视角)
    advisor: [
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 5, 0, 5, 0, 0, 0],
        [0, 0, 0, 0, 10, 0, 0, 0, 0],
        [0, 0, 0, 10, 0, 10, 0, 0, 0]
    ]
};

// 获取棋子的材料值
const getMaterialValue = (piece, gameStage = 'mid') => {
    let value = MATERIAL_VALUES[piece.type];
    
    // 针对有分阶段材料值的兵种（兵、炮、马）调整材料值
    if (typeof value === 'object') {
        value = value[gameStage] || value.mid;
    }
    
    return value;
};

// 获取棋子的位置值
const getPositionValue = (piece, r, c) => {
    const table = POSITION_TABLES[piece.type];
    if (!table) return 0;
    
    // 黑方需要翻转位置表
    const rowIdx = piece.color === 'red' ? (9- r) : r;
    return table[rowIdx][c] || 0;
};

// Search leaves use numeric piece codes. Flatten position values once so the
// hot evaluator never has to dereference a piece object or a nested table.
const SEARCH_POSITION_VALUES = Array.from({ length: 16 }, () => new Int16Array(90));
(() => {
    const typeTables = [
        null,
        null,
        POSITION_TABLES.chariot,
        POSITION_TABLES.horse,
        POSITION_TABLES.elephant,
        POSITION_TABLES.advisor,
        POSITION_TABLES.cannon,
        POSITION_TABLES.soldier
    ];
    for (let pieceCode = 1; pieceCode < 16; pieceCode++) {
        const table = typeTables[pieceCode & 7];
        if (!table) continue;
        const isRed = pieceCode < 8;
        const values = SEARCH_POSITION_VALUES[pieceCode];
        for (let sq = 0; sq < 90; sq++) {
            const r = (sq / 9) | 0;
            values[sq] = table[isRed ? 9 - r : r][sq % 9] || 0;
        }
    }
})();

// 攻击位图：90 格用 3×Uint32。搜索叶只需「是否敌控」；点棋/UI 仍用控制者列表。
const ATTACK_WORDS = 3;
const scratchRedAttack = new Uint32Array(ATTACK_WORDS);
const scratchBlackAttack = new Uint32Array(ATTACK_WORDS);
// Packed destinations/rays and inlined relation writes for search leaves.
// 搜索期间维护紧凑棋子表，避免叶评估/着法准备反复扫描 10x9 对象棋盘。
// 仅基准诊断开启：额外 performance.now 会影响绝对耗时，正式对弈保持关闭。
const clearAttackBits = (bits) => {
    bits[0] = 0;
    bits[1] = 0;
    bits[2] = 0;
};

const setAttackBit = (bits, sq) => {
    bits[sq >>> 5] |= (1 << (sq & 31));
};

const hasAttackBit = (bits, sq) => (bits[sq >>> 5] & (1 << (sq & 31))) !== 0;

const makeEmptyControllerGrid = () =>
    Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));

// 关系 mask：最多 32 子（中国象棋满盘），bit i = piecesInfo[i]
const PACKED_CAPTURE_STRIDE = 8;
const scratchPackedCaptureCounts = new Uint8Array(REL_SQUARES);
const scratchPackedCaptureMoves = new Uint16Array(REL_SQUARES * PACKED_CAPTURE_STRIDE);
const scratchPackedCaptureSources = new Uint8Array(16);
const scratchPackedCaptures = [];
let scratchPackedCaptureSourceCount = 0;
let packedCaptureCacheKey = 0;
let packedCaptureVerificationKey = 0;
let packedCaptureCombinedKey = 0;
let packedCaptureGeneration = 0;
let packedCapturePlayer = null;
let leafRelationScratchFresh = false;
const scratchAttackMask = new Uint32Array(REL_SQUARES);  // 敌子所在格：谁在打它
const scratchGuardMask = new Uint32Array(REL_SQUARES);   // 友军所在格：谁在保它
const scratchControlMask = new Uint32Array(REL_SQUARES); // 空控格：谁控制它（对齐旧 boardInfo）

const clearRelationMasks = (clearControl = true) => {
    scratchAttackMask.fill(0);
    scratchGuardMask.fill(0);
    if (clearControl) scratchControlMask.fill(0);
};

// 格位 → piecesInfo 引用（替代每叶 new Map）
const scratchPieceAtSq = new Array(REL_SQUARES);
const clearPieceAtSq = () => {
    for (let i = 0; i < REL_SQUARES; i++) scratchPieceAtSq[i] = null;
};

// 复用 relCtx，避免每子 new 小对象
const scratchRelCtx = {
    useMasks: true,
    skipControlMask: false, // 搜索叶：不写空控 controlMask（仍写攻击位图+机动）
    palaceControlOnly: false,
    pieceIndex: 0,
    attackMask: null,
    guardMask: null,
    controlMask: null,
    redAttack: null,
    blackAttack: null
};

const isPalaceControlSquare = (sq) => {
    const r = (sq / 9) | 0;
    const c = sq % 9;
    return c >= 3 && c <= 5 && (r <= 2 || r >= 7);
};

const shouldWriteControlMask = (relCtx, sq) => (
    !relCtx.skipControlMask && (!relCtx.palaceControlOnly || isPalaceControlSquare(sq))
);

const scratchLeafAttackBySlot = new Uint32Array(32);
const scratchLeafGuardBySlot = new Uint32Array(32);
const scratchPinRank = new Int8Array(32);
const scratchPinFile = new Int8Array(32);
const scratchPinOnlySq = new Int8Array(32);
const scratchLeafTotals = new Float64Array(6);
let scratchLeafAttackedTargetMask = 0;
const scratchOwnScanSlots = new Uint8Array(32);
const scratchOwnScanOrder = new Uint16Array(32);

let activeSearchPieceState = null;

const searchPieceTypeCode = (type) => {
    switch (type) {
        case PIECE_TYPES.GENERAL: return 1;
        case PIECE_TYPES.CHARIOT: return 2;
        case PIECE_TYPES.HORSE: return 3;
        case PIECE_TYPES.ELEPHANT: return 4;
        case PIECE_TYPES.ADVISOR: return 5;
        case PIECE_TYPES.CANNON: return 6;
        case PIECE_TYPES.SOLDIER: return 7;
        default: return 0;
    }
};

const searchPieceCode = (piece) => searchPieceTypeCode(piece.type) + (piece.color === 'red' ? 0 : 8);

// 搜索编码 → Zobrist 下标。将/士/象/马/车/炮/兵 与 pieceIndex 的 0–6 不一致。
const SEARCH_CODE_TO_ZOBRIST = new Int8Array([
    -1, 0, 4, 3, 2, 1, 5, 6,
    -1, 7, 11, 10, 9, 8, 12, 13
]);

const toSearchPieceCode = (pieceOrCode) => {
    if (pieceOrCode == null || pieceOrCode === 0) return 0;
    return typeof pieceOrCode === 'number' ? pieceOrCode : searchPieceCode(pieceOrCode);
};

const SEARCH_MATERIAL_VALUES = {
    early: new Int16Array([0, 10000, 900, 400, 200, 200, 450, 100]),
    mid: new Int16Array([0, 10000, 900, 450, 200, 200, 400, 200]),
    late: new Int16Array([0, 10000, 900, 450, 200, 200, 400, 450])
};

const searchMaterialTable = (gameStage) => SEARCH_MATERIAL_VALUES[gameStage] || SEARCH_MATERIAL_VALUES.mid;

// Independent 32-bit verifier for the eval cache. The primary Zobrist hash is
// also used by TT; a second incrementally maintained hash prevents a primary
// collision from returning another board's static evaluation.
const EVAL_VERIFY_HASH_BY_CODE = Array.from({ length: 16 }, () => new Int32Array(REL_SQUARES));
(() => {
    let seed = 0x6d2b79f5;
    const next = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return seed | 0;
    };
    for (let code = 1; code < EVAL_VERIFY_HASH_BY_CODE.length; code++) {
        const bySquare = EVAL_VERIFY_HASH_BY_CODE[code];
        for (let sq = 0; sq < REL_SQUARES; sq++) bySquare[sq] = next();
    }
})();

const createSearchPieceState = (board, gameStage = 'mid') => {
    const squareToSlot = new Int8Array(REL_SQUARES);
    const squareCodes = new Uint8Array(REL_SQUARES);
    const rowOccupancy = new Uint16Array(ROWS);
    const colOccupancy = new Uint16Array(COLS);
    const pieceCodes = new Uint8Array(32);
    const pieceSquares = new Uint8Array(32);
    const materialValues = searchMaterialTable(gameStage);
    let slotCount = 0;
    let redMaterial = 0;
    let redPosition = 0;
    let blackMaterial = 0;
    let blackPosition = 0;
    let redGeneralSq = -1;
    let blackGeneralSq = -1;
    let evalVerificationHash = 0;
    let redAliveMask = 0;
    let blackAliveMask = 0;
    squareToSlot.fill(-1);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            if (slotCount >= 32) return null;
            const slot = slotCount++;
            const code = searchPieceCode(piece);
            if ((code & 7) === 1) {
                if (code < 8) redGeneralSq = r * 9 + c;
                else blackGeneralSq = r * 9 + c;
            }
            pieceCodes[slot] = code;
            pieceSquares[slot] = r * 9 + c;
            if (code < 8) redAliveMask = (redAliveMask | (1 << slot)) >>> 0;
            else blackAliveMask = (blackAliveMask | (1 << slot)) >>> 0;
            squareToSlot[r * 9 + c] = slot;
            squareCodes[r * 9 + c] = code;
            rowOccupancy[r] |= 1 << c;
            colOccupancy[c] |= 1 << r;
            evalVerificationHash ^= EVAL_VERIFY_HASH_BY_CODE[code][r * 9 + c];
            const materialValue = materialValues[code & 7];
            const positionValue = SEARCH_POSITION_VALUES[code][r * 9 + c];
            if (code < 8) {
                redMaterial += materialValue;
                redPosition += positionValue;
            } else {
                blackMaterial += materialValue;
                blackPosition += positionValue;
            }
        }
    }
    return {
        // 身份句柄：UI/点棋绑对象棋盘；搜索改绑到空 token，不再持有 10×9
        board,
        squareToSlot,
        squareCodes,
        rowOccupancy,
        colOccupancy,
        pieceCodes,
        pieceSquares,
        redAliveMask,
        blackAliveMask,
        materialValues,
        redMaterial,
        redPosition,
        blackMaterial,
        blackPosition,
        redGeneralSq,
        blackGeneralSq,
        evalVerificationHash,
        slotCount,
        moverStack: new Int8Array(32),
        capturedStack: new Int8Array(32),
        stackDepth: 0
    };
};

const activePieceStateFor = (board) => {
    const state = activeSearchPieceState;
    return state && state.board === board ? state : null;
};

// 点棋/根着法/终局判定没有搜索 pieceState 时临时建一份，使 isCheck 走占位表。
// 已有 state 则直接用；不得覆盖搜索中的身份句柄。
const runWithPieceState = (board, fn) => {
    if (activePieceStateFor(board)) return fn();
    const previous = activeSearchPieceState;
    const created = createSearchPieceState(board, 'mid');
    if (created) activeSearchPieceState = created;
    try {
        return fn();
    } finally {
        activeSearchPieceState = previous;
    }
};

const updatePieceStateAfterMakeQuiet = (state, fromSq, toSq, moverSlot, moverCode) => {
    const stackIndex = state.stackDepth++;
    state.moverStack[stackIndex] = moverSlot;
    state.capturedStack[stackIndex] = -1;
    const fromR = SQ_ROW[fromSq];
    const fromC = SQ_COL[fromSq];
    const toR = SQ_ROW[toSq];
    const toC = SQ_COL[toSq];
    state.rowOccupancy[fromR] ^= 1 << fromC;
    state.colOccupancy[fromC] ^= 1 << fromR;
    state.rowOccupancy[toR] ^= 1 << toC;
    state.colOccupancy[toC] ^= 1 << toR;
    state.evalVerificationHash ^= EVAL_VERIFY_HASH_BY_CODE[moverCode][fromSq] ^
        EVAL_VERIFY_HASH_BY_CODE[moverCode][toSq];
    const moverPositionDelta = SEARCH_POSITION_VALUES[moverCode][toSq] -
        SEARCH_POSITION_VALUES[moverCode][fromSq];
    if (moverCode < 8) state.redPosition += moverPositionDelta;
    else state.blackPosition += moverPositionDelta;
    state.pieceSquares[moverSlot] = toSq;
    state.squareToSlot[fromSq] = -1;
    state.squareToSlot[toSq] = moverSlot;
    state.squareCodes[fromSq] = 0;
    state.squareCodes[toSq] = moverCode;
    if ((moverCode & 7) === 1) {
        if (moverCode < 8) state.redGeneralSq = toSq;
        else state.blackGeneralSq = toSq;
    }
};

const updatePieceStateAfterMakeCapture = (state, fromSq, toSq, moverSlot, moverCode, capturedSlot) => {
    const stackIndex = state.stackDepth++;
    state.moverStack[stackIndex] = moverSlot;
    state.capturedStack[stackIndex] = capturedSlot;
    const fromR = SQ_ROW[fromSq];
    const fromC = SQ_COL[fromSq];
    state.rowOccupancy[fromR] ^= 1 << fromC;
    state.colOccupancy[fromC] ^= 1 << fromR;
    state.evalVerificationHash ^= EVAL_VERIFY_HASH_BY_CODE[moverCode][fromSq] ^
        EVAL_VERIFY_HASH_BY_CODE[moverCode][toSq];
    const moverPositionDelta = SEARCH_POSITION_VALUES[moverCode][toSq] -
        SEARCH_POSITION_VALUES[moverCode][fromSq];
    if (moverCode < 8) state.redPosition += moverPositionDelta;
    else state.blackPosition += moverPositionDelta;
    const capturedCode = state.pieceCodes[capturedSlot];
    const capturedBit = 1 << capturedSlot;
    if (capturedCode < 8) state.redAliveMask = (state.redAliveMask & ~capturedBit) >>> 0;
    else state.blackAliveMask = (state.blackAliveMask & ~capturedBit) >>> 0;
    state.evalVerificationHash ^= EVAL_VERIFY_HASH_BY_CODE[capturedCode][toSq];
    const capturedMaterial = state.materialValues[capturedCode & 7];
    const capturedPosition = SEARCH_POSITION_VALUES[capturedCode][toSq];
    if (capturedCode < 8) {
        state.redMaterial -= capturedMaterial;
        state.redPosition -= capturedPosition;
    } else {
        state.blackMaterial -= capturedMaterial;
        state.blackPosition -= capturedPosition;
    }
    state.pieceSquares[moverSlot] = toSq;
    state.squareToSlot[fromSq] = -1;
    state.squareToSlot[toSq] = moverSlot;
    state.squareCodes[fromSq] = 0;
    state.squareCodes[toSq] = moverCode;
    if ((moverCode & 7) === 1) {
        if (moverCode < 8) state.redGeneralSq = toSq;
        else state.blackGeneralSq = toSq;
    }
    if ((capturedCode & 7) === 1) {
        if (capturedCode < 8) state.redGeneralSq = -1;
        else state.blackGeneralSq = -1;
    }
};

const updatePieceStateAfterUnmakeQuiet = (state, fromSq, toSq) => {
    const stackIndex = --state.stackDepth;
    const moverSlot = state.moverStack[stackIndex];
    if (moverSlot < 0) return;
    const moverCode = state.pieceCodes[moverSlot];
    const fromR = SQ_ROW[fromSq];
    const fromC = SQ_COL[fromSq];
    const toR = SQ_ROW[toSq];
    const toC = SQ_COL[toSq];
    state.rowOccupancy[toR] ^= 1 << toC;
    state.colOccupancy[toC] ^= 1 << toR;
    state.rowOccupancy[fromR] ^= 1 << fromC;
    state.colOccupancy[fromC] ^= 1 << fromR;
    state.evalVerificationHash ^= EVAL_VERIFY_HASH_BY_CODE[moverCode][fromSq] ^
        EVAL_VERIFY_HASH_BY_CODE[moverCode][toSq];
    const moverPositionDelta = SEARCH_POSITION_VALUES[moverCode][fromSq] -
        SEARCH_POSITION_VALUES[moverCode][toSq];
    if (moverCode < 8) state.redPosition += moverPositionDelta;
    else state.blackPosition += moverPositionDelta;
    state.pieceSquares[moverSlot] = fromSq;
    state.squareToSlot[fromSq] = moverSlot;
    state.squareToSlot[toSq] = -1;
    state.squareCodes[fromSq] = moverCode;
    state.squareCodes[toSq] = 0;
    if ((moverCode & 7) === 1) {
        if (moverCode < 8) state.redGeneralSq = fromSq;
        else state.blackGeneralSq = fromSq;
    }
};

const updatePieceStateAfterUnmakeCapture = (state, fromSq, toSq) => {
    const stackIndex = --state.stackDepth;
    const moverSlot = state.moverStack[stackIndex];
    const capturedSlot = state.capturedStack[stackIndex];
    if (moverSlot < 0) return;
    const moverCode = state.pieceCodes[moverSlot];
    const fromR = SQ_ROW[fromSq];
    const fromC = SQ_COL[fromSq];
    state.rowOccupancy[fromR] ^= 1 << fromC;
    state.colOccupancy[fromC] ^= 1 << fromR;
    state.evalVerificationHash ^= EVAL_VERIFY_HASH_BY_CODE[moverCode][fromSq] ^
        EVAL_VERIFY_HASH_BY_CODE[moverCode][toSq];
    const moverPositionDelta = SEARCH_POSITION_VALUES[moverCode][fromSq] -
        SEARCH_POSITION_VALUES[moverCode][toSq];
    if (moverCode < 8) state.redPosition += moverPositionDelta;
    else state.blackPosition += moverPositionDelta;
    const capturedCode = state.pieceCodes[capturedSlot];
    const capturedBit = 1 << capturedSlot;
    if (capturedCode < 8) state.redAliveMask = (state.redAliveMask | capturedBit) >>> 0;
    else state.blackAliveMask = (state.blackAliveMask | capturedBit) >>> 0;
    state.evalVerificationHash ^= EVAL_VERIFY_HASH_BY_CODE[capturedCode][toSq];
    const capturedMaterial = state.materialValues[capturedCode & 7];
    const capturedPosition = SEARCH_POSITION_VALUES[capturedCode][toSq];
    if (capturedCode < 8) {
        state.redMaterial += capturedMaterial;
        state.redPosition += capturedPosition;
    } else {
        state.blackMaterial += capturedMaterial;
        state.blackPosition += capturedPosition;
    }
    state.pieceSquares[moverSlot] = fromSq;
    state.squareToSlot[fromSq] = moverSlot;
    state.squareToSlot[toSq] = capturedSlot;
    state.squareCodes[fromSq] = moverCode;
    state.squareCodes[toSq] = capturedCode;
    if ((moverCode & 7) === 1) {
        if (moverCode < 8) state.redGeneralSq = fromSq;
        else state.blackGeneralSq = fromSq;
    }
    if ((capturedCode & 7) === 1) {
        if (capturedCode < 8) state.redGeneralSq = toSq;
        else state.blackGeneralSq = toSq;
    }
};

const updatePieceStateAfterMake = (board, fromSq, toSq) => {
    const state = activePieceStateFor(board);
    if (!state) return;
    const moverSlot = state.squareToSlot[fromSq];
    const capturedSlot = state.squareToSlot[toSq];
    if (moverSlot < 0) {
        const stackIndex = state.stackDepth++;
        state.moverStack[stackIndex] = moverSlot;
        state.capturedStack[stackIndex] = capturedSlot;
        return;
    }
    const moverCode = state.pieceCodes[moverSlot];
    if (capturedSlot < 0) updatePieceStateAfterMakeQuiet(state, fromSq, toSq, moverSlot, moverCode);
    else updatePieceStateAfterMakeCapture(state, fromSq, toSq, moverSlot, moverCode, capturedSlot);
};

const updatePieceStateAfterUnmake = (board, fromSq, toSq) => {
    const state = activePieceStateFor(board);
    if (!state) return;
    if (state.capturedStack[state.stackDepth - 1] < 0) updatePieceStateAfterUnmakeQuiet(state, fromSq, toSq);
    else updatePieceStateAfterUnmakeCapture(state, fromSq, toSq);
};

const lowestSetBitIndex = (mask) => 31 - Math.clz32(mask & -mask);

const makeSearchRootPieceInfo = () => ({
    piece: null,
    r: 0,
    c: 0,
    pieceIndex: 0,
    materialValue: 0,
    positionValue: 0,
    threatValue: 0,
    safetyValue: 0,
    mobilityValue: 0
});
const scratchSearchRootPieces = Array.from({ length: 32 }, makeSearchRootPieceInfo);
const scratchSearchRootList = [];

// 主评估函数 - 详细评估棋盘局势（局面评估面板 / 搜索叶 / 根节点）
// options.forSearchLeaf: 仅跳过终局 getValidMoves（无着已在父节点处理）；可用攻击位图代替控制者表
// options.forSearchRoot: 搜索根排序用，复用棋子槽，不建空关系列表 / 终局扫着 / 分项对象
// 点棋关系请用 evaluateBoardForUi，不要往这里加 UI 专用开关
const evaluateBoard = (board, currentPlayer = null, gameStage = 'mid', options = null) => {
    const __t0 = searchContext.profile ? performance.now() : 0;
    const forSearchLeaf = !!(options && options.forSearchLeaf);
    const forSearchRoot = !!(options && options.forSearchRoot);

    const outputPhase = gameStage;

    // 遍历棋盘：只收集子力/PST；着法+关系统一在 calculatePieceRelations 一次几何生成（对齐炮）
    let piecesInfo;
    if (forSearchRoot) {
        scratchSearchRootList.length = 0;
        piecesInfo = scratchSearchRootList;
    } else {
        piecesInfo = [];
    }
    let redMaterial = 0, redPosition = 0;
    let blackMaterial = 0, blackPosition = 0;
    
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            
            const materialValue = getMaterialValue(piece, gameStage);
            const positionValue = getPositionValue(piece, r, c);
            
            if (piece.color === 'red') {
                redMaterial += materialValue;
                redPosition += positionValue;
            } else {
                blackMaterial += materialValue;
                blackPosition += positionValue;
            }

            if (forSearchRoot) {
                const slot = piecesInfo.length < scratchSearchRootPieces.length
                    ? scratchSearchRootPieces[piecesInfo.length]
                    : makeSearchRootPieceInfo();
                slot.piece = piece;
                slot.r = r;
                slot.c = c;
                slot.pieceIndex = piecesInfo.length;
                slot.materialValue = materialValue;
                slot.positionValue = positionValue;
                slot.threatValue = 0;
                slot.safetyValue = 0;
                slot.mobilityValue = 0;
                piecesInfo.push(slot);
                continue;
            }
            
            piecesInfo.push({
                piece,
                r,
                c,
                pieceIndex: piecesInfo.length,
                moves: [],
                allyGuards: [],
                materialValue,
                positionValue,
                threatValue: 0,
                safetyValue: 0,
                mobilityValue: 0,
                threat: [],
                threatenedBy: [],
                guard: [],
                guardedBy: [],
                control: [],
                protect: []
            });
        }
    }

    // 关系 mask（≤32 子）优先；否则回退旧列表 / 叶攻击位图
    const useRelationMasks = piecesInfo.length <= 32;
    let boardInfo;
    if (useRelationMasks) {
        clearRelationMasks(!forSearchLeaf);
        clearAttackBits(scratchRedAttack);
        clearAttackBits(scratchBlackAttack);
        boardInfo = {
            useRelationMasks: true,
            useAttackBits: true,
            skipControlMask: !!forSearchLeaf,
            palaceControlOnly: !!(options && options.palaceControlOnly),
            attackMask: scratchAttackMask,
            guardMask: scratchGuardMask,
            controlMask: scratchControlMask,
            redAttack: scratchRedAttack,
            blackAttack: scratchBlackAttack
        };
    } else {
        boardInfo = makeEmptyControllerGrid();
    }
    calculateDerivedValues(board, piecesInfo, currentPlayer, boardInfo, forSearchLeaf, forSearchRoot);
    if (forSearchRoot) {
        if (searchContext.profile) {
            perfStats.evaluateBoardMs += performance.now() - __t0;
        }
        return { piecesInfo, boardInfo, gameStage };
    }
    
    // 第三步：计算总分（只计算剩余分数，基础分数已在棋盘遍历时计算）
    let redThreat = 0, redSafety = 0, redMobility = 0;
    let blackThreat = 0, blackSafety = 0, blackMobility = 0;
    
    for (const info of piecesInfo) {
        const { piece, threatValue, safetyValue, mobilityValue } = info;
        
        if (piece.color === 'red') {
            redThreat += threatValue;
            redSafety += safetyValue;
            if (piece.type !== 'soldier') redMobility += mobilityValue;
        } else {
            blackThreat += threatValue;
            blackSafety += safetyValue;
            if (piece.type !== 'soldier') blackMobility += mobilityValue;
        }
    }
    
    // 计算局势总分
    const redTotal = 
        redMaterial * VALUE_WEIGHTS.material +
        redPosition * VALUE_WEIGHTS.position +
        redThreat * VALUE_WEIGHTS.threat +
        redSafety * VALUE_WEIGHTS.safety +
        redMobility * VALUE_WEIGHTS.mobility; 
    
    const blackTotal = 
        blackMaterial * VALUE_WEIGHTS.material +
        blackPosition * VALUE_WEIGHTS.position +
        blackThreat * VALUE_WEIGHTS.threat +
        blackSafety * VALUE_WEIGHTS.safety +
        blackMobility * VALUE_WEIGHTS.mobility;
    
    // 返回详细评估结果
    const __evalResult = {
        red: {
            total: redTotal,
            material: redMaterial * VALUE_WEIGHTS.material,
            position: redPosition * VALUE_WEIGHTS.position,
            threat: redThreat * VALUE_WEIGHTS.threat,
            safety: redSafety * VALUE_WEIGHTS.safety,
            mobility: redMobility * VALUE_WEIGHTS.mobility,
            phase: outputPhase,
            weights: {
                material: 0.4,
                position: 0.2,
                safety: 0.1,
                mobility: 0.05,
                threat: 0.15
            }
        },
        black: {
            total: blackTotal,
            material: blackMaterial * VALUE_WEIGHTS.material,
            position: blackPosition * VALUE_WEIGHTS.position,
            threat: blackThreat * VALUE_WEIGHTS.threat,
            safety: blackSafety * VALUE_WEIGHTS.safety,
            mobility: blackMobility * VALUE_WEIGHTS.mobility,
            phase: outputPhase,
            weights: {
                material: 0.4,
                position: 0.2,
                safety: 0.1,
                mobility: 0.05,
                threat: 0.15
            }
        },
        piecesInfo: piecesInfo,
        gameStage: gameStage,
        boardInfo: boardInfo
    };
    if (searchContext.profile) {
        perfStats.evaluateBoardMs += performance.now() - __t0;
    }
    return __evalResult;
};

// 点棋专用评估：关系 + 单子分。不跑终局“扫全体合法着”，也不改 evaluateBoard
const evaluateBoardForUi = (board, currentPlayer = null, gameStage = 'mid') => {
    const piecesInfo = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            piecesInfo.push({
                piece,
                r,
                c,
                pieceIndex: piecesInfo.length,
                moves: [],
                allyGuards: [],
                materialValue: getMaterialValue(piece, gameStage),
                positionValue: getPositionValue(piece, r, c),
                threatValue: 0,
                safetyValue: 0,
                mobilityValue: 0,
                threat: [],
                threatenedBy: [],
                guard: [],
                guardedBy: [],
                control: [],
                protect: []
            });
        }
    }

    let boardInfo;
    if (piecesInfo.length <= 32) {
        clearRelationMasks(true);
        clearAttackBits(scratchRedAttack);
        clearAttackBits(scratchBlackAttack);
        boardInfo = {
            useRelationMasks: true,
            useAttackBits: true,
            skipControlMask: false,
            palaceControlOnly: false,
            attackMask: scratchAttackMask,
            guardMask: scratchGuardMask,
            controlMask: scratchControlMask,
            redAttack: scratchRedAttack,
            blackAttack: scratchBlackAttack
        };
    } else {
        boardInfo = makeEmptyControllerGrid();
    }

    calculatePieceRelations(board, piecesInfo, boardInfo);
    calculateTacticalValues(piecesInfo, currentPlayer, boardInfo, board, false);

    return {
        piecesInfo,
        gameStage,
        boardInfo
    };
};

// Worker/点棋仍会调用；将位已在 pieceState.redGeneralSq / blackGeneralSq。
const syncGeneralPosCache = () => {};

// 合法着过滤/根节点：仍同步对象棋盘，给 getValidMoves 用
const makeMove = (board, from, to) => {
    const piece = board[from.r][from.c];
    const captured = board[to.r][to.c];
    board[to.r][to.c] = piece;
    board[from.r][from.c] = null;
    updatePieceStateAfterMake(board, from.r * 9 + from.c, to.r * 9 + to.c);
    return captured;
};

const unmakeMove = (board, from, to, captured) => {
    const piece = board[to.r][to.c];
    board[from.r][from.c] = piece;
    board[to.r][to.c] = captured;
    updatePieceStateAfterUnmake(board, from.r * 9 + from.c, to.r * 9 + to.c);
};

// 父局面未将军且未动将：新将军来自 from/to 将线变化（含落点成炮架），或腾出马腿。
const isCheckAfterSafeMoveFromCoords = (
    state, enemyIsRed, generalSq, gr, gc,
    fromR, fromC, toR, toC
) => {
    const squareCodes = state.squareCodes;
    const fromOnRank = fromR === gr;
    const fromOnFile = fromC === gc;
    const toOnRank = toR === gr;
    const toOnFile = toC === gc;

    if (fromOnRank || toOnRank) {
        const rankKey = gc * RANK_OCC_COUNT + state.rowOccupancy[gr];
        if ((fromOnRank && fromC > gc) || (toOnRank && toC > gc)) {
            const first = RANK_FIRST_HIGH[rankKey];
            if (first !== 255) {
                let pieceCode = squareCodes[gr * COLS + first];
                if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
                const second = RANK_SECOND_HIGH[rankKey];
                if (second !== 255) {
                    pieceCode = squareCodes[gr * COLS + second];
                    if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
                }
            }
        }
        if ((fromOnRank && fromC < gc) || (toOnRank && toC < gc)) {
            const first = RANK_FIRST_LOW[rankKey];
            if (first !== 255) {
                let pieceCode = squareCodes[gr * COLS + first];
                if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
                const second = RANK_SECOND_LOW[rankKey];
                if (second !== 255) {
                    pieceCode = squareCodes[gr * COLS + second];
                    if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
                }
            }
        }
    }
    if (fromOnFile || toOnFile) {
        const fileKey = gr * FILE_OCC_COUNT + state.colOccupancy[gc];
        if ((fromOnFile && fromR > gr) || (toOnFile && toR > gr)) {
            const first = FILE_FIRST_HIGH[fileKey];
            if (first !== 255) {
                let pieceCode = squareCodes[first * COLS + gc];
                if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
                const second = FILE_SECOND_HIGH[fileKey];
                if (second !== 255) {
                    pieceCode = squareCodes[second * COLS + gc];
                    if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
                }
            }
        }
        if ((fromOnFile && fromR < gr) || (toOnFile && toR < gr)) {
            const first = FILE_FIRST_LOW[fileKey];
            if (first !== 255) {
                let pieceCode = squareCodes[first * COLS + gc];
                if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
                const second = FILE_SECOND_LOW[fileKey];
                if (second !== 255) {
                    pieceCode = squareCodes[second * COLS + gc];
                    if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
                }
            }
        }
    }

    if (Math.abs(fromR - gr) === 1 && Math.abs(fromC - gc) === 1) {
        const fromSq = fromR * 9 + fromC;
        const horseCheckerData = SEARCH_HORSE_CHECKER_DATA;
        for (let i = SEARCH_HORSE_CHECKER_OFF[generalSq], n = SEARCH_HORSE_CHECKER_OFF[generalSq + 1]; i < n; i++) {
            const entry = horseCheckerData[i];
            if (fromSq !== (entry >>> 7)) continue;
            const pieceCode = squareCodes[entry & 127];
            if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 3) return true;
        }
    }

    return false;
};

const isCheckAfterSafeMove = (state, color, fromSq, toSq) => {
    const ownIsRed = color === 'red';
    const generalSq = ownIsRed ? state.redGeneralSq : state.blackGeneralSq;
    if (generalSq < 0) return true;
    return isCheckAfterSafeMoveFromCoords(
        state, !ownIsRed, generalSq,
        SEARCH_SQ_ROWS[generalSq], SEARCH_SQ_COLS[generalSq],
        SEARCH_SQ_ROWS[fromSq], SEARCH_SQ_COLS[fromSq],
        SEARCH_SQ_ROWS[toSq], SEARCH_SQ_COLS[toSq]
    );
};

// 落点马/兵直接将。车炮将/闪将/炮架/腾腿由 isCheckAfterSafeMove 覆盖。
const moverGivesDirectShortCheck = (state, checkedColor, toSq) => {
    const pieceCode = state.squareCodes[toSq];
    const pieceType = pieceCode & 7;
    if (pieceType !== 3 && pieceType !== 7) return false;

    const ownIsRed = checkedColor === 'red';
    const generalSq = ownIsRed ? state.redGeneralSq : state.blackGeneralSq;
    const enemyIsRed = !ownIsRed;
    const squareCodes = state.squareCodes;

    if (pieceType === 3) {
        const horseCheckerData = SEARCH_HORSE_CHECKER_DATA;
        for (let i = SEARCH_HORSE_CHECKER_OFF[generalSq], n = SEARCH_HORSE_CHECKER_OFF[generalSq + 1]; i < n; i++) {
            const entry = horseCheckerData[i];
            if ((entry & 127) !== toSq) continue;
            if (squareCodes[entry >>> 7] === 0) return true;
        }
        return false;
    }

    const gr = SEARCH_SQ_ROWS[generalSq];
    const gc = SEARCH_SQ_COLS[generalSq];
    const enemyForward = enemyIsRed ? 1 : -1;
    if (SEARCH_SQ_COLS[toSq] === gc && SEARCH_SQ_ROWS[toSq] === gr - enemyForward) return true;
    const crossedRiver = enemyIsRed ? gr >= 5 : gr <= 4;
    if (crossedRiver && SEARCH_SQ_ROWS[toSq] === gr) {
        const toC = SEARCH_SQ_COLS[toSq];
        if (toC === gc + 1 || toC === gc - 1) return true;
    }
    return false;
};

// 已 make：对方将是否被将。将线增量 + 马/兵直接将，不扫未变的射线。
const isCheckAfterGivingMove = (state, checkedColor, fromSq, toSq) =>
    isCheckAfterSafeMove(state, checkedColor, fromSq, toSq) ||
    moverGivesDirectShortCheck(state, checkedColor, toSq);

// 已 make 且着法合法：对方是否被将。与入口 isCheckFromState 同一套检测，结果下传。
const moveGivesCheck = (state, moverColor) =>
    isCheckFromState(state, moverColor === 'red' ? 'black' : 'red');

const CHECK_KIND_RAY = 1;
const CHECK_KIND_HORSE = 2;
const CHECK_KIND_SOLDIER = 3;
const CHECK_KIND_CANNON = 4;
const CHECK_INFO_CAP = 4;

const createCheckInfo = () => ({
    count: 0,
    sq: [-1, -1, -1, -1],
    kind: [0, 0, 0, 0],
    leg: [-1, -1, -1, -1]
});

const addChecker = (out, sq, kind, leg = -1) => {
    if (out.count >= CHECK_INFO_CAP) {
        out.count = CHECK_INFO_CAP + 1;
        return;
    }
    const i = out.count;
    out.sq[i] = sq;
    out.kind[i] = kind;
    out.leg[i] = leg;
    out.count = i + 1;
};

const acquireCheckInfo = (pool, ply) => {
    let info = pool[ply];
    if (!info) {
        info = createCheckInfo();
        pool[ply] = info;
    } else {
        info.count = 0;
    }
    return info;
};

const abCheckInfoPool = [];
const qsCheckInfoPool = [];
const evasionResolveMask = new Uint8Array(REL_SQUARES);
const evasionResolveScratch = new Uint8Array(REL_SQUARES);

const isStrictlyBetweenOnRay = (sq, a, b) => {
    const sr = SEARCH_SQ_ROWS[sq];
    const sc = SEARCH_SQ_COLS[sq];
    const ar = SEARCH_SQ_ROWS[a];
    const ac = SEARCH_SQ_COLS[a];
    const br = SEARCH_SQ_ROWS[b];
    const bc = SEARCH_SQ_COLS[b];
    if (ar === br && sr === ar) {
        const lo = ac < bc ? ac : bc;
        const hi = ac < bc ? bc : ac;
        return sc > lo && sc < hi;
    }
    if (ac === bc && sc === ac) {
        const lo = ar < br ? ar : br;
        const hi = ar < br ? br : ar;
        return sr > lo && sr < hi;
    }
    return false;
};

const squareResolvesChecker = (fromSq, toSq, generalSq, checkerSq, kind, extra) => {
    if (toSq === checkerSq) return true;
    if (kind === CHECK_KIND_HORSE) return toSq === extra;
    if (kind === CHECK_KIND_SOLDIER) return false;
    if (kind === CHECK_KIND_CANNON) {
        if (generalSq >= 0 && isStrictlyBetweenOnRay(toSq, generalSq, checkerSq)) return true;
        return fromSq === extra;
    }
    return generalSq >= 0 && checkerSq >= 0 && isStrictlyBetweenOnRay(toSq, generalSq, checkerSq);
};

const moveResolvesKnownChecks = (fromSq, toSq, generalSq, checkInfo) => {
    const count = checkInfo.count;
    if (count <= 0) return true;
    if (count > CHECK_INFO_CAP) return false;
    for (let i = 0; i < count; i++) {
        if (!squareResolvesChecker(
            fromSq, toSq, generalSq, checkInfo.sq[i], checkInfo.kind[i], checkInfo.leg[i]
        )) {
            return false;
        }
    }
    return true;
};

// 走子后是否使己方将不安全（飞将或被将）。调用前须已 makeMove。
const leavesOwnKingUnsafe = (pieceState, color, fromSq, toSq, wasInCheck = true, checkInfo = null) => {
    const generalSq = color === 'red' ? pieceState.redGeneralSq : pieceState.blackGeneralSq;
    if (!wasInCheck) {
        if (generalSq === toSq) return isCheckFromState(pieceState, color);
        if (generalSq < 0) return true;
        const gr = SEARCH_SQ_ROWS[generalSq];
        const gc = SEARCH_SQ_COLS[generalSq];
        const fromR = SEARCH_SQ_ROWS[fromSq];
        const fromC = SEARCH_SQ_COLS[fromSq];
        const toR = SEARCH_SQ_ROWS[toSq];
        const toC = SEARCH_SQ_COLS[toSq];
        if (
            fromR !== gr && fromC !== gc && toR !== gr && toC !== gc &&
            (fromR - gr > 1 || fromR - gr < -1 || fromC - gc > 1 || fromC - gc < -1)
        ) {
            return false;
        }
        return isCheckAfterSafeMoveFromCoords(
            pieceState, color !== 'red', generalSq, gr, gc,
            fromR, fromC, toR, toC
        );
    }
    if (
        checkInfo &&
        checkInfo.count > 0 &&
        checkInfo.count <= CHECK_INFO_CAP
    ) {
        if (generalSq === toSq) return isCheckFromState(pieceState, color);
        if (!moveResolvesKnownChecks(fromSq, toSq, generalSq, checkInfo)) return true;
        return generalSq < 0 || isCheckAfterSafeMoveFromCoords(
            pieceState, color !== 'red', generalSq,
            SEARCH_SQ_ROWS[generalSq], SEARCH_SQ_COLS[generalSq],
            SEARCH_SQ_ROWS[fromSq], SEARCH_SQ_COLS[fromSq],
            SEARCH_SQ_ROWS[toSq], SEARCH_SQ_COLS[toSq]
        );
    }
    return isCheckFromState(pieceState, color);
};

// 从伪合法着法中过滤出不送将/不飞将的合法着法（UI/根节点/开局库校验）
// 搜索热路径使用延迟合法性（试走时检测），避免对剪枝未触及的着法做全量过滤
const scratchLegalDests = [];
const filterLegalMoves = (board, fromSq, color, pseudoMoves) => {
    const validMoves = scratchLegalDests;
    validMoves.length = 0;
    for (let i = 0; i < pseudoMoves.length; i++) {
        const toSq = pseudoMoves[i];
        const encoded = (fromSq << 7) | toSq;
        makeSearchMove(board, encoded);
        const illegal = leavesOwnKingUnsafe(activePieceStateFor(board), color, fromSq, toSq);
        unmakeSearchMove(board, encoded);
        if (!illegal) validMoves.push(toSq);
    }
    return validMoves;
};

const makeSearchMove = (board, move) => {
    const state = activeSearchPieceState;
    const from = move >>> 7;
    const to = move & MOVE_TO_MASK;
    if (!state || state.board !== board) {
        const capturedCode = state ? state.squareCodes[to] : 0;
        updatePieceStateAfterMake(board, from, to);
        return capturedCode;
    }
    const capturedSlot = state.squareToSlot[to];
    const moverSlot = state.squareToSlot[from];
    const moverCode = state.pieceCodes[moverSlot];
    if (capturedSlot < 0) {
        updatePieceStateAfterMakeQuiet(state, from, to, moverSlot, moverCode);
        return 0;
    }
    const capturedCode = state.squareCodes[to];
    updatePieceStateAfterMakeCapture(state, from, to, moverSlot, moverCode, capturedSlot);
    return capturedCode;
};

const unmakeSearchMove = (board, move) => {
    const state = activeSearchPieceState;
    const from = move >>> 7;
    const to = move & MOVE_TO_MASK;
    if (!state || state.board !== board) {
        updatePieceStateAfterUnmake(board, from, to);
        return;
    }
    if (state.capturedStack[state.stackDepth - 1] < 0) {
        updatePieceStateAfterUnmakeQuiet(state, from, to);
    } else {
        updatePieceStateAfterUnmakeCapture(state, from, to);
    }
};

const sortMovePriorityScratch = [];
const sortMoveScoreScratch = [];
const captureSortScoreScratch = [];
const squareMarkScratch = new Uint8Array(REL_SQUARES);
const squareMarkTouched = [];

const markSortSquare = (sq) => {
    if (!squareMarkScratch[sq]) {
        squareMarkScratch[sq] = 1;
        squareMarkTouched.push(sq);
    }
};

const clearSortSquareMarks = () => {
    for (let i = 0; i < squareMarkTouched.length; i++) {
        squareMarkScratch[squareMarkTouched[i]] = 0;
    }
    squareMarkTouched.length = 0;
};

const sortMovesFast = (moves, board, currentPlayer, piecesInfo, gameStage = 'mid', boardInfo = null, ttMove = null, killers = null, knownInCheck = null, parallelArrays = null) => {
    const __t0 = searchContext.profile ? performance.now() : 0;
    if (searchContext.profile) perfStats.sortMovesCount++;
    const currentIsInCheck = knownInCheck != null
        ? knownInCheck
        : boardInfo
            ? ((currentPlayer === 'red' && boardInfo.redIsInCheck) ||
               (currentPlayer === 'black' && boardInfo.blackIsInCheck))
            : isCheck(board, currentPlayer);

    if (currentIsInCheck && boardInfo && boardInfo.checkerSquares) {
        const checkers = boardInfo.checkerSquares;
        for (let i = 0; i < checkers.length; i++) {
            markSortSquare(checkers[i]);
        }
    }

    const threatenedSquares = boardInfo && boardInfo.threatenedSquares;
    const hasThreatened = !currentIsInCheck && !!(threatenedSquares && threatenedSquares.length > 0);
    if (hasThreatened) {
        for (let i = 0; i < threatenedSquares.length; i++) {
            markSortSquare(threatenedSquares[i]);
        }
    }
    const threatenedMarkEnd = squareMarkTouched.length;

    const canCaptureSquares = boardInfo && boardInfo.canCaptureSquares;
    const hasCanCapture = !currentIsInCheck && !!(canCaptureSquares && canCaptureSquares.length > 0);
    if (hasCanCapture) {
        for (let i = 0; i < canCaptureSquares.length; i++) {
            markSortSquare(canCaptureSquares[i]);
        }
    }

    const pieceState = activePieceStateFor(board);
    if (!pieceState) {
        clearSortSquareMarks();
        if (searchContext.profile) perfStats.sortMovesMs += performance.now() - __t0;
        return moves;
    }
    const useSimpleSearchSort = !currentIsInCheck && !hasThreatened && !hasCanCapture;
    const isMarkedThreatened = (sq) => {
        if (!hasThreatened) return false;
        for (let i = 0; i < threatenedMarkEnd; i++) {
            if (squareMarkTouched[i] === sq) return true;
        }
        return false;
    };

    if (useSimpleSearchSort) {
        const squareToSlot = pieceState.squareToSlot;
        const pieceCodes = pieceState.pieceCodes;
        const materialValues = searchMaterialTable(gameStage);
        for (let index = 0; index < moves.length; index++) {
            const move = moves[index];
            const fromSq = move >>> 7;
            const toSq = move & MOVE_TO_MASK;
            const targetSlot = squareToSlot[toSq];
            const targetPieceCode = targetSlot >= 0 ? pieceCodes[targetSlot] : 0;
            let priority = 4;
            let score = 0;

            if (ttMove === move) {
                priority = -1;
                score = 1000000;
            } else if (targetSlot >= 0) {
                priority = 3;
                score = materialValues[targetPieceCode & 7] * 16 - materialValues[pieceCodes[squareToSlot[fromSq]] & 7];
            }

            if (priority >= 0) {
                if (targetSlot < 0 && killers && move === killers[0]) {
                    priority = Math.min(priority, 2);
                    score += 8000;
                } else if (targetSlot < 0 && killers && move === killers[1]) {
                    priority = Math.min(priority, 2);
                    score += 7000;
                }
                score += getHistoryScore(move);
            }

            sortMovePriorityScratch[index] = priority;
            sortMoveScoreScratch[index] = score;
        }
    } else for (let index = 0; index < moves.length; index++) {
        const move = moves[index];
        const fromSq = move >>> 7;
        const toSq = move & MOVE_TO_MASK;
        const moverCode = pieceState.squareCodes[fromSq];
        const targetCode = pieceState.squareCodes[toSq];
        const materialValues = searchMaterialTable(gameStage);
        const pieceValue = materialValues[moverCode & 7];
        const hasTarget = targetCode !== 0;
        const targetPieceValue = hasTarget ? materialValues[targetCode & 7] : 0;
        const moverIsGeneral = (moverCode & 7) === 1;
        let priority = 4;
        let score = 0;

        if (ttMove && isSameMove(move, ttMove)) {
            priority = -1;
            score = 1000000;
        } else if (currentIsInCheck) {
            const capturesChecker = hasTarget && squareMarkScratch[toSq] !== 0;
            if (capturesChecker) {
                priority = 0;
                score = 10000 + targetPieceValue;
            } else if (hasTarget) {
                priority = 2;
                score = targetPieceValue * 16 - pieceValue;
            } else if (moverIsGeneral) {
                priority = 3;
                score = pieceValue;
            }
        } else if (hasThreatened) {
            if (isMarkedThreatened(fromSq)) {
                priority = 1;
                score = pieceValue;
            } else if (hasTarget) {
                priority = hasCanCapture && squareMarkScratch[toSq] !== 0 ? 2 : 3;
                score = targetPieceValue;
            }
        } else if (hasCanCapture) {
            if (squareMarkScratch[toSq] !== 0) {
                priority = 2;
                score = targetPieceValue;
            } else if (hasTarget) {
                priority = 3;
                score = targetPieceValue;
            }
        } else if (hasTarget) {
            priority = 3;
            score = targetPieceValue * 16 - pieceValue;
        }

        if (priority >= 0) {
            if (!hasTarget && killers && isSameMove(move, killers[0])) {
                priority = Math.min(priority, 2);
                score += 8000;
            } else if (!hasTarget && killers && isSameMove(move, killers[1])) {
                priority = Math.min(priority, 2);
                score += 7000;
            }
            score += getHistoryScore(move);
        }

        sortMovePriorityScratch[index] = priority;
        sortMoveScoreScratch[index] = score;
    }

    const extraA = parallelArrays && parallelArrays[0];
    const extraB = parallelArrays && parallelArrays[1];
    for (let i = 1; i < moves.length; i++) {
        const move = moves[i];
        const extraAVal = extraA ? extraA[i] : null;
        const extraBVal = extraB ? extraB[i] : null;
        const priority = sortMovePriorityScratch[i];
        const score = sortMoveScoreScratch[i];
        let j = i - 1;
        while (
            j >= 0 &&
            (sortMovePriorityScratch[j] > priority ||
             (sortMovePriorityScratch[j] === priority && sortMoveScoreScratch[j] < score))
        ) {
            moves[j + 1] = moves[j];
            if (extraA) extraA[j + 1] = extraA[j];
            if (extraB) extraB[j + 1] = extraB[j];
            sortMovePriorityScratch[j + 1] = sortMovePriorityScratch[j];
            sortMoveScoreScratch[j + 1] = sortMoveScoreScratch[j];
            j--;
        }
        moves[j + 1] = move;
        if (extraA) extraA[j + 1] = extraAVal;
        if (extraB) extraB[j + 1] = extraBVal;
        sortMovePriorityScratch[j + 1] = priority;
        sortMoveScoreScratch[j + 1] = score;
    }

    clearSortSquareMarks();
    if (searchContext.profile) perfStats.sortMovesMs += performance.now() - __t0;
    return moves;
};

// 普通节点着法排序。未将军走 packed 简单分支；将军局面走通用排序。
const sortMoves = (moves, board, currentPlayer, piecesInfo, gameStage, boardInfo, ttMove, killers, inCheck) => {
    if (inCheck) {
        return sortMovesFast(moves, board, currentPlayer, piecesInfo, gameStage, boardInfo, ttMove, killers, true);
    }
    const pieceState = activePieceStateFor(board);

    const __t0 = searchContext.profile ? performance.now() : 0;
    if (searchContext.profile) perfStats.sortMovesCount++;
    const squareToSlot = pieceState.squareToSlot;
    const pieceCodes = pieceState.pieceCodes;
    const materialValues = pieceState.materialValues;

    for (let index = 0; index < moves.length; index++) {
        const move = moves[index];
        const fromSq = move >>> 7;
        const toSq = move & MOVE_TO_MASK;
        const targetSlot = squareToSlot[toSq];
        let priority = 4;
        let score = 0;

        if (ttMove === move) {
            priority = -1;
            score = 1000000;
        } else if (targetSlot >= 0) {
            priority = 3;
            score = materialValues[pieceCodes[targetSlot] & 7] * 16 -
                materialValues[pieceCodes[squareToSlot[fromSq]] & 7];
        }

        if (priority >= 0) {
            if (targetSlot < 0 && killers && move === killers[0]) {
                priority = 2;
                score += 8000;
            } else if (targetSlot < 0 && killers && move === killers[1]) {
                priority = 2;
                score += 7000;
            }
            score += getHistoryScore(move);
        }

        sortMovePriorityScratch[index] = priority;
        sortMoveScoreScratch[index] = score;
    }

    for (let i = 1; i < moves.length; i++) {
        const move = moves[i];
        const priority = sortMovePriorityScratch[i];
        const score = sortMoveScoreScratch[i];
        let j = i - 1;
        while (
            j >= 0 &&
            (sortMovePriorityScratch[j] > priority ||
             (sortMovePriorityScratch[j] === priority && sortMoveScoreScratch[j] < score))
        ) {
            moves[j + 1] = moves[j];
            sortMovePriorityScratch[j + 1] = sortMovePriorityScratch[j];
            sortMoveScoreScratch[j + 1] = sortMoveScoreScratch[j];
            j--;
        }
        moves[j + 1] = move;
        sortMovePriorityScratch[j + 1] = priority;
        sortMoveScoreScratch[j + 1] = score;
    }

    if (searchContext.profile) perfStats.sortMovesMs += performance.now() - __t0;
    return moves;
};

const sortStagedMoveRange = (moves, start, end, board, currentPlayer, killers) => {
    if (end - start <= 1) return;
    const __t0 = searchContext.profile ? performance.now() : 0;
    const pieceState = activePieceStateFor(board);
    const squareToSlot = pieceState.squareToSlot;
    const pieceCodes = pieceState.pieceCodes;
    const materialValues = pieceState.materialValues;

    for (let index = start; index < end; index++) {
        const move = moves[index];
        const fromSq = move >>> 7;
        const toSq = move & MOVE_TO_MASK;
        const targetSlot = squareToSlot[toSq];
        let score = getHistoryScore(move);
        if (targetSlot >= 0) {
            score += materialValues[pieceCodes[targetSlot] & 7] * 16 -
                materialValues[pieceCodes[squareToSlot[fromSq]] & 7];
        } else if (killers && move === killers[0]) {
            score += 8000;
        } else if (killers && move === killers[1]) {
            score += 7000;
        }
        sortMoveScoreScratch[index] = score;
    }

    for (let i = start + 1; i < end; i++) {
        const move = moves[i];
        const score = sortMoveScoreScratch[i];
        let j = i - 1;
        while (j >= start && sortMoveScoreScratch[j] < score) {
            moves[j + 1] = moves[j];
            sortMoveScoreScratch[j + 1] = sortMoveScoreScratch[j];
            j--;
        }
        moves[j + 1] = move;
        sortMoveScoreScratch[j + 1] = score;
    }
    if (searchContext.profile) perfStats.sortMovesMs += performance.now() - __t0;
};

// 计算衍生值：威胁值、安全值、战术值、机动值
const calculateDerivedValues = (board, piecesInfo, currentPlayer = null, boardInfo = null, forSearchLeaf = false, skipTerminalScan = false) => {
    // 重置所有衍生值，除了机动值（已在收集棋子信息时计算）
    for (const info of piecesInfo) {
        info.threatValue = 0;
        info.safetyValue = 0;
        // 保留机动值，因为已在收集棋子信息时计算
    }
    
    // 1. 计算棋子关系（威胁者、被威胁者、保护者、被保护者）
    if (!boardInfo) {
        boardInfo = Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));
    }
    calculatePieceRelations(board, piecesInfo, boardInfo);
    
    // 2. 计算威胁值（按被威胁子聚合，SEE 每目标一次）
    calculateTacticalValues(piecesInfo, currentPlayer, boardInfo, board, forSearchLeaf);
    
    // 4. 计算游戏状态并保存到boardInfo
    // 搜索叶节点跳过：无着/将死已在父节点处理，此处只需静态分
    if (currentPlayer && !forSearchLeaf && !skipTerminalScan) {
        // 检查当前玩家是否有合法走法
        let hasMoves = false;
        for (const info of piecesInfo) {
            if (info.piece.color === currentPlayer) {
                // 获取当前棋子的有效走法
                const moves = getValidMoves(board, { r: info.r, c: info.c });
                if (moves.length > 0) {
                    hasMoves = true;
                    break;
                }
            }
        }
        
        // 判断游戏状态
        let gameState = { status: 'playing' };
        if (!hasMoves) {
            // 没有合法走法，检查是否被将军
            const inCheck = currentPlayer === 'red' ? boardInfo.redIsInCheck : boardInfo.blackIsInCheck;
            const opponent = currentPlayer === 'red' ? 'black' : 'red';
            
            if (inCheck) {
                gameState = { status: 'checkmate', winner: opponent };
            } else {
                gameState = { status: 'stalemate', winner: opponent };
            }
        }
        
        // 保存游戏状态到boardInfo
        boardInfo.gameState = gameState;
    }
};

// 棋子几何方向表（预计算腿/眼偏移，热路径避免 Math.sign / dr/2）
const ORTH_DIRS = [
    [0, 1], [0, -1], [1, 0], [-1, 0]
];
const DIAG_DIRS = [
    [1, 1], [1, -1], [-1, 1], [-1, -1]
];
const ELEPHANT_DIRS = [
    { dr: 2, dc: 2, eyeDr: 1, eyeDc: 1 },
    { dr: 2, dc: -2, eyeDr: 1, eyeDc: -1 },
    { dr: -2, dc: 2, eyeDr: -1, eyeDc: 1 },
    { dr: -2, dc: -2, eyeDr: -1, eyeDc: -1 }
];
const HORSE_DIRS = [
    { dr: 2, dc: 1, legDr: 1, legDc: 0 },
    { dr: 2, dc: -1, legDr: 1, legDc: 0 },
    { dr: -2, dc: 1, legDr: -1, legDc: 0 },
    { dr: -2, dc: -1, legDr: -1, legDc: 0 },
    { dr: 1, dc: 2, legDr: 0, legDc: 1 },
    { dr: 1, dc: -2, legDr: 0, legDc: -1 },
    { dr: -1, dc: 2, legDr: 0, legDc: 1 },
    { dr: -1, dc: -2, legDr: 0, legDc: -1 }
];

// 短步子预表：与原 switch 方向顺序/宫河过滤一致；马象带 br,bc（腿/眼）
const GENERAL_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];
const ADVISOR_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];
const ELEPHANT_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];
const HORSE_DEST = new Array(REL_SQUARES);
const SOLDIER_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];

(() => {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const sq = r * 9 + c;
            const gRed = [], gBlack = [], aRed = [], aBlack = [];
            const eRed = [], eBlack = [], horse = [], sRed = [], sBlack = [];

            for (let i = 0; i < ORTH_DIRS.length; i++) {
                const nr = r + ORTH_DIRS[i][0], nc = c + ORTH_DIRS[i][1];
                if (nc < 3 || nc > 5) continue;
                if (nr >= 0 && nr <= 2) gRed.push({ r: nr, c: nc });
                if (nr >= 7 && nr <= 9) gBlack.push({ r: nr, c: nc });
            }
            for (let i = 0; i < DIAG_DIRS.length; i++) {
                const nr = r + DIAG_DIRS[i][0], nc = c + DIAG_DIRS[i][1];
                if (nc < 3 || nc > 5) continue;
                if (nr >= 0 && nr <= 2) aRed.push({ r: nr, c: nc });
                if (nr >= 7 && nr <= 9) aBlack.push({ r: nr, c: nc });
            }
            for (let i = 0; i < ELEPHANT_DIRS.length; i++) {
                const d = ELEPHANT_DIRS[i];
                const nr = r + d.dr, nc = c + d.dc;
                if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
                const eyeR = r + d.eyeDr, eyeC = c + d.eyeDc;
                if (nr <= 4) eRed.push({ r: nr, c: nc, br: eyeR, bc: eyeC });
                if (nr >= 5) eBlack.push({ r: nr, c: nc, br: eyeR, bc: eyeC });
            }
            for (let i = 0; i < HORSE_DIRS.length; i++) {
                const d = HORSE_DIRS[i];
                const nr = r + d.dr, nc = c + d.dc;
                const legR = r + d.legDr, legC = c + d.legDc;
                if (legR < 0 || legR >= ROWS || legC < 0 || legC >= COLS) continue;
                if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
                horse.push({ r: nr, c: nc, br: legR, bc: legC });
            }
            {
                const fr = r + 1;
                if (fr >= 0 && fr < ROWS) sRed.push({ r: fr, c });
                if (r >= 5) {
                    if (c - 1 >= 0) sRed.push({ r, c: c - 1 });
                    if (c + 1 < COLS) sRed.push({ r, c: c + 1 });
                }
                const fbr = r - 1;
                if (fbr >= 0 && fbr < ROWS) sBlack.push({ r: fbr, c });
                if (r <= 4) {
                    if (c - 1 >= 0) sBlack.push({ r, c: c - 1 });
                    if (c + 1 < COLS) sBlack.push({ r, c: c + 1 });
                }
            }

            GENERAL_DEST[0][sq] = gRed;
            GENERAL_DEST[1][sq] = gBlack;
            ADVISOR_DEST[0][sq] = aRed;
            ADVISOR_DEST[1][sq] = aBlack;
            ELEPHANT_DEST[0][sq] = eRed;
            ELEPHANT_DEST[1][sq] = eBlack;
            HORSE_DEST[sq] = horse;
            SOLDIER_DEST[0][sq] = sRed;
            SOLDIER_DEST[1][sq] = sBlack;
        }
    }
})();

// 短步/挡腿目的地压成 data+offset，避免每格一个小 TypedArray。
const DEST_OFF_STRIDE = REL_SQUARES + 1;
const packColorShortDests = (src) => {
    const offsets = new Uint16Array(2 * DEST_OFF_STRIDE);
    const bytes = [];
    for (let color = 0; color < 2; color++) {
        for (let sq = 0; sq < REL_SQUARES; sq++) {
            offsets[color * DEST_OFF_STRIDE + sq] = bytes.length;
            const dests = src[color][sq];
            for (let i = 0; i < dests.length; i++) bytes.push(dests[i].r * 9 + dests[i].c);
        }
        offsets[color * DEST_OFF_STRIDE + REL_SQUARES] = bytes.length;
    }
    return { offsets, data: new Uint8Array(bytes) };
};
const packColorBlockedDests = (src) => {
    const offsets = new Uint16Array(2 * DEST_OFF_STRIDE);
    const words = [];
    for (let color = 0; color < 2; color++) {
        for (let sq = 0; sq < REL_SQUARES; sq++) {
            offsets[color * DEST_OFF_STRIDE + sq] = words.length;
            const dests = src[color][sq];
            for (let i = 0; i < dests.length; i++) {
                words.push((dests[i].br * 9 + dests[i].bc) * 128 + dests[i].r * 9 + dests[i].c);
            }
        }
        offsets[color * DEST_OFF_STRIDE + REL_SQUARES] = words.length;
    }
    return { offsets, data: new Uint16Array(words) };
};
const packSquareBlockedDests = (src) => {
    const offsets = new Uint16Array(DEST_OFF_STRIDE);
    const words = [];
    for (let sq = 0; sq < REL_SQUARES; sq++) {
        offsets[sq] = words.length;
        const dests = src[sq];
        for (let i = 0; i < dests.length; i++) {
            words.push((dests[i].br * 9 + dests[i].bc) * 128 + dests[i].r * 9 + dests[i].c);
        }
    }
    offsets[REL_SQUARES] = words.length;
    return { offsets, data: new Uint16Array(words) };
};
const packedGeneralDest = packColorShortDests(GENERAL_DEST);
const packedAdvisorDest = packColorShortDests(ADVISOR_DEST);
const packedSoldierDest = packColorShortDests(SOLDIER_DEST);
const packedElephantDest = packColorBlockedDests(ELEPHANT_DEST);
const packedHorseDest = packSquareBlockedDests(HORSE_DEST);
const SEARCH_GENERAL_DEST_OFF = packedGeneralDest.offsets;
const SEARCH_GENERAL_DEST_DATA = packedGeneralDest.data;
const SEARCH_ADVISOR_DEST_OFF = packedAdvisorDest.offsets;
const SEARCH_ADVISOR_DEST_DATA = packedAdvisorDest.data;
const SEARCH_SOLDIER_DEST_OFF = packedSoldierDest.offsets;
const SEARCH_SOLDIER_DEST_DATA = packedSoldierDest.data;
const SEARCH_ELEPHANT_DEST_OFF = packedElephantDest.offsets;
const SEARCH_ELEPHANT_DEST_DATA = packedElephantDest.data;
const SEARCH_HORSE_DEST_OFF = packedHorseDest.offsets;
const SEARCH_HORSE_DEST_DATA = packedHorseDest.data;
// All orthogonal rays live in one compact buffer. The offset table avoids
// hundreds of tiny TypedArrays in the relation, pseudo-move, and check paths.
const SEARCH_RAY_OFFSETS = new Uint16Array(REL_SQUARES * ORTH_DIRS.length + 1);
let SEARCH_RAY_SQUARES = null;
const SEARCH_RAY_DIRS = 4;
const SEARCH_HORSE_CHECKER_OFF = new Uint16Array(DEST_OFF_STRIDE);
let SEARCH_HORSE_CHECKER_DATA = null;
const SEARCH_GIVES_CHECK_NEAR = new Uint32Array(REL_SQUARES * 3);
const SEARCH_SQ_ROWS = new Uint8Array(REL_SQUARES);
const SEARCH_SQ_COLS = new Uint8Array(REL_SQUARES);
const SEARCH_RELATIVE_SCAN_SQUARES = [
    new Uint8Array(REL_SQUARES),
    new Uint8Array(REL_SQUARES)
];
// 数值安全只查询对方将所在九宫的空格。
// bit 0: red attack is relevant (black palace); bit 1: black attack is relevant (red palace).
const SEARCH_ATTACK_TARGET = new Uint8Array(REL_SQUARES);

(() => {
    const searchRaySquares = [];
    const horseCheckerWords = [];
    const markGiveCheckNear = (kingSq, target) => {
        SEARCH_GIVES_CHECK_NEAR[kingSq * 3 + (target >>> 5)] |= 1 << (target & 31);
    };

    for (let sq = 0; sq < REL_SQUARES; sq++) {
        const r = (sq / 9) | 0;
        const c = sq % 9;
        SEARCH_SQ_ROWS[sq] = r;
        SEARCH_SQ_COLS[sq] = c;
        SEARCH_RELATIVE_SCAN_SQUARES[0][sq] = sq;
        SEARCH_RELATIVE_SCAN_SQUARES[1][sq] = (ROWS - 1 - r) * COLS + c;
        if (c >= 3 && c <= 5) {
            if (r <= 2) SEARCH_ATTACK_TARGET[sq] = 2;
            else if (r >= 7) SEARCH_ATTACK_TARGET[sq] = 1;
        }
        for (let dir = 0; dir < ORTH_DIRS.length; dir++) {
            SEARCH_RAY_OFFSETS[(sq << 2) | dir] = searchRaySquares.length;
            const dr = ORTH_DIRS[dir][0];
            const dc = ORTH_DIRS[dir][1];
            for (let nr = r + dr, nc = c + dc; nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS; nr += dr, nc += dc) {
                searchRaySquares.push(nr * 9 + nc);
            }
        }

        SEARCH_HORSE_CHECKER_OFF[sq] = horseCheckerWords.length;
        for (let i = 0; i < HORSE_DIRS.length; i++) {
            const d = HORSE_DIRS[i];
            const horseR = r + d.dr;
            const horseC = c + d.dc;
            if (horseR < 0 || horseR >= ROWS || horseC < 0 || horseC >= COLS) continue;
            const legR = horseR - d.legDr;
            const legC = horseC - d.legDc;
            const entry = (legR * 9 + legC) * 128 + horseR * 9 + horseC;
            horseCheckerWords.push(entry);
            markGiveCheckNear(sq, entry & 127);
            markGiveCheckNear(sq, entry >>> 7);
        }
        if (r <= 2) {
            if (r + 1 < ROWS) markGiveCheckNear(sq, (r + 1) * 9 + c);
            if (c > 0) markGiveCheckNear(sq, sq - 1);
            if (c < COLS - 1) markGiveCheckNear(sq, sq + 1);
        } else if (r >= 7) {
            if (r > 0) markGiveCheckNear(sq, (r - 1) * 9 + c);
            if (c > 0) markGiveCheckNear(sq, sq - 1);
            if (c < COLS - 1) markGiveCheckNear(sq, sq + 1);
        }
    }
    SEARCH_HORSE_CHECKER_OFF[REL_SQUARES] = horseCheckerWords.length;
    SEARCH_HORSE_CHECKER_DATA = new Uint16Array(horseCheckerWords);
    SEARCH_RAY_OFFSETS[REL_SQUARES << 2] = searchRaySquares.length;
    SEARCH_RAY_SQUARES = new Uint8Array(searchRaySquares);
})();

// Ranks use 9-bit occupancy and files use 10-bit occupancy. Each lookup returns
// the first/second blocker in both directions, empty mobility before the first
// blocker, and empty control squares before/between blockers for rook/cannon.
const createOrthogonalLineLookup = (length) => {
    const occupancyCount = 1 << length;
    const entryCount = length * occupancyCount;
    const firstLow = new Uint8Array(entryCount);
    const firstHigh = new Uint8Array(entryCount);
    const secondLow = new Uint8Array(entryCount);
    const secondHigh = new Uint8Array(entryCount);
    const thirdLow = new Uint8Array(entryCount);
    const thirdHigh = new Uint8Array(entryCount);
    const mobility = new Uint8Array(entryCount);
    const rookControl = new Uint16Array(entryCount);
    const cannonControl = new Uint16Array(entryCount);
    firstLow.fill(255);
    firstHigh.fill(255);
    secondLow.fill(255);
    secondHigh.fill(255);
    thirdLow.fill(255);
    thirdHigh.fill(255);

    for (let from = 0; from < length; from++) {
        const base = from * occupancyCount;
        for (let occupancy = 0; occupancy < occupancyCount; occupancy++) {
            const key = base + occupancy;
            let first = -1;
            let second = -1;
            for (let pos = from - 1; pos >= 0; pos--) {
                if (occupancy & (1 << pos)) {
                    if (first < 0) {
                        first = pos;
                        firstLow[key] = pos;
                    } else if (second < 0) {
                        second = pos;
                        secondLow[key] = pos;
                    } else {
                        thirdLow[key] = pos;
                        break;
                    }
                } else if (first < 0) {
                    mobility[key]++;
                    rookControl[key] |= 1 << pos;
                } else {
                    cannonControl[key] |= 1 << pos;
                }
            }

            first = -1;
            second = -1;
            for (let pos = from + 1; pos < length; pos++) {
                if (occupancy & (1 << pos)) {
                    if (first < 0) {
                        first = pos;
                        firstHigh[key] = pos;
                    } else if (second < 0) {
                        second = pos;
                        secondHigh[key] = pos;
                    } else {
                        thirdHigh[key] = pos;
                        break;
                    }
                } else if (first < 0) {
                    mobility[key]++;
                    rookControl[key] |= 1 << pos;
                } else {
                    cannonControl[key] |= 1 << pos;
                }
            }
        }
    }

    return {
        occupancyCount,
        firstLow,
        firstHigh,
        secondLow,
        secondHigh,
        thirdLow,
        thirdHigh,
        mobility,
        rookControl,
        cannonControl
    };
};

const SEARCH_RANK_LOOKUP = createOrthogonalLineLookup(COLS);
const SEARCH_FILE_LOOKUP = createOrthogonalLineLookup(ROWS);
const RANK_OCC_COUNT = SEARCH_RANK_LOOKUP.occupancyCount;
const FILE_OCC_COUNT = SEARCH_FILE_LOOKUP.occupancyCount;
const RANK_MOBILITY = SEARCH_RANK_LOOKUP.mobility;
const RANK_FIRST_HIGH = SEARCH_RANK_LOOKUP.firstHigh;
const RANK_FIRST_LOW = SEARCH_RANK_LOOKUP.firstLow;
const RANK_SECOND_HIGH = SEARCH_RANK_LOOKUP.secondHigh;
const RANK_SECOND_LOW = SEARCH_RANK_LOOKUP.secondLow;
const RANK_THIRD_HIGH = SEARCH_RANK_LOOKUP.thirdHigh;
const RANK_THIRD_LOW = SEARCH_RANK_LOOKUP.thirdLow;
const RANK_ROOK_CONTROL = SEARCH_RANK_LOOKUP.rookControl;
const RANK_CANNON_CONTROL = SEARCH_RANK_LOOKUP.cannonControl;
const FILE_MOBILITY = SEARCH_FILE_LOOKUP.mobility;
const FILE_FIRST_HIGH = SEARCH_FILE_LOOKUP.firstHigh;
const FILE_FIRST_LOW = SEARCH_FILE_LOOKUP.firstLow;
const FILE_SECOND_HIGH = SEARCH_FILE_LOOKUP.secondHigh;
const FILE_SECOND_LOW = SEARCH_FILE_LOOKUP.secondLow;
const FILE_THIRD_HIGH = SEARCH_FILE_LOOKUP.thirdHigh;
const FILE_THIRD_LOW = SEARCH_FILE_LOOKUP.thirdLow;
const FILE_ROOK_CONTROL = SEARCH_FILE_LOOKUP.rookControl;
const FILE_CANNON_CONTROL = SEARCH_FILE_LOOKUP.cannonControl;

// 垫将：离开钉线会发现对方将。线外失去保护；钉线上仍可反吃。
// 车/将面对面：整条横/竖线；炮隔两子：只能保那门炮；马腿：只能保那匹马。
const collectPinnedGuardSlots = (pieceState) => {
    const squareCodes = pieceState.squareCodes;
    const squareToSlot = pieceState.squareToSlot;
    const rowOccupancy = pieceState.rowOccupancy;
    const colOccupancy = pieceState.colOccupancy;
    scratchPinRank.fill(-1);
    scratchPinFile.fill(-1);
    scratchPinOnlySq.fill(-1);
    let pinned = 0;

    const pinOwnAt = (sq, kingIsRed, rank, file, onlySq) => {
        const code = squareCodes[sq];
        if (code === 0 || (code & 7) === 1) return;
        if ((code < 8) !== kingIsRed) return;
        const slot = squareToSlot[sq];
        pinned |= 1 << slot;
        if (rank >= 0) scratchPinRank[slot] = rank;
        if (file >= 0) scratchPinFile[slot] = file;
        if (onlySq >= 0) {
            const prev = scratchPinOnlySq[slot];
            if (prev >= 0 && prev !== onlySq) scratchPinOnlySq[slot] = -2;
            else if (prev !== -2) scratchPinOnlySq[slot] = onlySq;
        }
    };

    const scanRay = (first, second, third, toSq, kingIsRed, rank, file) => {
        if (first === 255 || second === 255) return;
        const secondSq = toSq(second);
        const secondCode = squareCodes[secondSq];
        if (((secondCode < 8) !== kingIsRed) && (secondCode & 7) < 3) {
            pinOwnAt(toSq(first), kingIsRed, rank, file, -1);
        }
        if (third !== 255) {
            const thirdSq = toSq(third);
            const thirdCode = squareCodes[thirdSq];
            if (((thirdCode < 8) !== kingIsRed) && (thirdCode & 7) === 6) {
                pinOwnAt(toSq(first), kingIsRed, -1, -1, thirdSq);
                pinOwnAt(secondSq, kingIsRed, -1, -1, thirdSq);
            }
        }
    };

    const pinFromKing = (kingSq, kingIsRed) => {
        if (kingSq < 0) return;
        const r = SEARCH_SQ_ROWS[kingSq];
        const c = SEARCH_SQ_COLS[kingSq];
        const rankKey = c * RANK_OCC_COUNT + rowOccupancy[r];
        const fileKey = r * FILE_OCC_COUNT + colOccupancy[c];
        scanRay(
            RANK_FIRST_HIGH[rankKey], RANK_SECOND_HIGH[rankKey], RANK_THIRD_HIGH[rankKey],
            (col) => r * 9 + col, kingIsRed, r, -1
        );
        scanRay(
            RANK_FIRST_LOW[rankKey], RANK_SECOND_LOW[rankKey], RANK_THIRD_LOW[rankKey],
            (col) => r * 9 + col, kingIsRed, r, -1
        );
        scanRay(
            FILE_FIRST_HIGH[fileKey], FILE_SECOND_HIGH[fileKey], FILE_THIRD_HIGH[fileKey],
            (row) => row * 9 + c, kingIsRed, -1, c
        );
        scanRay(
            FILE_FIRST_LOW[fileKey], FILE_SECOND_LOW[fileKey], FILE_THIRD_LOW[fileKey],
            (row) => row * 9 + c, kingIsRed, -1, c
        );

        const horseCheckerData = SEARCH_HORSE_CHECKER_DATA;
        for (let i = SEARCH_HORSE_CHECKER_OFF[kingSq], n = SEARCH_HORSE_CHECKER_OFF[kingSq + 1]; i < n; i++) {
            const entry = horseCheckerData[i];
            const horseSq = entry & 127;
            const horseCode = squareCodes[horseSq];
            if ((horseCode & 7) !== 3 || (horseCode < 8) === kingIsRed) continue;
            pinOwnAt(entry >>> 7, kingIsRed, -1, -1, horseSq);
        }
    };

    pinFromKing(pieceState.redGeneralSq, true);
    pinFromKing(pieceState.blackGeneralSq, false);
    return pinned >>> 0;
};

const pinnedCanGuardSquare = (slot, targetSq) => {
    const only = scratchPinOnlySq[slot];
    if (only === -2) return false;
    if (only >= 0 && targetSq !== only) return false;
    const rank = scratchPinRank[slot];
    if (rank >= 0 && SEARCH_SQ_ROWS[targetSq] !== rank) return false;
    const file = scratchPinFile[slot];
    if (file >= 0 && SEARCH_SQ_COLS[targetSq] !== file) return false;
    return true;
};

const dropPinnedOffLineGuards = (guards, pinned, targetSq) => {
    let drop = 0;
    let bits = (guards & pinned) >>> 0;
    while (bits !== 0) {
        const bit = bits & -bits;
        const slot = 31 - Math.clz32(bit);
        bits ^= bit;
        if (!pinnedCanGuardSquare(slot, targetSq)) drop |= bit;
    }
    return drop;
};

const applyPinnedGuardFilterToLeaf = (pieceState) => {
    const pinned = collectPinnedGuardSlots(pieceState);
    if (pinned === 0) return;
    const guardBySlot = scratchLeafGuardBySlot;
    const pieceSquares = pieceState.pieceSquares;
    for (let target = 0; target < 32; target++) {
        const guards = guardBySlot[target] >>> 0;
        if ((guards & pinned) === 0) continue;
        const drop = dropPinnedOffLineGuards(guards, pinned, pieceSquares[target]);
        if (drop) guardBySlot[target] = guards & ~drop;
    }
};

const applyPinnedGuardFilterToRelations = (board, piecesInfo, boardInfo) => {
    runWithPieceState(board, () => {
        const state = activePieceStateFor(board);
        if (!state) return;
        const pinnedSlots = collectPinnedGuardSlots(state);
        if (pinnedSlots === 0) return;
        const squareToSlot = state.squareToSlot;
        if (boardInfo && boardInfo.useRelationMasks) {
            const guardMask = boardInfo.guardMask;
            for (let sq = 0; sq < REL_SQUARES; sq++) {
                let gm = guardMask[sq] >>> 0;
                if (gm === 0) continue;
                let keep = 0;
                while (gm !== 0) {
                    const bit = gm & -gm;
                    const info = piecesInfo[31 - Math.clz32(bit)];
                    const guardSlot = squareToSlot[info.r * 9 + info.c];
                    if (guardSlot < 0 || (pinnedSlots & (1 << guardSlot)) === 0 ||
                        pinnedCanGuardSquare(guardSlot, sq)) {
                        keep |= bit;
                    }
                    gm ^= bit;
                }
                guardMask[sq] = keep;
            }
            return;
        }
        for (let i = 0; i < piecesInfo.length; i++) {
            const info = piecesInfo[i];
            const guardSlot = squareToSlot[info.r * 9 + info.c];
            if (guardSlot < 0 || (pinnedSlots & (1 << guardSlot)) === 0) continue;
            const guarded = info.guard;
            let write = 0;
            for (let k = 0; k < guarded.length; k++) {
                const target = guarded[k];
                if (pinnedCanGuardSquare(guardSlot, target.r * 9 + target.c)) {
                    guarded[write++] = target;
                    continue;
                }
                const list = target.guardedBy;
                if (!list) continue;
                let w = 0;
                for (let r = 0; r < list.length; r++) {
                    if (list[r] !== info) list[w++] = list[r];
                }
                list.length = w;
            }
            info.guard.length = write;
            if (info.allyGuards) {
                const allies = info.allyGuards;
                let a = 0;
                for (let k = 0; k < allies.length; k++) {
                    if (pinnedCanGuardSquare(guardSlot, allies[k].r * 9 + allies[k].c)) {
                        allies[a++] = allies[k];
                    }
                }
                allies.length = a;
            }
        }
    });
};

let leafWMaterial = VALUE_WEIGHTS.material;
let leafWPosition = VALUE_WEIGHTS.position;
let leafWThreat = VALUE_WEIGHTS.threat;
let leafWSafety = VALUE_WEIGHTS.safety;
let leafWMobility = VALUE_WEIGHTS.mobility;
let leafUnityWeights = true;

const snapshotLeafWeights = () => {
    leafWMaterial = VALUE_WEIGHTS.material;
    leafWPosition = VALUE_WEIGHTS.position;
    leafWThreat = VALUE_WEIGHTS.threat;
    leafWSafety = VALUE_WEIGHTS.safety;
    leafWMobility = VALUE_WEIGHTS.mobility;
    leafUnityWeights = leafWMaterial === 1 && leafWPosition === 1 &&
        leafWThreat === 1 && leafWSafety === 1 && leafWMobility === 1;
};

const collectOwnSlotsInScanOrder = (pieceState, isRed) => {
    const pieceSquares = pieceState.pieceSquares;
    const slots = scratchOwnScanSlots;
    const orders = scratchOwnScanOrder;
    const scanOrder = SEARCH_RELATIVE_SCAN_SQUARES[isRed ? 0 : 1];
    let n = 0;
    let mask = (isRed ? pieceState.redAliveMask : pieceState.blackAliveMask) >>> 0;
    while (mask !== 0) {
        const bit = mask & -mask;
        const slot = 31 - Math.clz32(bit);
        mask ^= bit;
        const sq = pieceSquares[slot];
        if (sq >= REL_SQUARES) continue;
        const order = scanOrder[sq];
        let j = n - 1;
        while (j >= 0 && orders[j] > order) {
            orders[j + 1] = orders[j];
            slots[j + 1] = slots[j];
            j--;
        }
        orders[j + 1] = order;
        slots[j + 1] = slot;
        n++;
    }
    return n;
};

const applyOccupiedSliderHit = (
    sq, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
) => {
    const targetCode = squareCodes[sq];
    const targetSlot = squareToSlot[sq];
    if ((targetCode < 8) !== isRed) {
        attackBySlot[targetSlot] |= bit;
        return 1 << targetSlot;
    }
    if ((targetCode & 7) !== 1) guardBySlot[targetSlot] |= bit;
    return 0;
};

const applyOccupiedSliderHitWithCapture = (
    sq, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
    recordCaptures, fromSq, captureCounts, captureSources, captureMoves
) => {
    const targetCode = squareCodes[sq];
    const targetSlot = squareToSlot[sq];
    if ((targetCode < 8) !== isRed) {
        attackBySlot[targetSlot] |= bit;
        if (recordCaptures) {
            if (captureCounts[fromSq] === 0) {
                captureSources[scratchPackedCaptureSourceCount++] = fromSq;
            }
            captureMoves[fromSq * PACKED_CAPTURE_STRIDE + captureCounts[fromSq]++] =
                (fromSq << 7) | sq;
        }
        return 1 << targetSlot;
    }
    if ((targetCode & 7) !== 1) guardBySlot[targetSlot] |= bit;
    return 0;
};

const appendSearchShortMoves = (
    moves, fromSq, destData, destStart, destEnd, squareCodes, isRed, capturesOnly, blocked, targetMask = null, quietsOnly = false
) => {
    let generated = 0;
    for (let i = destStart; i < destEnd; i++) {
        let toSq = destData[i];
        if (blocked) {
            if (squareCodes[toSq >>> 7] !== 0) continue;
            toSq &= 127;
        }
        if (targetMask && !targetMask[toSq]) continue;
        const targetCode = squareCodes[toSq];
        if (targetCode === 0) {
            if (capturesOnly) continue;
            generated++;
            moves.push((fromSq << 7) | toSq);
        } else if (!quietsOnly && (targetCode < 8) !== isRed) {
            generated++;
            moves.push((fromSq << 7) | toSq);
        }
    }
    return generated;
};

const appendLineEmpties = (moves, fromSq, firstSq, lastSq, stride, targetMask) => {
    let generated = 0;
    if (stride > 0) {
        for (let sq = firstSq; sq <= lastSq; sq += stride) {
            if (!targetMask || targetMask[sq]) {
                generated++;
                moves.push((fromSq << 7) | sq);
            }
        }
    } else {
        for (let sq = firstSq; sq >= lastSq; sq += stride) {
            if (!targetMask || targetMask[sq]) {
                generated++;
                moves.push((fromSq << 7) | sq);
            }
        }
    }
    return generated;
};

const appendSliderCapture = (moves, fromSq, sq, squareCodes, isRed, quietsOnly, targetMask) => {
    if (quietsOnly) return 0;
    const targetCode = squareCodes[sq];
    if ((targetCode < 8) !== isRed && (!targetMask || targetMask[sq])) {
        moves.push((fromSq << 7) | sq);
        return 1;
    }
    return 0;
};

// 方向与 ORTH_DIRS / 射线表一致：行高列、行低列、列高行、列低行。空步从本子往外走。
const appendOccupancyRookMoves = (
    moves, fromSq, pieceState, isRed, capturesOnly, quietsOnly, targetMask
) => {
    const squareCodes = pieceState.squareCodes;
    const r = SEARCH_SQ_ROWS[fromSq];
    const c = SEARCH_SQ_COLS[fromSq];
    const rankKey = c * RANK_OCC_COUNT + pieceState.rowOccupancy[r];
    const fileKey = r * FILE_OCC_COUNT + pieceState.colOccupancy[c];
    let generated = 0;

    const t0 = RANK_FIRST_HIGH[rankKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq + 1, r * 9 + (t0 === 255 ? 8 : t0 - 1), 1, targetMask
        );
    }
    if (t0 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, r * 9 + t0, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    const t1 = RANK_FIRST_LOW[rankKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq - 1, r * 9 + (t1 === 255 ? 0 : t1 + 1), -1, targetMask
        );
    }
    if (t1 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, r * 9 + t1, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    const t2 = FILE_FIRST_HIGH[fileKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq + 9, (t2 === 255 ? 9 : t2 - 1) * 9 + c, 9, targetMask
        );
    }
    if (t2 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, t2 * 9 + c, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    const t3 = FILE_FIRST_LOW[fileKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq - 9, (t3 === 255 ? 0 : t3 + 1) * 9 + c, -9, targetMask
        );
    }
    if (t3 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, t3 * 9 + c, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    return generated;
};

const appendOccupancyCannonMoves = (
    moves, fromSq, pieceState, isRed, capturesOnly, quietsOnly, targetMask
) => {
    const squareCodes = pieceState.squareCodes;
    const r = SEARCH_SQ_ROWS[fromSq];
    const c = SEARCH_SQ_COLS[fromSq];
    const rankKey = c * RANK_OCC_COUNT + pieceState.rowOccupancy[r];
    const fileKey = r * FILE_OCC_COUNT + pieceState.colOccupancy[c];
    let generated = 0;

    const t0 = RANK_FIRST_HIGH[rankKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq + 1, r * 9 + (t0 === 255 ? 8 : t0 - 1), 1, targetMask
        );
    }
    const s0 = RANK_SECOND_HIGH[rankKey];
    if (s0 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, r * 9 + s0, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    const t1 = RANK_FIRST_LOW[rankKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq - 1, r * 9 + (t1 === 255 ? 0 : t1 + 1), -1, targetMask
        );
    }
    const s1 = RANK_SECOND_LOW[rankKey];
    if (s1 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, r * 9 + s1, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    const t2 = FILE_FIRST_HIGH[fileKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq + 9, (t2 === 255 ? 9 : t2 - 1) * 9 + c, 9, targetMask
        );
    }
    const s2 = FILE_SECOND_HIGH[fileKey];
    if (s2 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, s2 * 9 + c, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    const t3 = FILE_FIRST_LOW[fileKey];
    if (!capturesOnly) {
        generated += appendLineEmpties(
            moves, fromSq, fromSq - 9, (t3 === 255 ? 0 : t3 + 1) * 9 + c, -9, targetMask
        );
    }
    const s3 = FILE_SECOND_LOW[fileKey];
    if (s3 !== 255) {
        generated += appendSliderCapture(
            moves, fromSq, s3 * 9 + c, squareCodes, isRed, quietsOnly, targetMask
        );
    }

    return generated;
};

const isOccupancyRookLegal = (fromSq, toSq, targetCode, rowOccupancy, colOccupancy) => {
    const r = SEARCH_SQ_ROWS[fromSq];
    const c = SEARCH_SQ_COLS[fromSq];
    const toR = SEARCH_SQ_ROWS[toSq];
    const toC = SEARCH_SQ_COLS[toSq];
    if (toR === r) {
        const rankKey = c * RANK_OCC_COUNT + rowOccupancy[r];
        if (toC > c) {
            const first = RANK_FIRST_HIGH[rankKey];
            return targetCode === 0 ? (first === 255 || first > toC) : first === toC;
        }
        if (toC < c) {
            const first = RANK_FIRST_LOW[rankKey];
            return targetCode === 0 ? (first === 255 || first < toC) : first === toC;
        }
        return false;
    }
    if (toC === c) {
        const fileKey = r * FILE_OCC_COUNT + colOccupancy[c];
        if (toR > r) {
            const first = FILE_FIRST_HIGH[fileKey];
            return targetCode === 0 ? (first === 255 || first > toR) : first === toR;
        }
        if (toR < r) {
            const first = FILE_FIRST_LOW[fileKey];
            return targetCode === 0 ? (first === 255 || first < toR) : first === toR;
        }
    }
    return false;
};

const isOccupancyCannonLegal = (fromSq, toSq, targetCode, rowOccupancy, colOccupancy) => {
    const r = SEARCH_SQ_ROWS[fromSq];
    const c = SEARCH_SQ_COLS[fromSq];
    const toR = SEARCH_SQ_ROWS[toSq];
    const toC = SEARCH_SQ_COLS[toSq];
    if (toR === r) {
        const rankKey = c * RANK_OCC_COUNT + rowOccupancy[r];
        if (toC > c) {
            if (targetCode === 0) {
                const first = RANK_FIRST_HIGH[rankKey];
                return first === 255 || first > toC;
            }
            return RANK_SECOND_HIGH[rankKey] === toC;
        }
        if (toC < c) {
            if (targetCode === 0) {
                const first = RANK_FIRST_LOW[rankKey];
                return first === 255 || first < toC;
            }
            return RANK_SECOND_LOW[rankKey] === toC;
        }
        return false;
    }
    if (toC === c) {
        const fileKey = r * FILE_OCC_COUNT + colOccupancy[c];
        if (toR > r) {
            if (targetCode === 0) {
                const first = FILE_FIRST_HIGH[fileKey];
                return first === 255 || first > toR;
            }
            return FILE_SECOND_HIGH[fileKey] === toR;
        }
        if (toR < r) {
            if (targetCode === 0) {
                const first = FILE_FIRST_LOW[fileKey];
                return first === 255 || first < toR;
            }
            return FILE_SECOND_LOW[fileKey] === toR;
        }
    }
    return false;
};

const appendSearchPseudoMovesForPiece = (
    moves, fromSq, pieceCode, pieceState, capturesOnly = false, targetMask = null, quietsOnly = false
) => {
    const squareCodes = pieceState.squareCodes;
    const pieceType = pieceCode & 7;
    const isRed = pieceCode < 8;
    const colorIdx = isRed ? 0 : 1;

    switch (pieceType) {
        case 1: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return appendSearchShortMoves(
                moves, fromSq, SEARCH_GENERAL_DEST_DATA,
                SEARCH_GENERAL_DEST_OFF[destBase], SEARCH_GENERAL_DEST_OFF[destBase + 1],
                squareCodes, isRed, capturesOnly, false, targetMask, quietsOnly
            );
        }
        case 5: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return appendSearchShortMoves(
                moves, fromSq, SEARCH_ADVISOR_DEST_DATA,
                SEARCH_ADVISOR_DEST_OFF[destBase], SEARCH_ADVISOR_DEST_OFF[destBase + 1],
                squareCodes, isRed, capturesOnly, false, targetMask, quietsOnly
            );
        }
        case 4: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return appendSearchShortMoves(
                moves, fromSq, SEARCH_ELEPHANT_DEST_DATA,
                SEARCH_ELEPHANT_DEST_OFF[destBase], SEARCH_ELEPHANT_DEST_OFF[destBase + 1],
                squareCodes, isRed, capturesOnly, true, targetMask, quietsOnly
            );
        }
        case 3:
            return appendSearchShortMoves(
                moves, fromSq, SEARCH_HORSE_DEST_DATA,
                SEARCH_HORSE_DEST_OFF[fromSq], SEARCH_HORSE_DEST_OFF[fromSq + 1],
                squareCodes, isRed, capturesOnly, true, targetMask, quietsOnly
            );
        case 7: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return appendSearchShortMoves(
                moves, fromSq, SEARCH_SOLDIER_DEST_DATA,
                SEARCH_SOLDIER_DEST_OFF[destBase], SEARCH_SOLDIER_DEST_OFF[destBase + 1],
                squareCodes, isRed, capturesOnly, false, targetMask, quietsOnly
            );
        }
        case 2:
            return appendOccupancyRookMoves(
                moves, fromSq, pieceState, isRed, capturesOnly, quietsOnly, targetMask
            );
        case 6:
            return appendOccupancyCannonMoves(
                moves, fromSq, pieceState, isRed, capturesOnly, quietsOnly, targetMask
            );
        default:
            return 0;
    }
};

const shortDestHas = (destData, destStart, destEnd, toSq) => {
    for (let i = destStart; i < destEnd; i++) {
        if (destData[i] === toSq) return true;
    }
    return false;
};

const blockedDestHas = (destData, destStart, destEnd, toSq, squareCodes) => {
    for (let i = destStart; i < destEnd; i++) {
        const packed = destData[i];
        if ((packed & 127) === toSq) return squareCodes[packed >>> 7] === 0;
    }
    return false;
};

// 与 appendSearchPseudoMovesForPiece 同一套几何，只判单步，不生成整表。
const isSearchPseudoLegal = (fromSq, toSq, pieceCode, pieceState) => {
    const squareCodes = pieceState.squareCodes;
    const targetCode = squareCodes[toSq];
    const isRed = pieceCode < 8;
    if (targetCode !== 0 && (targetCode < 8) === isRed) return false;

    const pieceType = pieceCode & 7;
    const colorIdx = isRed ? 0 : 1;
    switch (pieceType) {
        case 1: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return shortDestHas(
                SEARCH_GENERAL_DEST_DATA,
                SEARCH_GENERAL_DEST_OFF[destBase], SEARCH_GENERAL_DEST_OFF[destBase + 1], toSq
            );
        }
        case 5: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return shortDestHas(
                SEARCH_ADVISOR_DEST_DATA,
                SEARCH_ADVISOR_DEST_OFF[destBase], SEARCH_ADVISOR_DEST_OFF[destBase + 1], toSq
            );
        }
        case 4: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return blockedDestHas(
                SEARCH_ELEPHANT_DEST_DATA,
                SEARCH_ELEPHANT_DEST_OFF[destBase], SEARCH_ELEPHANT_DEST_OFF[destBase + 1],
                toSq, squareCodes
            );
        }
        case 3:
            return blockedDestHas(
                SEARCH_HORSE_DEST_DATA,
                SEARCH_HORSE_DEST_OFF[fromSq], SEARCH_HORSE_DEST_OFF[fromSq + 1],
                toSq, squareCodes
            );
        case 7: {
            const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
            return shortDestHas(
                SEARCH_SOLDIER_DEST_DATA,
                SEARCH_SOLDIER_DEST_OFF[destBase], SEARCH_SOLDIER_DEST_OFF[destBase + 1], toSq
            );
        }
        case 2:
            return isOccupancyRookLegal(
                fromSq, toSq, targetCode, pieceState.rowOccupancy, pieceState.colOccupancy
            );
        case 6:
            return isOccupancyCannonLegal(
                fromSq, toSq, targetCode, pieceState.rowOccupancy, pieceState.colOccupancy
            );
        default:
            return false;
    }
};

const markCheckerResolveSquares = (state, generalSq, checkerSq, kind, legSq, mask) => {
    let marked = 0;
    if (checkerSq >= 0 && checkerSq < REL_SQUARES) {
        mask[checkerSq] = 1;
        marked++;
    }
    if (kind === CHECK_KIND_HORSE) {
        if (legSq >= 0 && state.squareCodes[legSq] === 0) {
            mask[legSq] = 1;
            marked++;
        }
        return marked;
    }
    if (kind === CHECK_KIND_SOLDIER || checkerSq < 0 || generalSq < 0) return marked;
    const gr = SEARCH_SQ_ROWS[generalSq];
    const gc = SEARCH_SQ_COLS[generalSq];
    const cr = SEARCH_SQ_ROWS[checkerSq];
    const cc = SEARCH_SQ_COLS[checkerSq];
    const squareCodes = state.squareCodes;
    if (gr === cr) {
        const lo = gc < cc ? gc : cc;
        const hi = gc < cc ? cc : gc;
        const rowBase = gr * COLS;
        for (let c = lo + 1; c < hi; c++) {
            const sq = rowBase + c;
            if (squareCodes[sq] === 0) {
                mask[sq] = 1;
                marked++;
            }
        }
        return marked;
    }
    if (gc === cc) {
        const lo = gr < cr ? gr : cr;
        const hi = gr < cr ? cr : gr;
        for (let r = lo + 1; r < hi; r++) {
            const sq = r * COLS + gc;
            if (squareCodes[sq] === 0) {
                mask[sq] = 1;
                marked++;
            }
        }
    }
    return marked;
};

const fillResolveSquares = (state, generalSq, checkInfo, mask) => {
    mask.fill(0);
    if (checkInfo.count <= 0 || checkInfo.count > CHECK_INFO_CAP) return 0;
    let marked = markCheckerResolveSquares(
        state, generalSq, checkInfo.sq[0], checkInfo.kind[0], checkInfo.leg[0], mask
    );
    if (checkInfo.count === 1) return marked;
    for (let i = 1; i < checkInfo.count; i++) {
        evasionResolveScratch.fill(0);
        markCheckerResolveSquares(
            state, generalSq, checkInfo.sq[i], checkInfo.kind[i], checkInfo.leg[i], evasionResolveScratch
        );
        marked = 0;
        for (let sq = 0; sq < REL_SQUARES; sq++) {
            if (mask[sq] && evasionResolveScratch[sq]) marked++;
            else mask[sq] = 0;
        }
    }
    return marked;
};

const isCannonScreenSquare = (sq, checkInfo) => {
    for (let i = 0; i < checkInfo.count; i++) {
        if (checkInfo.kind[i] === CHECK_KIND_CANNON && checkInfo.leg[i] === sq) return true;
    }
    return false;
};

// 与全盘子扫描同一顺序生成应将，保证合法着相对顺序不变。
const generateCheckEvasions = (moves, currentPlayer, pieceState, checkInfo) => {
    const start = moves.length;
    const isRed = currentPlayer === 'red';
    const generalSq = isRed ? pieceState.redGeneralSq : pieceState.blackGeneralSq;
    const pieceCodes = pieceState.pieceCodes;
    const pieceSquares = pieceState.pieceSquares;
    const fallback = checkInfo.count > CHECK_INFO_CAP || generalSq < 0;
    const resolveCount = fallback
        ? 0
        : fillResolveSquares(pieceState, generalSq, checkInfo, evasionResolveMask);

    const n = collectOwnSlotsInScanOrder(pieceState, isRed);
    for (let i = 0; i < n; i++) {
        const slot = scratchOwnScanSlots[i];
        const sq = pieceSquares[slot];
        if (fallback || sq === generalSq || isCannonScreenSquare(sq, checkInfo)) {
            appendSearchPseudoMovesForPiece(moves, sq, pieceCodes[slot], pieceState, false);
        } else if (resolveCount > 0) {
            appendSearchPseudoMovesForPiece(
                moves, sq, pieceCodes[slot], pieceState, false, evasionResolveMask
            );
        }
    }
    return moves.length - start;
};

const containsEncodedMoveBefore = (moves, end, move) => {
    for (let i = 0; i < end; i++) {
        if (moves[i] === move) return true;
    }
    return false;
};

const appendValidatedStagedSpecial = (moves, move, pieceState, currentPlayer, quietOnly) => {
    if (!isEncodedMove(move) || containsEncodedMoveBefore(moves, moves.length, move)) return false;
    const fromSq = move >>> 7;
    const toSq = move & MOVE_TO_MASK;
    if (fromSq >= REL_SQUARES || toSq >= REL_SQUARES) return false;
    const slot = pieceState.squareToSlot[fromSq];
    if (slot < 0) return false;
    const pieceCode = pieceState.pieceCodes[slot];
    const ownMask = pieceCode < 8 ? pieceState.redAliveMask : pieceState.blackAliveMask;
    if ((ownMask & (1 << slot)) === 0) return false;
    if ((pieceCode < 8) !== (currentPlayer === 'red')) return false;
    const targetCode = pieceState.squareCodes[toSq];
    if (quietOnly && targetCode !== 0) return false;
    if (!isSearchPseudoLegal(fromSq, toSq, pieceCode, pieceState)) return false;
    moves.push(move);
    return true;
};

// Appends exactly one stage: TT, quiet killers, captures, then quiets.
// Later stages exclude only specials that were actually validated and appended.
const appendTrueStagedMoves = (
    moves, stage, board, currentPlayer, pieceState, ttMove, killers
) => {
    const start = moves.length;
    if (stage === 0) {
        if (!isEncodedMove(ttMove)) return 0;
        appendValidatedStagedSpecial(moves, ttMove, pieceState, currentPlayer, false);
        return moves.length - start;
    }
    if (stage === 1) {
        if (!killers) return 0;
        appendValidatedStagedSpecial(moves, killers[0], pieceState, currentPlayer, true);
        appendValidatedStagedSpecial(moves, killers[1], pieceState, currentPlayer, true);
    } else if (stage === 2) {
        const pieceCodes = pieceState.pieceCodes;
        const pieceSquares = pieceState.pieceSquares;
        const n = collectOwnSlotsInScanOrder(pieceState, currentPlayer === 'red');
        for (let i = 0; i < n; i++) {
            const slot = scratchOwnScanSlots[i];
            const sq = pieceSquares[slot];
            const pieceStart = moves.length;
            appendSearchPseudoMovesForPiece(moves, sq, pieceCodes[slot], pieceState, true);
            let write = pieceStart;
            for (let read = pieceStart; read < moves.length; read++) {
                const move = moves[read];
                if (!containsEncodedMoveBefore(moves, start, move)) moves[write++] = move;
            }
            moves.length = write;
        }
    } else if (stage === 3) {
        const pieceCodes = pieceState.pieceCodes;
        const pieceSquares = pieceState.pieceSquares;
        const n = collectOwnSlotsInScanOrder(pieceState, currentPlayer === 'red');
        for (let i = 0; i < n; i++) {
            const slot = scratchOwnScanSlots[i];
            const sq = pieceSquares[slot];
            const pieceStart = moves.length;
            appendSearchPseudoMovesForPiece(
                moves, sq, pieceCodes[slot], pieceState, false, null, true
            );
            let write = pieceStart;
            for (let read = pieceStart; read < moves.length; read++) {
                const move = moves[read];
                if (!containsEncodedMoveBefore(moves, start, move)) moves[write++] = move;
            }
            moves.length = write;
        }
    }

    sortStagedMoveRange(moves, start, moves.length, board, currentPlayer, killers);
    return moves.length - start;
};

const advanceTrueStagedMoves = (
    moves, nextStage, board, currentPlayer, pieceState, ttMove, killers, depth
) => {
    while (nextStage < 4) {
        const stage = nextStage++;
        const started = searchContext.profile ? performance.now() : 0;
        const added = appendTrueStagedMoves(
            moves, stage, board, currentPlayer, pieceState, ttMove, killers
        );
        if (searchContext.profile) perfStats.prepareMoveGenMs += performance.now() - started;
        if (added > 0) break;
    }
    return nextStage;
};

// 模块级落点处理（非每子新建闭包）；返回机动增量
// pieceAtSq: 90 格 → piecesInfo；relCtx.useMasks 时写 mask
const applyRelationSquare = (board, info, pieceAtSq, tr, tc, useMasks, bit, relCtx, isRed, pieceColor) => {
    if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return 0;
    const target = board[tr][tc];
    if (!target) {
        if (useMasks) {
            const sq = tr * 9 + tc;
            if (shouldWriteControlMask(relCtx, sq)) relCtx.controlMask[sq] |= bit;
            if (isRed) setAttackBit(relCtx.redAttack, sq);
            else setAttackBit(relCtx.blackAttack, sq);
        } else {
            info.moves.push({ r: tr, c: tc });
            info.control.push({ r: tr, c: tc });
        }
        return EVALUATION_PARAMETERS.mobility.baseMoveValue;
    }
    if (target.color !== pieceColor) {
        if (useMasks) {
            if (pieceAtSq[tr * 9 + tc]) {
                relCtx.attackMask[tr * 9 + tc] |= bit;
            }
        } else {
            info.moves.push({ r: tr, c: tc });
            const targetInfo = pieceAtSq[tr * 9 + tc];
            if (targetInfo) {
                info.threat.push(targetInfo);
                targetInfo.threatenedBy.push(info);
            }
        }
        return 0;
    }
    if (target.type !== 'general') {
        const targetInfo = pieceAtSq[tr * 9 + tc];
        if (targetInfo && targetInfo !== info) {
            if (useMasks) {
                relCtx.guardMask[tr * 9 + tc] |= bit;
            } else {
                info.guard.push(targetInfo);
                targetInfo.guardedBy.push(info);
                info.allyGuards.push({ r: tr, c: tc });
            }
        }
    }
    return 0;
};

// 非炮：一次几何扫描；短步子走预表，车仍射线；语义与 getPieceMoves 一致
const fillNonCannonRelations = (board, info, pieceAtSq, relCtx = null) => {
    const piece = info.piece;
    const { r, c } = info;
    const isRed = piece.color === 'red';
    const pieceColor = piece.color;
    const useMasks = !!(relCtx && relCtx.useMasks);
    const bit = useMasks ? (1 << relCtx.pieceIndex) : 0;
    const colorIdx = isRed ? 0 : 1;
    const fromSq = r * 9 + c;
    if (!useMasks) {
        info.moves = [];
        info.control = [];
        info.allyGuards = [];
    }
    let mobilityValue = 0;

    switch (piece.type) {
        case 'general': {
            const dests = GENERAL_DEST[colorIdx][fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                mobilityValue += applyRelationSquare(
                    board, info, pieceAtSq, d.r, d.c, useMasks, bit, relCtx, isRed, pieceColor
                );
            }
            break;
        }
        case 'advisor': {
            const dests = ADVISOR_DEST[colorIdx][fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                mobilityValue += applyRelationSquare(
                    board, info, pieceAtSq, d.r, d.c, useMasks, bit, relCtx, isRed, pieceColor
                );
            }
            break;
        }
        case 'elephant': {
            const dests = ELEPHANT_DEST[colorIdx][fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                if (board[d.br][d.bc] === null) {
                    mobilityValue += applyRelationSquare(
                        board, info, pieceAtSq, d.r, d.c, useMasks, bit, relCtx, isRed, pieceColor
                    );
                }
            }
            break;
        }
        case 'horse': {
            const dests = HORSE_DEST[fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                if (board[d.br][d.bc] === null) {
                    mobilityValue += applyRelationSquare(
                        board, info, pieceAtSq, d.r, d.c, useMasks, bit, relCtx, isRed, pieceColor
                    );
                }
            }
            break;
        }
        case 'chariot':
            for (let i = 0; i < ORTH_DIRS.length; i++) {
                const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
                let nr = r + dr, nc = c + dc;
                while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                    const target = board[nr][nc];
                    if (target === null) {
                        if (useMasks) {
                            const sq = nr * 9 + nc;
                            if (shouldWriteControlMask(relCtx, sq)) relCtx.controlMask[sq] |= bit;
                            if (isRed) setAttackBit(relCtx.redAttack, sq);
                            else setAttackBit(relCtx.blackAttack, sq);
                        } else {
                            info.moves.push({ r: nr, c: nc });
                            info.control.push({ r: nr, c: nc });
                        }
                        mobilityValue += EVALUATION_PARAMETERS.mobility.baseMoveValue;
                    } else {
                        if (target.color !== pieceColor) {
                            if (useMasks) {
                                if (pieceAtSq[nr * 9 + nc]) {
                                    relCtx.attackMask[nr * 9 + nc] |= bit;
                                }
                            } else {
                                info.moves.push({ r: nr, c: nc });
                                const targetInfo = pieceAtSq[nr * 9 + nc];
                                if (targetInfo) {
                                    info.threat.push(targetInfo);
                                    targetInfo.threatenedBy.push(info);
                                }
                            }
                        } else if (target.type !== 'general') {
                            const targetInfo = pieceAtSq[nr * 9 + nc];
                            if (targetInfo && targetInfo !== info) {
                                if (useMasks) {
                                    relCtx.guardMask[nr * 9 + nc] |= bit;
                                } else {
                                    info.guard.push(targetInfo);
                                    targetInfo.guardedBy.push(info);
                                    info.allyGuards.push({ r: nr, c: nc });
                                }
                            }
                        }
                        break;
                    }
                    nr += dr;
                    nc += dc;
                }
            }
            break;
        case 'soldier': {
            const dests = SOLDIER_DEST[colorIdx][fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                applyRelationSquare(
                    board, info, pieceAtSq, d.r, d.c, useMasks, bit, relCtx, isRed, pieceColor
                );
            }
            break;
        }
        default:
            break;
    }
    info.mobilityValue = mobilityValue;
};

// 炮：一次四向射线；mask 模式写 attack/guard/control，列表模式保持旧语义
const fillCannonRelations = (board, info, pieceAtSq, relCtx = null) => {
    const piece = info.piece;
    const { r, c } = info;
    const isRed = piece.color === 'red';
    const pieceColor = piece.color;
    const useMasks = !!(relCtx && relCtx.useMasks);
    const bit = useMasks ? (1 << relCtx.pieceIndex) : 0;
    if (!useMasks) {
        info.moves = [];
        info.control = [];
    }
    let mobilityValue = 0;

    for (let i = 0; i < ORTH_DIRS.length; i++) {
        const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
        let nr = r + dr, nc = c + dc;
        let screenFoundCount = 0;
        while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && screenFoundCount < 2) {
            const p = board[nr][nc];
            if (p !== null) {
                screenFoundCount++;
                if (screenFoundCount === 2) {
                    const targetInfo = pieceAtSq[nr * 9 + nc];
                    if (targetInfo && targetInfo !== info) {
                        if (p.color !== pieceColor) {
                            if (useMasks) {
                                relCtx.attackMask[nr * 9 + nc] |= bit;
                            } else {
                                info.threat.push(targetInfo);
                                targetInfo.threatenedBy.push(info);
                                info.moves.push({ r: nr, c: nc });
                            }
                        } else if (p.type !== 'general') {
                            if (useMasks) {
                                relCtx.guardMask[nr * 9 + nc] |= bit;
                            } else {
                                info.guard.push(targetInfo);
                                targetInfo.guardedBy.push(info);
                            }
                        }
                    } else if (p.color !== pieceColor) {
                        if (!useMasks) info.moves.push({ r: nr, c: nc });
                    }
                    break;
                }
            } else if (screenFoundCount === 0) {
                if (!useMasks) info.moves.push({ r: nr, c: nc });
                mobilityValue += 1;
            } else if (screenFoundCount === 1) {
                if (useMasks) {
                    const sq = nr * 9 + nc;
                    if (shouldWriteControlMask(relCtx, sq)) relCtx.controlMask[sq] |= bit;
                    if (isRed) setAttackBit(relCtx.redAttack, sq);
                    else setAttackBit(relCtx.blackAttack, sq);
                } else {
                    info.control.push({ r: nr, c: nc });
                }
            }
            nr += dr;
            nc += dc;
        }
    }
    info.mobilityValue = mobilityValue;
};

// SoA 关系构建。占位目标关系按目标索引，攻击关系用稳定的 piece-state 槽（最多 32）。
// 跳过空槽以保持初始槽的攻击方顺序。快路径省略 QS 吃子打包（多数叶评估）。
const calculatePackedSearchLeafRelationsNumericFast = (pieceState, aliveMask) => {
    const profileRelations = searchContext.profile;
    const relationStart = profileRelations ? performance.now() : 0;
    const squareCodes = pieceState.squareCodes;
    const squareToSlot = pieceState.squareToSlot;
    const pieceCodes = pieceState.pieceCodes;
    const pieceSquares = pieceState.pieceSquares;
    const rowOccupancy = pieceState.rowOccupancy;
    const colOccupancy = pieceState.colOccupancy;
    const attackBySlot = scratchLeafAttackBySlot;
    const guardBySlot = scratchLeafGuardBySlot;
    const attackTarget = SEARCH_ATTACK_TARGET;
    const generalDestOff = SEARCH_GENERAL_DEST_OFF;
    const generalDestData = SEARCH_GENERAL_DEST_DATA;
    const advisorDestOff = SEARCH_ADVISOR_DEST_OFF;
    const advisorDestData = SEARCH_ADVISOR_DEST_DATA;
    const soldierDestOff = SEARCH_SOLDIER_DEST_OFF;
    const soldierDestData = SEARCH_SOLDIER_DEST_DATA;
    const elephantDestOff = SEARCH_ELEPHANT_DEST_OFF;
    const elephantDestData = SEARCH_ELEPHANT_DEST_DATA;
    const horseDestOff = SEARCH_HORSE_DEST_OFF;
    const horseDestData = SEARCH_HORSE_DEST_DATA;
    attackBySlot.fill(0);
    guardBySlot.fill(0);
    clearAttackBits(scratchRedAttack);
    clearAttackBits(scratchBlackAttack);

    const redAttack = scratchRedAttack;
    const blackAttack = scratchBlackAttack;
    let redMobility = 0;
    let blackMobility = 0;
    let attackedTargetMask = 0;

    const slotCount = pieceState.slotCount;
    for (let slot = 0; slot < slotCount; slot++) {
        const bit = 1 << slot;
        if ((aliveMask & bit) === 0) continue;
        const fromSq = pieceSquares[slot];
        const pieceCode = pieceCodes[slot];
        const pieceType = pieceCode & 7;
        const isRed = pieceCode < 8;
        const colorIdx = isRed ? 0 : 1;
        const attackTargetBit = isRed ? 1 : 2;
        const attackBits = isRed ? redAttack : blackAttack;
        let mobilityValue = 0;

        switch (pieceType) {
            case 1: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = generalDestOff[destBase], n = generalDestOff[destBase + 1]; i < n; i++) {
                    const sq = generalDestData[i];
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        // 将只走己方九宫，空步永远不是对方将安全点
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                        }
                        else if ((targetCode & 7) !== 1) guardBySlot[targetSlot] |= bit;
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 5: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = advisorDestOff[destBase], n = advisorDestOff[destBase + 1]; i < n; i++) {
                    const sq = advisorDestData[i];
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        // 仕只走己方九宫，空步永远不是对方将安全点
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                        }
                        else if ((targetCode & 7) !== 1) guardBySlot[targetSlot] |= bit;
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 7: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = soldierDestOff[destBase], n = soldierDestOff[destBase + 1]; i < n; i++) {
                    const sq = soldierDestData[i];
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        if (attackTarget[sq] & attackTargetBit) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                        }
                        else if ((targetCode & 7) !== 1) guardBySlot[targetSlot] |= bit;
                    }
                }
                break;
            }
            case 4: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = elephantDestOff[destBase], n = elephantDestOff[destBase + 1]; i < n; i++) {
                    const packed = elephantDestData[i];
                    if (squareCodes[packed >>> 7] !== 0) continue;
                    const sq = packed & 127;
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        // 相不过河，空步到不了对方九宫
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                        }
                        else if ((targetCode & 7) !== 1) guardBySlot[targetSlot] |= bit;
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 3: {
                for (let i = horseDestOff[fromSq], n = horseDestOff[fromSq + 1]; i < n; i++) {
                    const packed = horseDestData[i];
                    if (squareCodes[packed >>> 7] !== 0) continue;
                    const sq = packed & 127;
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        if (attackTarget[sq] & attackTargetBit) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                        }
                        else if ((targetCode & 7) !== 1) guardBySlot[targetSlot] |= bit;
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 2: {
                const r = SEARCH_SQ_ROWS[fromSq];
                const c = SEARCH_SQ_COLS[fromSq];
                const rankKey = c * RANK_OCC_COUNT + rowOccupancy[r];
                const fileKey = r * FILE_OCC_COUNT + colOccupancy[c];
                mobilityValue = RANK_MOBILITY[rankKey] + FILE_MOBILITY[fileKey];
                const t0 = RANK_FIRST_HIGH[rankKey];
                if (t0 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        r * 9 + t0, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                const t1 = RANK_FIRST_LOW[rankKey];
                if (t1 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        r * 9 + t1, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                const t2 = FILE_FIRST_HIGH[fileKey];
                if (t2 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        t2 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                const t3 = FILE_FIRST_LOW[fileKey];
                if (t3 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        t3 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                if (isRed ? r >= 7 : r <= 2) {
                    const rankControl = RANK_ROOK_CONTROL[rankKey];
                    if (rankControl & 0x38) {
                        if (rankControl & 8) {
                            const sq = r * 9 + 3;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 16) {
                            const sq = r * 9 + 4;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 32) {
                            const sq = r * 9 + 5;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (c >= 3 && c <= 5) {
                    const fileControl = FILE_ROOK_CONTROL[fileKey];
                    const fileMask = isRed ? 0x380 : 0x7;
                    if (fileControl & fileMask) {
                        const firstRow = isRed ? 7 : 0;
                        let sq = firstRow * 9 + c;
                        if (fileControl & (1 << firstRow)) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 1))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 2))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 6: {
                const r = SEARCH_SQ_ROWS[fromSq];
                const c = SEARCH_SQ_COLS[fromSq];
                const rankKey = c * RANK_OCC_COUNT + rowOccupancy[r];
                const fileKey = r * FILE_OCC_COUNT + colOccupancy[c];
                mobilityValue = RANK_MOBILITY[rankKey] + FILE_MOBILITY[fileKey];
                const t0 = RANK_SECOND_HIGH[rankKey];
                if (t0 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        r * 9 + t0, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                const t1 = RANK_SECOND_LOW[rankKey];
                if (t1 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        r * 9 + t1, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                const t2 = FILE_SECOND_HIGH[fileKey];
                if (t2 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        t2 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                const t3 = FILE_SECOND_LOW[fileKey];
                if (t3 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHit(
                        t3 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot
                    );
                }
                if (isRed ? r >= 7 : r <= 2) {
                    const rankControl = RANK_CANNON_CONTROL[rankKey];
                    if (rankControl & 0x38) {
                        if (rankControl & 8) {
                            const sq = r * 9 + 3;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 16) {
                            const sq = r * 9 + 4;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 32) {
                            const sq = r * 9 + 5;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (c >= 3 && c <= 5) {
                    const fileControl = FILE_CANNON_CONTROL[fileKey];
                    const fileMask = isRed ? 0x380 : 0x7;
                    if (fileControl & fileMask) {
                        const firstRow = isRed ? 7 : 0;
                        let sq = firstRow * 9 + c;
                        if (fileControl & (1 << firstRow)) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 1))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 2))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            default:
                break;
        }
        // 兵仍扫空步做威胁/安全，不进机动分；机动已在 1–6 兵种分支内累加
    }
    scratchLeafTotals[2] = redMobility;
    scratchLeafTotals[5] = blackMobility;
    scratchLeafAttackedTargetMask = attackedTargetMask >>> 0;
    applyPinnedGuardFilterToLeaf(pieceState);
    if (profileRelations) perfStats.leafRelationsMs += performance.now() - relationStart;
    leafRelationScratchFresh = true;
};

const calculatePackedSearchLeafRelationsNumericWithCaptures = (
    pieceState, aliveMask, capturePlayer
) => {
    const profileRelations = searchContext.profile;
    const relationStart = profileRelations ? performance.now() : 0;
    const squareCodes = pieceState.squareCodes;
    const squareToSlot = pieceState.squareToSlot;
    const pieceCodes = pieceState.pieceCodes;
    const pieceSquares = pieceState.pieceSquares;
    const rowOccupancy = pieceState.rowOccupancy;
    const colOccupancy = pieceState.colOccupancy;
    const attackBySlot = scratchLeafAttackBySlot;
    const guardBySlot = scratchLeafGuardBySlot;
    const attackTarget = SEARCH_ATTACK_TARGET;
    const generalDestOff = SEARCH_GENERAL_DEST_OFF;
    const generalDestData = SEARCH_GENERAL_DEST_DATA;
    const advisorDestOff = SEARCH_ADVISOR_DEST_OFF;
    const advisorDestData = SEARCH_ADVISOR_DEST_DATA;
    const soldierDestOff = SEARCH_SOLDIER_DEST_OFF;
    const soldierDestData = SEARCH_SOLDIER_DEST_DATA;
    const elephantDestOff = SEARCH_ELEPHANT_DEST_OFF;
    const elephantDestData = SEARCH_ELEPHANT_DEST_DATA;
    const horseDestOff = SEARCH_HORSE_DEST_OFF;
    const horseDestData = SEARCH_HORSE_DEST_DATA;
    const captureCounts = scratchPackedCaptureCounts;
    const captureSources = scratchPackedCaptureSources;
    const captureMoves = scratchPackedCaptureMoves;
    attackBySlot.fill(0);
    guardBySlot.fill(0);
    clearAttackBits(scratchRedAttack);
    clearAttackBits(scratchBlackAttack);
    const captureIsRed = capturePlayer === 'red';
    for (let i = 0; i < scratchPackedCaptureSourceCount; i++) {
        captureCounts[captureSources[i]] = 0;
    }
    scratchPackedCaptureSourceCount = 0;

    const redAttack = scratchRedAttack;
    const blackAttack = scratchBlackAttack;
    let redMobility = 0;
    let blackMobility = 0;
    let attackedTargetMask = 0;

    const slotCount = pieceState.slotCount;
    for (let slot = 0; slot < slotCount; slot++) {
        const bit = 1 << slot;
        if ((aliveMask & bit) === 0) continue;
        const fromSq = pieceSquares[slot];
        const pieceCode = pieceCodes[slot];
        const pieceType = pieceCode & 7;
        const isRed = pieceCode < 8;
        const colorIdx = isRed ? 0 : 1;
        const attackTargetBit = isRed ? 1 : 2;
        const attackBits = isRed ? redAttack : blackAttack;
        const recordCaptures = isRed === captureIsRed;
        let mobilityValue = 0;

        switch (pieceType) {
            case 1: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = generalDestOff[destBase], n = generalDestOff[destBase + 1]; i < n; i++) {
                    const sq = generalDestData[i];
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                            if (recordCaptures) {
                                if (captureCounts[fromSq] === 0) {
                                    captureSources[scratchPackedCaptureSourceCount++] = fromSq;
                                }
                                captureMoves[fromSq * PACKED_CAPTURE_STRIDE + captureCounts[fromSq]++] =
                                    (fromSq << 7) | sq;
                            }
                        } else if ((targetCode & 7) !== 1) {
                            guardBySlot[targetSlot] |= bit;
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 5: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = advisorDestOff[destBase], n = advisorDestOff[destBase + 1]; i < n; i++) {
                    const sq = advisorDestData[i];
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                            if (recordCaptures) {
                                if (captureCounts[fromSq] === 0) {
                                    captureSources[scratchPackedCaptureSourceCount++] = fromSq;
                                }
                                captureMoves[fromSq * PACKED_CAPTURE_STRIDE + captureCounts[fromSq]++] =
                                    (fromSq << 7) | sq;
                            }
                        } else if ((targetCode & 7) !== 1) {
                            guardBySlot[targetSlot] |= bit;
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 7: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = soldierDestOff[destBase], n = soldierDestOff[destBase + 1]; i < n; i++) {
                    const sq = soldierDestData[i];
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        if (attackTarget[sq] & attackTargetBit) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                            if (recordCaptures) {
                                if (captureCounts[fromSq] === 0) {
                                    captureSources[scratchPackedCaptureSourceCount++] = fromSq;
                                }
                                captureMoves[fromSq * PACKED_CAPTURE_STRIDE + captureCounts[fromSq]++] =
                                    (fromSq << 7) | sq;
                            }
                        } else if ((targetCode & 7) !== 1) {
                            guardBySlot[targetSlot] |= bit;
                        }
                    }
                }
                break;
            }
            case 4: {
                const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
                for (let i = elephantDestOff[destBase], n = elephantDestOff[destBase + 1]; i < n; i++) {
                    const packed = elephantDestData[i];
                    if (squareCodes[packed >>> 7] !== 0) continue;
                    const sq = packed & 127;
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                            if (recordCaptures) {
                                if (captureCounts[fromSq] === 0) {
                                    captureSources[scratchPackedCaptureSourceCount++] = fromSq;
                                }
                                captureMoves[fromSq * PACKED_CAPTURE_STRIDE + captureCounts[fromSq]++] =
                                    (fromSq << 7) | sq;
                            }
                        } else if ((targetCode & 7) !== 1) {
                            guardBySlot[targetSlot] |= bit;
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 3: {
                for (let i = horseDestOff[fromSq], n = horseDestOff[fromSq + 1]; i < n; i++) {
                    const packed = horseDestData[i];
                    if (squareCodes[packed >>> 7] !== 0) continue;
                    const sq = packed & 127;
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        if (attackTarget[sq] & attackTargetBit) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        mobilityValue += 1;
                    } else {
                        const targetSlot = squareToSlot[sq];
                        if ((targetCode < 8) !== isRed) {
                            attackedTargetMask |= 1 << targetSlot;
                            attackBySlot[targetSlot] |= bit;
                            if (recordCaptures) {
                                if (captureCounts[fromSq] === 0) {
                                    captureSources[scratchPackedCaptureSourceCount++] = fromSq;
                                }
                                captureMoves[fromSq * PACKED_CAPTURE_STRIDE + captureCounts[fromSq]++] =
                                    (fromSq << 7) | sq;
                            }
                        } else if ((targetCode & 7) !== 1) {
                            guardBySlot[targetSlot] |= bit;
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 2: {
                const r = SEARCH_SQ_ROWS[fromSq];
                const c = SEARCH_SQ_COLS[fromSq];
                const rankKey = c * RANK_OCC_COUNT + rowOccupancy[r];
                const fileKey = r * FILE_OCC_COUNT + colOccupancy[c];
                mobilityValue = RANK_MOBILITY[rankKey] + FILE_MOBILITY[fileKey];
                const t0 = RANK_FIRST_HIGH[rankKey];
                if (t0 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        r * 9 + t0, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                const t1 = RANK_FIRST_LOW[rankKey];
                if (t1 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        r * 9 + t1, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                const t2 = FILE_FIRST_HIGH[fileKey];
                if (t2 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        t2 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                const t3 = FILE_FIRST_LOW[fileKey];
                if (t3 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        t3 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                if (isRed ? r >= 7 : r <= 2) {
                    const rankControl = RANK_ROOK_CONTROL[rankKey];
                    if (rankControl & 0x38) {
                        if (rankControl & 8) {
                            const sq = r * 9 + 3;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 16) {
                            const sq = r * 9 + 4;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 32) {
                            const sq = r * 9 + 5;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (c >= 3 && c <= 5) {
                    const fileControl = FILE_ROOK_CONTROL[fileKey];
                    const fileMask = isRed ? 0x380 : 0x7;
                    if (fileControl & fileMask) {
                        const firstRow = isRed ? 7 : 0;
                        let sq = firstRow * 9 + c;
                        if (fileControl & (1 << firstRow)) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 1))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 2))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            case 6: {
                const r = SEARCH_SQ_ROWS[fromSq];
                const c = SEARCH_SQ_COLS[fromSq];
                const rankKey = c * RANK_OCC_COUNT + rowOccupancy[r];
                const fileKey = r * FILE_OCC_COUNT + colOccupancy[c];
                mobilityValue = RANK_MOBILITY[rankKey] + FILE_MOBILITY[fileKey];
                const t0 = RANK_SECOND_HIGH[rankKey];
                if (t0 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        r * 9 + t0, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                const t1 = RANK_SECOND_LOW[rankKey];
                if (t1 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        r * 9 + t1, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                const t2 = FILE_SECOND_HIGH[fileKey];
                if (t2 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        t2 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                const t3 = FILE_SECOND_LOW[fileKey];
                if (t3 !== 255) {
                    attackedTargetMask |= applyOccupiedSliderHitWithCapture(
                        t3 * 9 + c, isRed, bit, squareCodes, squareToSlot, attackBySlot, guardBySlot,
                        recordCaptures, fromSq, captureCounts, captureSources, captureMoves
                    );
                }
                if (isRed ? r >= 7 : r <= 2) {
                    const rankControl = RANK_CANNON_CONTROL[rankKey];
                    if (rankControl & 0x38) {
                        if (rankControl & 8) {
                            const sq = r * 9 + 3;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 16) {
                            const sq = r * 9 + 4;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        if (rankControl & 32) {
                            const sq = r * 9 + 5;
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (c >= 3 && c <= 5) {
                    const fileControl = FILE_CANNON_CONTROL[fileKey];
                    const fileMask = isRed ? 0x380 : 0x7;
                    if (fileControl & fileMask) {
                        const firstRow = isRed ? 7 : 0;
                        let sq = firstRow * 9 + c;
                        if (fileControl & (1 << firstRow)) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 1))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                        sq += 9;
                        if (fileControl & (1 << (firstRow + 2))) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        }
                    }
                }
                if (isRed) redMobility += mobilityValue;
                else blackMobility += mobilityValue;
                break;
            }
            default:
                break;
        }
        // 兵仍扫空步做威胁/安全，不进机动分；机动已在 1–6 兵种分支内累加
    }
    scratchLeafTotals[2] = redMobility;
    scratchLeafTotals[5] = blackMobility;
    scratchLeafAttackedTargetMask = attackedTargetMask >>> 0;
    if (profileRelations) perfStats.leafRelationsMs += performance.now() - relationStart;

    const packedCaptures = scratchPackedCaptures;
    packedCaptures.length = 0;
    const sourceCount = scratchPackedCaptureSourceCount;
    // Match generateQuiescenceMoves: black scans from its own back rank toward red.
    // QS behavior must not depend on whether static eval supplied the capture list.
    const relativeBlackScan = !captureIsRed;
    for (let i = 1; i < sourceCount; i++) {
        const sq = captureSources[i];
        const sqOrder = relativeBlackScan
            ? (ROWS - 1 - SEARCH_SQ_ROWS[sq]) * COLS + SEARCH_SQ_COLS[sq]
            : sq;
        let j = i - 1;
        while (j >= 0) {
            const candidate = captureSources[j];
            const candidateOrder = relativeBlackScan
                ? (ROWS - 1 - SEARCH_SQ_ROWS[candidate]) * COLS + SEARCH_SQ_COLS[candidate]
                : candidate;
            if (candidateOrder <= sqOrder) break;
            captureSources[j + 1] = captureSources[j];
            j--;
        }
        captureSources[j + 1] = sq;
    }
    for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex++) {
        const fromSq = captureSources[sourceIndex];
        const count = captureCounts[fromSq];
        const offset = fromSq * PACKED_CAPTURE_STRIDE;
        for (let i = 0; i < count; i++) packedCaptures.push(captureMoves[offset + i]);
    }
    applyPinnedGuardFilterToLeaf(pieceState);
    leafRelationScratchFresh = true;
};

const calculatePackedSearchLeafRelationsNumeric = (
    pieceState, aliveMask, capturePlayer = null
) => {
    if (capturePlayer != null) {
        calculatePackedSearchLeafRelationsNumericWithCaptures(pieceState, aliveMask, capturePlayer);
    } else {
        calculatePackedSearchLeafRelationsNumericFast(pieceState, aliveMask);
    }
};

const hydrateRelationsFromMasks = (piecesInfo, boardInfo) => {
    const attackMask = boardInfo.attackMask;
    const guardMask = boardInfo.guardMask;
    const controlMask = boardInfo.controlMask;
    const n = piecesInfo.length;
    const bySq = new Array(REL_SQUARES);
    for (let i = 0; i < n; i++) {
        const info = piecesInfo[i];
        info.threat = [];
        info.threatenedBy = [];
        info.guard = [];
        info.guardedBy = [];
        info.control = [];
        bySq[info.r * 9 + info.c] = info;
    }

    for (let sq = 0; sq < REL_SQUARES; sq++) {
        const r = (sq / 9) | 0;
        const c = sq % 9;
        const target = bySq[sq];

        let cm = controlMask[sq] >>> 0;
        while (cm !== 0) {
            const bit = cm & -cm;
            const i = 31 - Math.clz32(bit);
            piecesInfo[i].control.push({ r, c });
            cm ^= bit;
        }

        let am = attackMask[sq] >>> 0;
        while (am !== 0) {
            const bit = am & -am;
            const i = 31 - Math.clz32(bit);
            const attacker = piecesInfo[i];
            if (target && target !== attacker && target.piece.color !== attacker.piece.color) {
                attacker.threat.push(target);
                target.threatenedBy.push(attacker);
            }
            am ^= bit;
        }

        let gm = guardMask[sq] >>> 0;
        while (gm !== 0) {
            const bit = gm & -gm;
            const i = 31 - Math.clz32(bit);
            const guarder = piecesInfo[i];
            if (target && target !== guarder && target.piece.color === guarder.piece.color) {
                guarder.guard.push(target);
                target.guardedBy.push(guarder);
            }
            gm ^= bit;
        }
    }

    // 供点棋 controllers：与旧语义一致，仅空控格
    const grid = makeEmptyControllerGrid();
    for (let sq = 0; sq < REL_SQUARES; sq++) {
        let cm = controlMask[sq] >>> 0;
        if (cm === 0) continue;
        const r = (sq / 9) | 0;
        const c = sq % 9;
        while (cm !== 0) {
            const bit = cm & -cm;
            const i = 31 - Math.clz32(bit);
            grid[r][c].push(piecesInfo[i]);
            cm ^= bit;
        }
    }
    boardInfo.controllerGrid = grid;
};

// 计算棋子关系：mask 路径写 Uint32 格位表；列表路径保持旧 push
const calculatePieceRelations = (board, piecesInfo, boardInfo) => {
    const useMasks = !!(boardInfo && boardInfo.useRelationMasks);
    const useAttackBits = !!(boardInfo && boardInfo.useAttackBits) && !useMasks;

    if (!useMasks) {
        for (const info of piecesInfo) {
            info.threat = [];
            info.threatenedBy = [];
            info.guard = [];
            info.guardedBy = [];
            info.control = [];
        }
    }

    if (!boardInfo) {
        boardInfo = makeEmptyControllerGrid();
    }

    clearPieceAtSq();
    for (let i = 0; i < piecesInfo.length; i++) {
        const info = piecesInfo[i];
        if (info.pieceIndex == null) info.pieceIndex = i;
        scratchPieceAtSq[info.r * 9 + info.c] = info;
    }

    let relCtx = null;
    if (useMasks) {
        relCtx = scratchRelCtx;
        relCtx.useMasks = true;
        relCtx.skipControlMask = !!boardInfo.skipControlMask;
        relCtx.palaceControlOnly = !!boardInfo.palaceControlOnly;
        relCtx.attackMask = boardInfo.attackMask;
        relCtx.guardMask = boardInfo.guardMask;
        relCtx.controlMask = boardInfo.controlMask;
        relCtx.redAttack = boardInfo.redAttack;
        relCtx.blackAttack = boardInfo.blackAttack;
    }

    for (let i = 0; i < piecesInfo.length; i++) {
        const info = piecesInfo[i];
        if (relCtx) relCtx.pieceIndex = info.pieceIndex;

        if (info.piece.type === 'cannon') {
            fillCannonRelations(board, info, scratchPieceAtSq, relCtx);
        } else {
            fillNonCannonRelations(board, info, scratchPieceAtSq, relCtx);
        }

        if (!useMasks) {
            const control = info.control;
            if (useAttackBits) {
                const bits = info.piece.color === 'red' ? boardInfo.redAttack : boardInfo.blackAttack;
                for (let k = 0; k < control.length; k++) {
                    const pos = control[k];
                    setAttackBit(bits, pos.r * 9 + pos.c);
                }
            } else if (Array.isArray(boardInfo[0])) {
                for (let k = 0; k < control.length; k++) {
                    const pos = control[k];
                    boardInfo[pos.r][pos.c].push(info);
                }
            }
        }
    }

    let redIsInCheck = false;
    let blackIsInCheck = false;
    let redGeneralInfo = null;
    let blackGeneralInfo = null;
    for (const info of piecesInfo) {
        if (info.piece.type === 'general') {
            if (info.piece.color === 'red') redGeneralInfo = info;
            else blackGeneralInfo = info;
        }
    }

    if (useMasks) {
        if (redGeneralInfo && boardInfo.attackMask[redGeneralInfo.r * 9 + redGeneralInfo.c] !== 0) {
            redIsInCheck = true;
        }
        if (blackGeneralInfo && boardInfo.attackMask[blackGeneralInfo.r * 9 + blackGeneralInfo.c] !== 0) {
            blackIsInCheck = true;
        }
    } else {
        if (redGeneralInfo) {
            for (const threatener of redGeneralInfo.threatenedBy) {
                if (threatener.piece.color === 'black') {
                    redIsInCheck = true;
                    break;
                }
            }
        }
        if (blackGeneralInfo) {
            for (const threatener of blackGeneralInfo.threatenedBy) {
                if (threatener.piece.color === 'red') {
                    blackIsInCheck = true;
                    break;
                }
            }
        }
    }

    if (redGeneralInfo && blackGeneralInfo && redGeneralInfo.c === blackGeneralInfo.c) {
        let hasPieceBetween = false;
        const startR = Math.min(redGeneralInfo.r, blackGeneralInfo.r) + 1;
        const endR = Math.max(redGeneralInfo.r, blackGeneralInfo.r) - 1;
        for (let r = startR; r <= endR; r++) {
            if (board[r][redGeneralInfo.c]) {
                hasPieceBetween = true;
                break;
            }
        }
        if (!hasPieceBetween) {
            redIsInCheck = true;
            blackIsInCheck = true;
        }
    }

    boardInfo.redIsInCheck = redIsInCheck;
    boardInfo.blackIsInCheck = blackIsInCheck;
    applyPinnedGuardFilterToRelations(board, piecesInfo, boardInfo);
};

// SEE 排序复用缓冲，降低叶评估 GC
const seeAttackerScratch = [];
const seeGuardScratch = [];
const seeAttackerTypeCounts = new Uint8Array(8);
const seeGuardTypeCounts = new Uint8Array(8);
const seeMaterialByType = new Int32Array(8);

const takeLowestSeeMaterial = (counts, materialByType) => {
    let bestType = 0;
    let bestValue = Infinity;
    for (let type = 1; type < counts.length; type++) {
        if (counts[type] !== 0 && materialByType[type] < bestValue) {
            bestType = type;
            bestValue = materialByType[type];
        }
    }
    if (bestType !== 0) counts[bestType]--;
    return bestValue;
};

const hasAnySeeMaterial = (counts) => {
    for (let type = 1; type < counts.length; type++) {
        if (counts[type] !== 0) return true;
    }
    return false;
};

// 有根子简化 SEE（与旧实现逐行等价）；每个目标只应调用一次
const calculateStaticExchangeScore = (threatenedPiece) => {
    const attackers = seeAttackerScratch;
    const guards = seeGuardScratch;
    attackers.length = 0;
    guards.length = 0;
    const rawAttackers = threatenedPiece.threatenedBy;
    const rawGuards = threatenedPiece.guardedBy;
    for (let i = 0; i < rawAttackers.length; i++) attackers.push(rawAttackers[i]);
    for (let i = 0; i < rawGuards.length; i++) guards.push(rawGuards[i]);
    attackers.sort((a, b) => a.materialValue - b.materialValue);
    guards.sort((a, b) => a.materialValue - b.materialValue);

    let exchangeScore = 0;
    let attackerIndex = 0;
    let guardIndex = 0;
    const targetValue = threatenedPiece.materialValue;

    while (attackerIndex < attackers.length && guardIndex < guards.length) {
        if (guardIndex === 0) {
            exchangeScore += targetValue;
        }
        exchangeScore -= attackers[attackerIndex].materialValue;
        if (attackerIndex + 1 < attackers.length) {
            exchangeScore += guards[guardIndex].materialValue;
        }
        attackerIndex++;
        guardIndex++;
    }
    return exchangeScore;
};

// mask 路径 SEE：按棋子类别计数，按材料值消费；与材料数组排序语义一致。
const calculateStaticExchangeScoreFromMasks = (threatenedPiece, piecesInfo, attackMask, guardMask) => {
    const attackerCounts = seeAttackerTypeCounts;
    const guardCounts = seeGuardTypeCounts;
    attackerCounts.fill(0);
    guardCounts.fill(0);
    seeMaterialByType.fill(0);
    const sq = threatenedPiece.sq == null
        ? threatenedPiece.r * 9 + threatenedPiece.c
        : threatenedPiece.sq;
    let am = attackMask[sq] >>> 0;
    while (am !== 0) {
        const bit = am & -am;
        const info = piecesInfo[31 - Math.clz32(bit)];
        const type = info.pieceCode & 7;
        attackerCounts[type]++;
        seeMaterialByType[type] = info.materialValue;
        am ^= bit;
    }
    let gm = guardMask[sq] >>> 0;
    while (gm !== 0) {
        const bit = gm & -gm;
        const info = piecesInfo[31 - Math.clz32(bit)];
        const type = info.pieceCode & 7;
        guardCounts[type]++;
        seeMaterialByType[type] = info.materialValue;
        gm ^= bit;
    }

    let exchangeScore = 0;
    let isFirstExchange = true;
    const targetValue = threatenedPiece.materialValue;

    while (true) {
        const attackerValue = takeLowestSeeMaterial(attackerCounts, seeMaterialByType);
        const guardValue = takeLowestSeeMaterial(guardCounts, seeMaterialByType);
        if (attackerValue === Infinity || guardValue === Infinity) break;
        if (isFirstExchange) {
            exchangeScore += targetValue;
            isFirstExchange = false;
        }
        exchangeScore -= attackerValue;
        if (hasAnySeeMaterial(attackerCounts)) {
            exchangeScore += guardValue;
        }
    }
    return exchangeScore;
};

const calculateStaticExchangeScoreNumeric = (
    targetValue, attackBits, guardBits, pieceCodes, materialValues
) => {
    const attackerCounts = seeAttackerTypeCounts;
    const guardCounts = seeGuardTypeCounts;
    attackerCounts.fill(0);
    guardCounts.fill(0);

    let mask = attackBits >>> 0;
    while (mask !== 0) {
        const bit = mask & -mask;
        attackerCounts[pieceCodes[31 - Math.clz32(bit)] & 7]++;
        mask ^= bit;
    }
    mask = guardBits >>> 0;
    while (mask !== 0) {
        const bit = mask & -mask;
        guardCounts[pieceCodes[31 - Math.clz32(bit)] & 7]++;
        mask ^= bit;
    }

    let exchangeScore = 0;
    let isFirstExchange = true;
    while (true) {
        const attackerValue = takeLowestSeeMaterial(attackerCounts, materialValues);
        const guardValue = takeLowestSeeMaterial(guardCounts, materialValues);
        if (attackerValue === Infinity || guardValue === Infinity) break;
        if (isFirstExchange) {
            exchangeScore += targetValue;
            isFirstExchange = false;
        }
        exchangeScore -= attackerValue;
        if (hasAnySeeMaterial(attackerCounts)) exchangeScore += guardValue;
    }
    return exchangeScore;
};

// 计算威胁值（基于完整的威胁关系）
// 按被威胁子聚合：每个目标最多一次 SEE；分值加给 threatenedBy[0]
// （关系构建按 piecesInfo 顺序 push，故与旧“攻击方外层遍历首次计分”归属一致）
const calculateTacticalValues = (piecesInfo, currentPlayer, boardInfo = null, board = null, forSearchLeaf = false) => {
    // 初始化威胁类型统计信息
    const collectUi = !!boardInfo && !forSearchLeaf;
    if (collectUi) {
        boardInfo.checks = [];      // 将军信息
        boardInfo.threatenedPieces = [];  // 被捉的棋子
        boardInfo.canCapture = [];  // 可吃的棋子
    }

    const checkBonus = CHECK_BONUS;
    const canCaptureSeen = collectUi ? new Set() : null;
    const useMasks = !!(boardInfo && boardInfo.useRelationMasks);
    const attackMask = useMasks ? boardInfo.attackMask : null;
    const guardMask = useMasks ? boardInfo.guardMask : null;

    for (let ti = 0; ti < piecesInfo.length; ti++) {
        const threatenedPiece = piecesInfo[ti];
        let firstAttacker;
        let hasGuard;
        let attackerList = null;

        if (useMasks) {
            const sq = threatenedPiece.r * 9 + threatenedPiece.c;
            const am = attackMask[sq];
            if (am === 0) continue;
            // 最低 bit = piecesInfo 顺序下最先挂上的攻击方（与旧 threatenedBy[0] 一致）
            firstAttacker = piecesInfo[lowestSetBitIndex(am)];
            hasGuard = guardMask[sq] !== 0;
        } else {
            const attackers = threatenedPiece.threatenedBy;
            if (!attackers || attackers.length === 0) continue;
            firstAttacker = attackers[0];
            hasGuard = threatenedPiece.guardedBy && threatenedPiece.guardedBy.length > 0;
            attackerList = attackers;
        }

        // 将军：只给小额先手分，绝不按将/帅材料值做 SEE
        if (threatenedPiece.piece.type === PIECE_TYPES.GENERAL) {
            if (collectUi) {
                if (useMasks) {
                    let m = attackMask[threatenedPiece.r * 9 + threatenedPiece.c] >>> 0;
                    while (m !== 0) {
                        const bit = m & -m;
                        const ai = 31 - Math.clz32(bit);
                        boardInfo.checks.push({
                            attacker: piecesInfo[ai],
                            target: threatenedPiece,
                            isCheck: true
                        });
                        m ^= bit;
                    }
                } else {
                    for (let ai = 0; ai < attackerList.length; ai++) {
                        boardInfo.checks.push({
                            attacker: attackerList[ai],
                            target: threatenedPiece,
                            isCheck: true
                        });
                    }
                }
            }
            firstAttacker.threatValue += checkBonus;
            continue;
        }

        // 只把对攻击方有利的威胁计入 threatValue（单向计入，不做 safety 对称扣分）
        if (!hasGuard) {
            firstAttacker.threatValue += threatenedPiece.materialValue;
            if (collectUi) {
                if (firstAttacker.piece.color === currentPlayer) {
                    if (useMasks) {
                        let m = attackMask[threatenedPiece.r * 9 + threatenedPiece.c] >>> 0;
                        while (m !== 0) {
                            const bit = m & -m;
                            const info = piecesInfo[31 - Math.clz32(bit)];
                            if (!canCaptureSeen.has(info)) {
                                canCaptureSeen.add(info);
                                boardInfo.canCapture.push(info);
                            }
                            m ^= bit;
                        }
                    } else {
                        for (let ai = 0; ai < attackerList.length; ai++) {
                            const info = attackerList[ai];
                            if (!canCaptureSeen.has(info)) {
                                canCaptureSeen.add(info);
                                boardInfo.canCapture.push(info);
                            }
                        }
                    }
                } else {
                    boardInfo.threatenedPieces.push(threatenedPiece);
                }
            }
        } else {
            const sseScore = useMasks
                ? calculateStaticExchangeScoreFromMasks(threatenedPiece, piecesInfo, attackMask, guardMask)
                : calculateStaticExchangeScore(threatenedPiece);
            if (sseScore > 0) {
                firstAttacker.threatValue += sseScore >> 1;
            }
        }
    }

    // 安全值：将空控邻格是否被敌控（无 visit 回调）
    if (forSearchLeaf && boardInfo && boardInfo.useAttackBits && board) {
        for (let gi = 0; gi < piecesInfo.length; gi++) {
            const general = piecesInfo[gi];
            if (general.piece.type !== PIECE_TYPES.GENERAL) continue;

            const generalColor = general.piece.color;
            const enemyBits = generalColor === 'red' ? boardInfo.blackAttack : boardInfo.redAttack;
            const isRed = generalColor === 'red';
            const { r, c } = general;
            for (let i = 0; i < ORTH_DIRS.length; i++) {
                const nr = r + ORTH_DIRS[i][0];
                const nc = c + ORTH_DIRS[i][1];
                if (nc < 3 || nc > 5) continue;
                if (isRed ? (nr < 0 || nr > 2) : (nr < 7 || nr > 9)) continue;
                if (board[nr][nc] === null && hasAttackBit(enemyBits, nr * 9 + nc)) {
                    general.safetyValue -= 50;
                }
            }
        }
        return;
    }

    const generalInfo = [];
    for (let i = 0; i < piecesInfo.length; i++) {
        if (piecesInfo[i].piece.type === PIECE_TYPES.GENERAL) generalInfo.push(piecesInfo[i]);
    }

    const safetyUseAttackBits = !!(boardInfo && boardInfo.useAttackBits);
    const safetyUseMasks = !!(boardInfo && boardInfo.useRelationMasks);
    for (let gi = 0; gi < generalInfo.length; gi++) {
        const general = generalInfo[gi];
        const generalColor = general.piece.color;
        const enemyColor = generalColor === 'red' ? 'black' : 'red';
        const enemyBits = safetyUseAttackBits
            ? (enemyColor === 'red' ? boardInfo.redAttack : boardInfo.blackAttack)
            : null;
        const isRed = generalColor === 'red';
        const { r, c } = general;

        const penalizeIfEnemy = (nr, nc) => {
            let hasEnemyControl;
            if (safetyUseAttackBits) {
                hasEnemyControl = hasAttackBit(enemyBits, nr * 9 + nc);
            } else {
                const positionControllers = boardInfo[nr][nc];
                hasEnemyControl = false;
                for (let ci = 0; ci < positionControllers.length; ci++) {
                    const controller = positionControllers[ci];
                    const color = controller.piece ? controller.piece.color : controller.color;
                    if (color === enemyColor) {
                        hasEnemyControl = true;
                        break;
                    }
                }
            }
            if (hasEnemyControl) general.safetyValue -= 50;
        };

        if ((safetyUseMasks && board) || ((!general.control || general.control.length === 0) && board)) {
            for (let i = 0; i < ORTH_DIRS.length; i++) {
                const nr = r + ORTH_DIRS[i][0];
                const nc = c + ORTH_DIRS[i][1];
                if (nc < 3 || nc > 5) continue;
                if (isRed ? (nr < 0 || nr > 2) : (nr < 7 || nr > 9)) continue;
                if (board[nr][nc] === null) penalizeIfEnemy(nr, nc);
            }
        } else if (general.control && general.control.length) {
            for (let i = 0; i < general.control.length; i++) {
                penalizeIfEnemy(general.control[i].r, general.control[i].c);
            }
        }
    }
};

// Search leaves never construct UI relation lists. This path consumes only
// pieceCode/sq and the masks emitted by the numeric relation builder.
// --- Types (Inlined to avoid import issues in Worker) ---
// // type Color - TypeScript type removed for JavaScript compatibility 'red' | 'black';
// // type PieceType - TypeScript type removed for JavaScript compatibility 'general' | 'advisor' | 'elephant' | 'horse' | 'chariot' | 'cannon' | 'soldier';
// // interface Piece - TypeScript interface removed for JavaScript compatibility
// // interface Position - TypeScript interface removed for JavaScript compatibility
// // interface Move - TypeScript interface removed for JavaScript compatibility
// // type Board - TypeScript type removed for JavaScript compatibility (Piece | null)[][];

// --- Opening Book Types ---
// Opening Book Entry - represents possible moves for a position
// interface BookEntry - TypeScript interface removed for JavaScript compatibility

// Individual move in opening book with metadata
// interface BookMove - TypeScript interface removed for JavaScript compatibility

// --- Zobrist Hashing for Opening Book ---
// Each piece type/color/position gets a unique random 53-bit integer
// Uses seeded RNG for deterministic hashing
class ZobristHasher {
    hashTableFlat;
    pieceToIndex;

    constructor() {
        this.pieceToIndex = new Map([
            ['red-general', 0], ['red-advisor', 1], ['red-elephant', 2], ['red-horse', 3],
            ['red-chariot', 4], ['red-cannon', 5], ['red-soldier', 6],
            ['black-general', 7], ['black-advisor', 8], ['black-elephant', 9], ['black-horse', 10],
            ['black-chariot', 11], ['black-cannon', 12], ['black-soldier', 13]
        ]);
        // Initialize random hash values using seeded RNG (53-bit integers to avoid precision issues)
        this.hashTableFlat = new Float64Array(90 * 14);
        const MAX_SAFE = 0x1FFFFFFFFFFFFF; // 2^53 - 1
        
        // Simple seeded RNG (LCG - Linear Congruential Generator)
        let seed = 123456789; // Fixed seed for deterministic hashing
        const seededRandom = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };

        for (let sq = 0; sq < 90; sq++) {
            for (let p = 0; p < 14; p++) {
                this.hashTableFlat[sq * 14 + p] = Math.floor(seededRandom() * MAX_SAFE);
            }
        }

        this.evalInitiatorKeys = {
            red: Math.floor(seededRandom() * MAX_SAFE),
            black: Math.floor(seededRandom() * MAX_SAFE)
        };
        this.evalStageKeys = {
            early: Math.floor(seededRandom() * MAX_SAFE),
            mid: Math.floor(seededRandom() * MAX_SAFE),
            late: Math.floor(seededRandom() * MAX_SAFE)
        };
    }

    pieceIndex(pieceOrKey) {
        if (pieceOrKey == null) return undefined;
        let color;
        let type;
        if (typeof pieceOrKey === 'string') {
            const separator = pieceOrKey.indexOf('-');
            if (separator < 0) return undefined;
            color = pieceOrKey.slice(0, separator);
            type = pieceOrKey.slice(separator + 1);
        } else {
            color = pieceOrKey.color;
            type = pieceOrKey.type;
        }
        let typeIndex;
        switch (type) {
            case PIECE_TYPES.GENERAL: typeIndex = 0; break;
            case PIECE_TYPES.ADVISOR: typeIndex = 1; break;
            case PIECE_TYPES.ELEPHANT: typeIndex = 2; break;
            case PIECE_TYPES.HORSE: typeIndex = 3; break;
            case PIECE_TYPES.CHARIOT: typeIndex = 4; break;
            case PIECE_TYPES.CANNON: typeIndex = 5; break;
            case PIECE_TYPES.SOLDIER: typeIndex = 6; break;
            default: return undefined;
        }
        if (color === 'red') return typeIndex;
        return color === 'black' ? typeIndex + 7 : undefined;
    }

    evalCacheKey(board, searchInitiator, gameStage) {
        const stageKey = this.evalStageKeys[gameStage] || this.evalStageKeys.mid;
        return this.hash(board) ^ this.evalInitiatorKeys[searchInitiator] ^ stageKey;
    }

    evalCacheKeyFromHash(boardHash, searchInitiator, gameStage) {
        const stageKey = this.evalStageKeys[gameStage] || this.evalStageKeys.mid;
        return boardHash ^ this.evalInitiatorKeys[searchInitiator] ^ stageKey;
    }

    /**
     * 数值 TT key：把行棋方编码进最低位，避免 `hash ^ sideKey` 在 JS ToInt32
     * 下产生跨红黑碰撞（那会使 TT 误命中并改变搜索树/棋力）。
     * 等价于旧字符串 key `${hash}:${side}` 的区分能力。
     */
    ttKeyFromHash(boardHash, side) {
        const h = boardHash | 0; // ^= 链结果已是 Int32
        return h * 2 + (side === 'red' ? 0 : 1);
    }

    /**
     * Compute hash for a board position
     */
    hash(board) {
        let h = 0;
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                const piece = board[r][c];
                if (piece) {
                    const pieceIdx = this.pieceIndex(piece);
                    if (pieceIdx !== undefined) {
                        h ^= this.hashTableFlat[(r * 9 + c) * 14 + pieceIdx];
                    }
                }
            }
        }
        return h;
    }

    hashFromSquareCodes(squareCodes) {
        let h = 0;
        const table = this.hashTableFlat;
        for (let sq = 0; sq < REL_SQUARES; sq++) {
            const code = squareCodes[sq];
            if (!code) continue;
            const idx = SEARCH_CODE_TO_ZOBRIST[code];
            if (idx >= 0) h ^= table[sq * 14 + idx];
        }
        return h;
    }

    hashMirroredFromSquareCodes(squareCodes) {
        let h = 0;
        const table = this.hashTableFlat;
        for (let sq = 0; sq < REL_SQUARES; sq++) {
            const code = squareCodes[sq];
            if (!code) continue;
            const idx = SEARCH_CODE_TO_ZOBRIST[code];
            if (idx < 0) continue;
            const mirroredSq = ((sq / 9) | 0) * 9 + (8 - (sq % 9));
            h ^= table[mirroredSq * 14 + idx];
        }
        return h;
    }

    /**
     * Mirror a board horizontally (for symmetry detection)
     */
    mirrorBoard(board) {
        const mirrored = Array(10).fill(null).map(() => Array(9).fill(null));
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 9; c++) {
                mirrored[r][8 - c] = board[r][c];
            }
        }
        return mirrored;
    }

    /**
     * Mirror a move horizontally
     */
    mirrorMove(move) {
        return {
            from: { r: move.from.r, c: 8 - move.from.c },
            to: { r: move.to.r, c: 8 - move.to.c }
        };
    }

    /**
     * Incrementally update hash after a move (XOR 自逆：再调用一次可还原).
     * movingPiece / capturedPiece 可为棋子对象或 'color-type' 字符串。
     * 须在 makeMove 之前取得 movingPiece，captured 用 makeMove 返回值。
     */
    updateHash(currentHash, move, movingPiece, capturedPiece) {
        let newHash = currentHash;
        const movingIdx = this.pieceIndex(movingPiece);
        if (movingIdx !== undefined) {
            newHash ^= this.hashTableFlat[(move.from.r * 9 + move.from.c) * 14 + movingIdx];
            newHash ^= this.hashTableFlat[(move.to.r * 9 + move.to.c) * 14 + movingIdx];
        }
        if (capturedPiece) {
            const capturedIdx = this.pieceIndex(capturedPiece);
            if (capturedIdx !== undefined) {
                newHash ^= this.hashTableFlat[(move.to.r * 9 + move.to.c) * 14 + capturedIdx];
            }
        }
        return newHash;
    }
}

/**
 * Opening Book Manager
 */
class OpeningBook {
    book;  // Zobrist hash -> moves
    hasher;
    enabled;
    maxPly;  // Maximum ply to use opening book (e.g., 20)

    constructor(maxPly = 12) {
        this.book = new Map();
        this.hasher = new ZobristHasher();
        this.enabled = true;
        this.maxPly = maxPly;
        this.initializeBook();
    }

    /**
     * Initialize with common Chinese Chess openings
     */
    initializeBook() {
        // Add classic Chinese Chess openings manually
        
        /*
        // 1. 中炮过河车对屏风马平炮对车 (Central Cannon vs Screen Horses)
        this.addOpeningLine([
            { from: { r: 7, c: 7 }, to: { r: 7, c: 4 } },  // 1. 炮二平五
            { from: { r: 0, c: 7 }, to: { r: 2, c: 6 } },  // 1... 马8进7
            { from: { r: 9, c: 7 }, to: { r: 7, c: 6 } },  // 2. 马二进三
            { from: { r: 0, c: 8 }, to: { r: 0, c: 7 } },  // 2... 车9平8           
            { from: { r: 9, c: 8 }, to: { r: 9, c: 7 } },  // 3. 车一平二
            { from: { r: 3, c: 6 }, to: { r: 4, c: 6 } },  // 3... 卒7进1
            { from: { r: 9, c: 7 }, to: { r: 3, c: 7 } },  // 4. 车二进六
            { from: { r: 0, c: 1 }, to: { r: 2, c: 2 } },  // 4... 马2进3
            { from: { r: 6, c: 2 }, to: { r: 5, c: 2 } },  // 5. 兵七进一
            { from: { r: 2, c: 7 }, to: { r: 2, c: 8 } },  // 5... 炮8平9
            { from: { r: 3, c: 7 }, to: { r: 3, c: 6 } },  // 6. 车二平三
            { from: { r: 2, c: 8 }, to: { r: 1, c: 8 } },  // 6... 炮9退1          
        ], [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]);

        this.addOpeningLineFromNotation([
            '炮二平五', '马8进7', '马二进三', '车9平8', '车一平二', '卒7进1',
            '车二进六', '马2进3', '兵七进一', '炮8平9', '车二平三', '炮9退1',
            ], [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]);

                this.addOpeningLineFromString([
            '炮二平五 马8进7 马二进三 车9平8 车一平二 卒7进1 车二进六 马2进3 兵七进一 炮8平9 车二平三 炮9退1'
        ], [85, 85, 95, 90, 90, 85, 85, 80, 85, 85, 85, 85]);
        */
    }

    /**
     * Add an opening line to the book
     * @param moves Array of moves representing an opening line
     * @param weights Optional weights for each move (default 100 for all)
     */
    addOpeningLine(moves, weights) {
        // Start with initial board position
        const board = this.createInitialBoard();
        let currentHash = this.hasher.hash(board);

        for (let i = 0; i < moves.length; i++) {
            const move = moves[i];
            const weight = weights?.[i] ?? 100;

            // Get or create book entry for this position
            let entry = this.book.get(currentHash);
            if (!entry) {
                entry = { moves: [] };
                this.book.set(currentHash, entry);
            }

            // Add move if not already present
            const existingMove = entry.moves.find(
                m => m.from.r === move.from.r && m.from.c === move.from.c &&
                     m.to.r === move.to.r && m.to.c === move.to.c
            );

            if (!existingMove) {
                entry.moves.push({
                    from: { r: move.from.r, c: move.from.c },
                    to: { r: move.to.r, c: move.to.c },
                    weight: weight
                });
            } else {
                // Update weight if move already exists (take maximum)
                existingMove.weight = Math.max(existingMove.weight, weight);
            }

            // Make the move on the board
            const piece = board[move.from.r][move.from.c];
            const captured = board[move.to.r][move.to.c];
            
            if (!piece) break; // Invalid line

            const pieceKey = `${piece.color}-${piece.type}`;
            const capturedKey = captured ? `${captured.color}-${captured.type}` : undefined;

            // Update hash incrementally
            currentHash = this.hasher.updateHash(currentHash, move, pieceKey, capturedKey);

            // Apply move
            board[move.to.r][move.to.c] = piece;
            board[move.from.r][move.from.c] = null;
        }
    }

    /**
     * Get best move from opening book for current position
     * @param board Current board state
     * @param ply Current ply number (0 = start of game)
     * @returns Move from book, or null if position not in book
     */
    getBookMoveFromState(state, ply) {
        if (!this.enabled || ply >= this.maxPly) {
            console.log('Opening book disabled or past max ply', { enabled: this.enabled, maxPly: this.maxPly, ply: ply });
            return null;
        }
        let hash = this.hasher.hashFromSquareCodes(state.squareCodes);
        let entry = this.book.get(hash);
        let mirroredMove = false;
        if (!entry || entry.moves.length === 0) {
            hash = this.hasher.hashMirroredFromSquareCodes(state.squareCodes);
            entry = this.book.get(hash);
            if (entry && entry.moves.length > 0) mirroredMove = true;
        }
        if (!entry || entry.moves.length === 0) return null;
        const selectedMove = this.selectWeightedMove(entry.moves);
        if (selectedMove && mirroredMove) {
            const mirroredMoveConverted = this.hasher.mirrorMove(selectedMove);
            if (mirroredMoveConverted && mirroredMoveConverted.from && mirroredMoveConverted.to &&
                typeof mirroredMoveConverted.from.r === 'number' && typeof mirroredMoveConverted.from.c === 'number' &&
                typeof mirroredMoveConverted.to.r === 'number' && typeof mirroredMoveConverted.to.c === 'number') {
                return mirroredMoveConverted;
            }
            return null;
        }
        if (selectedMove && selectedMove.from && selectedMove.to &&
            typeof selectedMove.from.r === 'number' && typeof selectedMove.from.c === 'number' &&
            typeof selectedMove.to.r === 'number' && typeof selectedMove.to.c === 'number') {
            return selectedMove;
        }
        return null;
    }

    getBookMove(board, ply){
        // Don't use book if disabled or past max ply
        if (!this.enabled || ply >= this.maxPly) {
            console.log('Opening book disabled or past max ply', { enabled: this.enabled, maxPly: this.maxPly, ply: ply });
            return null;
        }
        
        //console.log('Opening book getBookMove called', { ply });
        
        // Try to find move for current position
        const hash = this.hasher.hash(board);
        //console.log('Current position hash:', hash);
        
        let entry = this.book.get(hash);
        //console.log('Entry found for current hash:', entry ? entry.moves.length + ' moves' : 'null');
        if (entry && entry.moves.length > 0) {
            console.log('All possible book moves with weights:', JSON.stringify(entry.moves));
            // Calculate total weight
            const totalWeight = entry.moves.reduce((sum, move) => sum + move.weight, 0);
            console.log('Total weight:', totalWeight);
        }
        
        let mirroredMove = false;

        // If not found, try mirrored position
        if (!entry || entry.moves.length === 0) {
            const mirroredBoard = this.hasher.mirrorBoard(board);
            const mirroredHash = this.hasher.hash(mirroredBoard);
            console.log('No entry found, trying mirrored position:', mirroredHash);
            
            entry = this.book.get(mirroredHash);
            if (entry && entry.moves.length > 0) {
                //console.log('Entry found for mirrored hash:', entry.moves.length + ' moves');
                //console.log('Original mirror moves:', JSON.stringify(entry.moves));
                mirroredMove = true;
            } else {
                //console.log('No entry found for mirrored hash');
            }
        }

        if (!entry || entry.moves.length === 0) {
            //console.log('Opening book move not found for current position');
            return null;
        }

        // Select move based on weights
        const selectedMove = this.selectWeightedMove(entry.moves);
        console.log('Opening book move selected:', selectedMove);
        
        // If we used mirrored position, mirror the move back
        if (selectedMove && mirroredMove) {
            // console.log('Selected mirror move before conversion:', JSON.stringify(selectedMove));
            const mirroredMoveConverted = this.hasher.mirrorMove(selectedMove);
            // console.log('Converted mirror move:', JSON.stringify(mirroredMoveConverted));
            
            // Check if the mirrored move has valid structure
            if (mirroredMoveConverted && mirroredMoveConverted.from && mirroredMoveConverted.to &&
                typeof mirroredMoveConverted.from.r === 'number' && typeof mirroredMoveConverted.from.c === 'number' &&
                typeof mirroredMoveConverted.to.r === 'number' && typeof mirroredMoveConverted.to.c === 'number') {
                return mirroredMoveConverted;
            } else {
                console.log('Mirrored move has invalid structure, returning null');
                return null;
            }
        } else if (selectedMove) {
            // Check if the selected move has valid structure
            if (selectedMove.from && selectedMove.to &&
                typeof selectedMove.from.r === 'number' && typeof selectedMove.from.c === 'number' &&
                typeof selectedMove.to.r === 'number' && typeof selectedMove.to.c === 'number') {
                return selectedMove;
            } else {
                console.log('Selected move has invalid structure, returning null');
                return null;
            }
        }
        
        return null;
    }

    /**
     * Select a move randomly based on weights
     * Higher weight = more likely to be selected
     */
    selectWeightedMove(moves) {
        // Calculate total weight
        const totalWeight = moves.reduce((sum, move) => sum + move.weight, 0);

        // Generate random number
        let random = Math.random() * totalWeight;

        // Select move
        for (const move of moves) {
            random -= move.weight;
            if (random <= 0) {
                return {
                    from: { r: move.from.r, c: move.from.c }, to: { r: move.to.r, c: move.to.c }
                };
            }
        }

        // Fallback (should never reach here)
        return {
            from: { r: moves[0].from.r, c: moves[0].from.c }, to: { r: moves[0].to.r, c: moves[0].to.c }
        };
    }

    /**
     * Helper to create initial board (needed for book initialization)
     */
    createInitialBoard() {
        const board = Array(10).fill(null).map(() => Array(9).fill(null));
        
        // Red pieces (bottom - r=0-2)
        board[0][0] = { type: 'chariot', color: 'red' };
        board[0][1] = { type: 'horse', color: 'red' };
        board[0][2] = { type: 'elephant', color: 'red' };
        board[0][3] = { type: 'advisor', color: 'red' };
        board[0][4] = { type: 'general', color: 'red' };
        board[0][5] = { type: 'advisor', color: 'red' };
        board[0][6] = { type: 'elephant', color: 'red' };
        board[0][7] = { type: 'horse', color: 'red' };
        board[0][8] = { type: 'chariot', color: 'red' };
        board[2][1] = { type: 'cannon', color: 'red' };
        board[2][7] = { type: 'cannon', color: 'red' };
        board[3][0] = { type: 'soldier', color: 'red' };
        board[3][2] = { type: 'soldier', color: 'red' };
        board[3][4] = { type: 'soldier', color: 'red' };
        board[3][6] = { type: 'soldier', color: 'red' };
        board[3][8] = { type: 'soldier', color: 'red' };

        // Black pieces (top - r=7-9)
        board[9][0] = { type: 'chariot', color: 'black' };
        board[9][1] = { type: 'horse', color: 'black' };
        board[9][2] = { type: 'elephant', color: 'black' };
        board[9][3] = { type: 'advisor', color: 'black' };
        board[9][4] = { type: 'general', color: 'black' };
        board[9][5] = { type: 'advisor', color: 'black' };
        board[9][6] = { type: 'elephant', color: 'black' };
        board[9][7] = { type: 'horse', color: 'black' };
        board[9][8] = { type: 'chariot', color: 'black' };
        board[7][1] = { type: 'cannon', color: 'black' };
        board[7][7] = { type: 'cannon', color: 'black' };
        board[6][0] = { type: 'soldier', color: 'black' };
        board[6][2] = { type: 'soldier', color: 'black' };
        board[6][4] = { type: 'soldier', color: 'black' };
        board[6][6] = { type: 'soldier', color: 'black' };
        board[6][8] = { type: 'soldier', color: 'black' };

        return board;
    }

    /**
     * Enable or disable opening book
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }

    /**
     * Check if opening book is enabled
     */
    isEnabled() {
        return this.enabled;
    }

    /**
     * Get statistics about the opening book
     */
    getStats() {
        let totalMoves = 0;
        this.book.forEach(entry => {
            totalMoves += entry.moves.length;
        });

        return {
            positions: this.book.size,
            totalMoves
        };
    }

    /**
     * Add opening line from traditional Chinese chess notation
     * @param notation Array of move strings in traditional notation (e.g., ['炮二平五', '马8进7'])
     * @param weights Optional array of weights for each move
     */
    addOpeningLineFromNotation(notation, weights) {
        // Convert traditional notation to coordinate format
        const moves = this.notationToMoves(notation);
        // Add the moves to the opening book
        this.addOpeningLine(moves, weights);
    }

    /**
     * Add opening line from string with space-separated traditional Chinese chess notation
     * @param notationArray Array of strings, each containing space-separated moves (e.g., ['炮二平五 马8进7 车一平二'])
     * @param weights Optional array of weights for each move
     */
    addOpeningLineFromString(notationArray, weights) {
        // Process each string in the array
        if (!notationArray || !Array.isArray(notationArray) || notationArray.length === 0) {
            return;
        }
        notationArray.forEach(notationString => {
            // Split the string by spaces to get individual moves
            const notation = notationString.split(' ').filter(move => move.trim() !== '');
            // Call existing function to add the line
            this.addOpeningLineFromNotation(notation, weights);
        });
    }

    /**
     * Convert coordinate-based moves to traditional Chinese chess notation
     * @param boardHistory Array of board states representing the game history
     * @param moveHistory Array of moves in coordinate format
     * @returns Array of move strings in traditional notation
     */
    movesToNotation(boardHistory, moveHistory) {
        const notation = [];
        let currentColor = 'red'; // Red moves first

        // Type to piece character mapping
        const typeToPiece = {
            'general': { 'red': '帅', 'black': '将' },
            'advisor': { 'red': '仕', 'black': '士' },
            'elephant': { 'red': '相', 'black': '象' },
            'horse': { 'red': '马', 'black': '马' },
            'chariot': { 'red': '车', 'black': '车' },
            'cannon': { 'red': '炮', 'black': '炮' },
            'soldier': { 'red': '兵', 'black': '卒' }
        };

        // Column mapping (coordinate 0-8 to traditional 九-一 for red, 9-1 for black)
        const colToChinese = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
        const colToArabic = ['9', '8', '7', '6', '5', '4', '3', '2', '1'];

        // Digit to Chinese number mapping for steps
        const digitToChinese = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

        // Helper function to check if there are multiple same-type pieces in the same column
        const hasSameTypeInColumn = (board, pieceType, color, col, excludeRow) => {
            let count = 0;
            for (let r = 0; r < 10; r++) {
                const piece = board[r][col];
                if (r === excludeRow) continue;
                if (piece && piece.type === pieceType && piece.color === color) {
                    count++;
                }
            }
            return count > 0;
        };

        // Helper function to determine front/back marker
        const getFrontBackMarker = (board, pieceType, color, col, currentRow) => {
            const sameTypePieces = [];
            for (let r = 0; r < 10; r++) {
                const piece = board[r][col];
                if (piece && piece.type === pieceType && piece.color === color) {
                    sameTypePieces.push(r);
                }
            }
            if (sameTypePieces.length <= 1) return '';
            if (color === 'red') {
                // 红方：敌方在顶部（r=7-9），r值越大越靠近敌方，是"前"
                const sortedRows = [...sameTypePieces].sort((a, b) => b - a); // Higher rows first = closer to opponent
                return sortedRows[0] === currentRow ? '前' : '后';
            } else {
                // 黑方：敌方在底部（r=0-2），r值越小越靠近敌方，是"前"
                const sortedRows = [...sameTypePieces].sort((a, b) => a - b); // Lower rows first = closer to opponent
                return sortedRows[0] === currentRow ? '前' : '后';
            }
        };

        // Process each move
        for (let i = 0; i < moveHistory.length; i++) {
            const move = moveHistory[i];
            const boardBefore = boardHistory[i];
            const piece = boardBefore[move.from.r][move.from.c];
            
            if (!piece) {
                console.error('No piece found at from position:', move.from);
                continue;
            }

            const pieceType = piece.type;
            const pieceChar = typeToPiece[pieceType][piece.color];
            const isRed = piece.color === 'red';
            
            // Check if there are multiple same-type pieces in the same column
            const hasDuplicate = hasSameTypeInColumn(boardBefore, pieceType, piece.color, move.from.c, move.from.r);
            // Get front/back marker if needed
            const positionMarker = hasDuplicate ? getFrontBackMarker(boardBefore, pieceType, piece.color, move.from.c, move.from.r) : '';
            
            // Determine notation based on piece type and move direction
            let notationStr;
            
            if (pieceType === 'horse' || pieceType === 'advisor' || pieceType === 'elephant') {
                // Diagonal moving pieces - only use 进/退, record target column
                if (isRed) {
                    const fromCol = colToChinese[move.from.c] || '';
                    const toCol = colToChinese[move.to.c] || '';
                    // 红方：敌方在顶部，向上（r增大）是进，向下（r减小）是退
                    const direction = move.to.r > move.from.r ? '进' : '退';
                    notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${toCol}`;
                } else {
                    // 黑方从右往左是1-9，需要反转列映射
                    const fromCol = colToArabic[8 - move.from.c] || '';
                    const toCol = colToArabic[8 - move.to.c] || '';
                    // 黑方：敌方在底部（r=0），向下（r减小）是进，向上（r增大）是退
                    const direction = move.to.r < move.from.r ? '进' : '退';
                    notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${toCol}`;
                }
            } else if (pieceType === 'general' || pieceType === 'chariot' || pieceType === 'cannon' || pieceType === 'soldier') {
                // Straight moving pieces - 进/退/平
                if (move.from.c === move.to.c) {
                    // Vertical move - 进/退
                    const steps = Math.abs(move.to.r - move.from.r);
                    // 进是靠近敌方的方向，退是远离敌方的方向
                    // 红方：敌方在顶部，向上（r增大）是进，向下（r减小）是退
                    // 黑方：敌方在底部，向下（r减小）是进，向上（r增大）是退
                    const direction = (isRed ? move.to.r > move.from.r : move.to.r < move.from.r) ? '进' : '退';
                    
                    if (isRed) {
                        const fromCol = colToChinese[move.from.c];
                        // Ensure steps is a valid number between 1-9
                        const validSteps = Math.max(1, Math.min(9, Math.round(steps || 1)));
                        notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${digitToChinese[validSteps] || ''}`;
                    } else {
                        // 黑方从右往左是1-9，需要反转列映射
                        const fromCol = colToArabic[8 - move.from.c];
                        // Ensure steps is a valid number
                        const validSteps = Math.round(steps || 1);
                        notationStr = `${positionMarker}${pieceChar}${fromCol}${direction}${validSteps}`;
                    }
                } else {
                    // Horizontal move - 平
                    if (isRed) {
                        const fromCol = colToChinese[move.from.c] || '';
                        const toCol = colToChinese[move.to.c] || '';
                        notationStr = `${positionMarker}${pieceChar}${fromCol}平${toCol}`;
                    } else {
                        // 黑方从右往左是1-9，需要反转列映射
                        const fromCol = colToArabic[8 - move.from.c] || '';
                        const toCol = colToArabic[8 - move.to.c] || '';
                        notationStr = `${positionMarker}${pieceChar}${fromCol}平${toCol}`;
                    }
                }
            } else {
                console.error('Unknown piece type:', pieceType);
                continue;
            }
            
            notation.push(notationStr);
            
            // Switch color for next move
            currentColor = currentColor === 'red' ? 'black' : 'red';
        }
        
        return notation;
    }

    /**
     * Convert traditional Chinese chess notation to coordinate moves
     * @param notation Array of move strings in traditional notation
     * @returns Array of moves in coordinate format
     */
    notationToMoves(notation, initialBoard = null) {
        // 确保notation是数组且不为空
        if (!notation || !Array.isArray(notation) || notation.length === 0) {
            return [];
        }
        const moves = [];
        let currentColor = 'red'; // Red moves first

        // Piece character to type mapping
        const pieceMap = {
            '将': 'general', '帅': 'general',
            '士': 'advisor', '仕': 'advisor',
            '象': 'elephant', '相': 'elephant',
            '马': 'horse',
            '车': 'chariot',
            '炮': 'cannon',
            '卒': 'soldier', '兵': 'soldier'
        };

        // Column mapping (traditional notation uses 1-9 from right to left)
        const colMap = {
            '一': 8, '1': 8,
            '二': 7, '2': 7,
            '三': 6, '3': 6,
            '四': 5, '4': 5,
            '五': 4, '5': 4,
            '六': 3, '6': 3,
            '七': 2, '7': 2,
            '八': 1, '8': 1,
            '九': 0, '9': 0
        };

        // Chinese number to digit mapping
        const chineseNumberMap = {
            '一': 1, '1': 1,
            '二': 2, '2': 2,
            '三': 3, '3': 3,
            '四': 4, '4': 4,
            '五': 5, '5': 5,
            '六': 6, '6': 6,
            '七': 7, '7': 7,
            '八': 8, '8': 8,
            '九': 9, '9': 9
        };

        // Initial positions of pieces (red and black)
        // 修复：与新坐标系统保持一致，红方在底部（r=0-2），黑方在顶部（r=7-9）
        const defaultInitialPositions = {
            'red-general': { r: 0, c: 4 },
            'red-advisor': [{ r: 0, c: 3 }, { r: 0, c: 5 }],
            'red-elephant': [{ r: 0, c: 2 }, { r: 0, c: 6 }],
            'red-horse': [{ r: 0, c: 1 }, { r: 0, c: 7 }],
            'red-chariot': [{ r: 0, c: 0 }, { r: 0, c: 8 }],
            'red-cannon': [{ r: 2, c: 1 }, { r: 2, c: 7 }],
            'red-soldier': [{ r: 3, c: 0 }, { r: 3, c: 2 }, { r: 3, c: 4 }, { r: 3, c: 6 }, { r: 3, c: 8 }],
            'black-general': { r: 9, c: 4 },
            'black-advisor': [{ r: 9, c: 3 }, { r: 9, c: 5 }],
            'black-elephant': [{ r: 9, c: 2 }, { r: 9, c: 6 }],
            'black-horse': [{ r: 9, c: 1 }, { r: 9, c: 7 }],
            'black-chariot': [{ r: 9, c: 0 }, { r: 9, c: 8 }],
            'black-cannon': [{ r: 7, c: 1 }, { r: 7, c: 7 }],
            'black-soldier': [{ r: 6, c: 0 }, { r: 6, c: 2 }, { r: 6, c: 4 }, { r: 6, c: 6 }, { r: 6, c: 8 }]
        };

        // Track piece positions as moves are made
        let piecePositions = JSON.parse(JSON.stringify(defaultInitialPositions));
        
        // If initial board is provided, initialize piece positions from it
        if (initialBoard) {
            // Reset piece positions based on initial board
            piecePositions = {
                'red-general': { r: -1, c: -1 },
                'red-advisor': [],
                'red-elephant': [],
                'red-horse': [],
                'red-chariot': [],
                'red-cannon': [],
                'red-soldier': [],
                'black-general': { r: -1, c: -1 },
                'black-advisor': [],
                'black-elephant': [],
                'black-horse': [],
                'black-chariot': [],
                'black-cannon': [],
                'black-soldier': []
            };
            
            // Populate piece positions from initial board
            for (let r = 0; r < 10; r++) {
                for (let c = 0; c < 9; c++) {
                    const piece = initialBoard[r][c];
                    if (piece) {
                        const key = `${piece.color}-${piece.type}`;
                        if (piece.type === 'general') {
                            piecePositions[key] = { r, c };
                        } else {
                            piecePositions[key].push({ r, c });
                        }
                    }
                }
            }
        }

        // Helper function to find piece position
        const findPiecePosition = (pieceType, color, col, direction, frontBackMarker = null) => {
            const key = `${color}-${pieceType}`;
            const positions = piecePositions[key];

            // Check if positions exist and are valid
            if (!positions) {
                console.error('No positions found for piece:', key);
                return null;
            }

            if (pieceType === 'general') {
                return positions;
            }

            // Find pieces on the specified column
            const candidates = positions.filter(pos => pos.c === col);

            if (candidates.length === 0) {
                console.error('No candidates found for piece:', key, 'on column:', col);
                // Additional debug info for cannon
                if (pieceType === 'cannon' && color === 'black') {
                    console.log('DEBUG: Candidates after filter:', candidates);
                }
                return null;
            }

            if (candidates.length === 1) {
                return candidates[0];
            }

            // If front/back marker is provided, use it to determine the piece
            if (frontBackMarker === '前') {
                // 前炮：靠近敌方的棋子
                // 红方：r值较大的更靠近敌方（前）
                // 黑方：r值较小的更靠近敌方（前）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]);
            } else if (frontBackMarker === '后') {
                // 后炮：靠近己方的棋子
                // 红方：r值较小的更靠近己方（后）
                // 黑方：r值较大的更靠近己方（后）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]);
            }

            // If multiple pieces on the same column and no marker, determine based on direction
            // 对于同一列的棋子，通过比较r值来区分
            if (direction === '进') {
                // 进是向敌方方向移动，所以选择更靠近己方的棋子（后）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]);
            } else if (direction === '退') {
                // 退是向己方方向移动，所以选择更靠近敌方的棋子（前）
                return color === 'red' ? 
                    candidates.reduce((prev, curr) => prev.r > curr.r ? prev : curr, candidates[0]) :
                    candidates.reduce((prev, curr) => prev.r < curr.r ? prev : curr, candidates[0]);
            }

            return candidates[0]; // Default to first if direction is '平' and no marker
        };

        // Helper function to update piece position
        const updatePiecePosition = (pieceType, color, oldPos, newPos) => {
            const key = `${color}-${pieceType}`;
            const positions = piecePositions[key];

            // Check if positions exist and are valid
            if (!positions) {
                console.error('❌ ERROR: No positions found for piece:', key);
                return;
            }

            if (pieceType === 'general') {
                positions.r = newPos.r;
                positions.c = newPos.c;
                return;
            }

            const index = positions.findIndex(pos => pos.r === oldPos.r && pos.c === oldPos.c);
            if (index !== -1) {
                positions[index].r = newPos.r;
                positions[index].c = newPos.c;
            } else {
                console.error('❌ ERROR: Could not find piece position to update:', oldPos, 'in', positions);
            }
        };

        // Helper function to check if position is valid
        const isValidPos = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 9;

        // Helper function to get horse moves
        const getHorseMoves = (pos) => {
            if (!pos) return [];
            const moves = [];
            const { r, c } = pos;
            const directions = [
                { dr: -2, dc: -1 }, { dr: -2, dc: 1 },
                { dr: -1, dc: -2 }, { dr: -1, dc: 2 },
                { dr: 1, dc: -2 }, { dr: 1, dc: 2 },
                { dr: 2, dc: -1 }, { dr: 2, dc: 1 }
            ];

            // Check if the horse can move in the direction
            const canMove = (blockedR, blockedC) => {
                if (!isValidPos(r + blockedR, c + blockedC)) return false;
                return true;
            };

            directions.forEach(({ dr, dc }, index) => {
                const blockedR = dr > 0 ? 1 : dr < 0 ? -1 : 0;
                const blockedC = dc > 0 ? 1 : dc < 0 ? -1 : 0;
                
                // Check if the path is blocked
                if ((index < 2 || index >= 6) && blockedR !== 0) {
                    // Vertical blocked
                    if (!canMove(blockedR, 0)) return;
                } else if (blockedC !== 0) {
                    // Horizontal blocked
                    if (!canMove(0, blockedC)) return;
                }

                const newR = r + dr;
                const newC = c + dc;
                if (isValidPos(newR, newC)) {
                    moves.push({ r: newR, c: newC });
                }
            });

            return moves;
        };

        // Helper function to get elephant moves
        const getElephantMoves = (pos, color) => {
            if (!pos) return [];
            const moves = [];
            const { r, c } = pos;
            const directions = [
                { dr: -2, dc: -2 }, { dr: -2, dc: 2 },
                { dr: 2, dc: -2 }, { dr: 2, dc: 2 }
            ];

            // Elephant's territory - red elephants can only be in r<=4, black elephants in r>=5
            const isInTerritory = (r) => {
                return color === 'red' ? r <= 4 : r >= 5;
            };

            directions.forEach(({ dr, dc }) => {
                const midR = r + dr / 2;
                const midC = c + dc / 2;
                const newR = r + dr;
                const newC = c + dc;

                // Check if mid position is empty and new position is valid
                if (isValidPos(midR, midC) && isValidPos(newR, newC) && isInTerritory(newR)) {
                    moves.push({ r: newR, c: newC });
                }
            });

            return moves;
        };

        // Helper function to get advisor moves
        const getAdvisorMoves = (pos, color) => {
            if (!pos) return [];
            const moves = [];
            const { r, c } = pos;
            const directions = [
                { dr: -1, dc: -1 }, { dr: -1, dc: 1 },
                { dr: 1, dc: -1 }, { dr: 1, dc: 1 }
            ];

            // Advisor's territory (palace) - red advisors in r=0-2,c=3-5, black advisors in r=7-9,c=3-5
            const isInPalace = (r, c) => {
                const rRange = color === 'red' ? [0, 2] : [7, 9];
                return r >= rRange[0] && r <= rRange[1] && c >= 3 && c <= 5;
            };

            directions.forEach(({ dr, dc }) => {
                const newR = r + dr;
                const newC = c + dc;
                if (isValidPos(newR, newC) && isInPalace(newR, newC)) {
                    moves.push({ r: newR, c: newC });
                }
            });

            return moves;
        };

        // Create a temporary board to track moves
        let tempBoard = this.createInitialBoard();
        
        // Ensure tempBoard is properly initialized
        if (!tempBoard || tempBoard.length !== 10) {
            console.error('Invalid board initialization');
            return [];
        }
        
        // Verify all rows have 9 columns
        for (let i = 0; i < 10; i++) {
            if (!tempBoard[i] || tempBoard[i].length !== 9) {
                tempBoard[i] = Array(9).fill(null);
            }
        }

        console.log('Total moves:', notation.length);
        notation.forEach(moveNotation => {


            
            // Parse the move notation - keep last group optional
            const regex = /([前后])?([将帅士仕象相马车炮兵卒])([一二三四五六七八九123456789])([进退平])([一二三四五六七八九123456789])?/;
            const match = moveNotation.match(regex);

            if (!match) {
                console.error('Invalid move notation:', moveNotation);
                return;
            }

            const [, frontBackMarker, pieceChar, fromColNotation, direction, toColOrStepNotation] = match;
            const pieceType = pieceMap[pieceChar];
            
            // Get column mapping based on current color (black sees columns mirrored)
            let fromCol = colMap[fromColNotation];
            if (currentColor === 'black') {
                // Mirror the column for black (from black's perspective)
                fromCol = 8 - fromCol;
            }

            // Find the current position of the piece
            const fromPos = findPiecePosition(pieceType, currentColor, fromCol, direction, frontBackMarker);

            if (!fromPos) {
                console.error('Could not find piece position for move:', moveNotation);
                return;
            }

            let toPos;

            if (direction === '平') {
                // Horizontal movement
                let toCol = colMap[toColOrStepNotation];
                if (toCol === undefined) {
                    console.error('Invalid target column notation:', toColOrStepNotation, 'for move:', moveNotation);
                    return;
                }
                
                // Mirror the column for black when moving horizontally
                if (currentColor === 'black') {
                    toCol = 8 - toCol;
                }
                
                toPos = { r: fromPos.r, c: toCol };
            } else {
                // Vertical or diagonal movement
                const steps = chineseNumberMap[toColOrStepNotation];
                  
                if (steps === undefined) {
                    console.error('Invalid step count:', toColOrStepNotation, 'for move:', moveNotation);
                    return;
                }

                if (pieceType === 'horse') {
                    // Horse moves in L-shape
                    const possibleMoves = getHorseMoves(fromPos);
                    // Parse target column from notation
                    const targetColNotation = toColOrStepNotation;
                    let targetCol = colMap[targetColNotation];
                    if (targetCol === undefined) {
                        console.error('Invalid target column notation for horse:', targetColNotation, 'in move:', moveNotation);
                        return;
                    }
                    
                    // Mirror the column for black
                    if (currentColor === 'black') {
                        targetCol = 8 - targetCol;
                    }
                    
                    // Find the move that matches both direction and target column
                    toPos = possibleMoves.find(move => {
                        // Check direction (row)
                        // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                        // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                        const directionMatch = direction === '进' ? 
                            (currentColor === 'red' ? move.r > fromPos.r : move.r < fromPos.r) :
                            (currentColor === 'red' ? move.r < fromPos.r : move.r > fromPos.r);
                        // Check column
                        const columnMatch = move.c === targetCol;
                        return directionMatch && columnMatch;
                    });
                } else if (pieceType === 'elephant') {
                    // Elephant moves diagonally 2 steps
                    const possibleMoves = getElephantMoves(fromPos, currentColor);
                    // Parse target column from notation
                    const targetColNotation = toColOrStepNotation;
                    let targetCol = colMap[targetColNotation];
                    if (targetCol === undefined) {
                        console.error('Invalid target column notation for elephant:', targetColNotation, 'in move:', moveNotation);
                        return;
                    }
                    
                    // Mirror the column for black
                    if (currentColor === 'black') {
                        targetCol = 8 - targetCol;
                    }
                    
                    // Find the move that matches both direction and target column
                    toPos = possibleMoves.find(move => {
                        // Check direction (row)
                        // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                        // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                        const directionMatch = direction === '进' ? 
                            (currentColor === 'red' ? move.r > fromPos.r : move.r < fromPos.r) :
                            (currentColor === 'red' ? move.r < fromPos.r : move.r > fromPos.r);
                        // Check column
                        const columnMatch = move.c === targetCol;
                        return directionMatch && columnMatch;
                    });
                } else if (pieceType === 'advisor') {
                    // Advisor moves diagonally 1 step
                    const possibleMoves = getAdvisorMoves(fromPos, currentColor);
                    // Parse target column from notation
                    const targetColNotation = toColOrStepNotation;
                    let targetCol = colMap[targetColNotation];
                    if (targetCol === undefined) {
                        console.error('Invalid target column notation for advisor:', targetColNotation, 'in move:', moveNotation);
                        return;
                    }
                    
                    // Mirror the column for black
                    if (currentColor === 'black') {
                        targetCol = 8 - targetCol;
                    }
                    
                    // Find the move that matches both direction and target column
                    toPos = possibleMoves.find(move => {
                        // Check direction (row)
                        // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                        // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                        const directionMatch = direction === '进' ? 
                            (currentColor === 'red' ? move.r > fromPos.r : move.r < fromPos.r) :
                            (currentColor === 'red' ? move.r < fromPos.r : move.r > fromPos.r);
                        // Check column
                        const columnMatch = move.c === targetCol;
                        return directionMatch && columnMatch;
                    });
                } else {
                    // Straight line movement (chariot, cannon, soldier)
                    // 红方进是r增大（向黑方方向），退是r减小（向红方方向）
                    // 黑方进是r减小（向红方方向），退是r增大（向黑方方向）
                    const step = direction === '进' ? (currentColor === 'red' ? 1 : -1) * steps :
                                                   (currentColor === 'red' ? -1 : 1) * steps;
                    const newR = fromPos.r + step;
                    if (newR < 0 || newR >= 10) {
                        console.error('Invalid row position after move:', newR, 'for move:', moveNotation);
                        return;
                    }
                    toPos = { r: newR, c: fromPos.c };
                }
            }

            if (!toPos) {
                console.error('Could not determine target position for move:', moveNotation);
                return;
            }

            // Add the move to the list
            moves.push({ from: { r: fromPos.r, c: fromPos.c }, to: { r: toPos.r, c: toPos.c } });

            // Check if there's a captured piece
            const capturedPiece = tempBoard[toPos.r][toPos.c];
            
            // If there's a captured piece, remove it from piecePositions
            if (capturedPiece) {
                const capturedKey = `${capturedPiece.color}-${capturedPiece.type}`;
                const capturedPositions = piecePositions[capturedKey];
                
                if (capturedPositions) {
                    // 将/帅不会被吃掉，所以只处理其他棋子
                    if (capturedPiece.type !== 'general') {
                        // Remove the captured position from the array
                        if (Array.isArray(capturedPositions)) {
                            const updatedPositions = capturedPositions.filter(pos => 
                                pos && (pos.r !== toPos.r || pos.c !== toPos.c)
                            );
                            piecePositions[capturedKey] = updatedPositions;
                            
                            // Verify removal was successful
                            const stillExists = updatedPositions.some(pos => 
                                pos && pos.r === toPos.r && pos.c === toPos.c
                            );
                            if (stillExists) {
                                console.error('❌ ERROR: Captured piece still exists in piecePositions!');
                            } else {
                                console.log('✅ SUCCESS: Captured piece removed from piecePositions');
                            }
                        } else {
                            console.error('❌ ERROR: Unexpected non-array positions for piece:', capturedKey);
                        }
                    }
                } else {
                    console.error('❌ ERROR: No positions found for captured piece:', capturedKey);
                }
            }
            
            // Verify the captured piece has been removed
            if (capturedPiece) {
                const capturedKey = `${capturedPiece.color}-${capturedPiece.type}`;
                const finalPositions = piecePositions[capturedKey];
                if (Array.isArray(finalPositions)) {
                    const stillExists = finalPositions.some(pos => 
                        pos && pos.r === toPos.r && pos.c === toPos.c
                    );
                    if (stillExists) {
                        console.error('ERROR: Captured piece still exists in piecePositions:', capturedPiece, 'at', toPos);
                    } else {
                        console.log('SUCCESS: Captured piece removed from piecePositions');
                    }
                }
            }
            
            // Make the move on the temporary board first before updating piece positions
            if (isValidPos(fromPos.r, fromPos.c) && isValidPos(toPos.r, toPos.c) && 
                tempBoard[fromPos.r] && tempBoard[toPos.r]) {
                const piece = tempBoard[fromPos.r][fromPos.c];
                tempBoard[toPos.r][toPos.c] = piece;
                tempBoard[fromPos.r][fromPos.c] = null;
            } else {
                console.error('❌ ERROR: Invalid positions for move:', moveNotation, fromPos, toPos);
            }
            
            // Update the piece position in piecePositions
            updatePiecePosition(pieceType, currentColor, fromPos, toPos);
                        
            // Switch color for next move
            currentColor = currentColor === 'red' ? 'black' : 'red';
        });

        return moves;
    }
}

// --- Constants ---

// Initialize Opening Book
const openingBook = new OpeningBook(12);

const isValidPos = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

// 模块级伪合法落点：只读 squareCodes，不碰对象棋盘
const pushPseudoDest = (squareCodes, moves, alliesOut, isRed, toSq) => {
  const targetCode = squareCodes[toSq];
  if (!targetCode || ((targetCode < 8) !== isRed)) {
    moves.push(toSq);
  } else if (alliesOut && (targetCode & 7) !== 1) {
    alliesOut.push(toSq);
  }
};

// alliesOut: 可选，收集可保护的己方落点（不含将帅）
const scratchPseudoDests = [];
const getPieceMoves = (state, fromSq, pieceCode, alliesOut = null) => {
  const moves = scratchPseudoDests;
  moves.length = 0;
  const squareCodes = state.squareCodes;
  const isRed = pieceCode < 8;
  const colorIdx = isRed ? 0 : 1;
  const r = SEARCH_SQ_ROWS[fromSq];
  const c = SEARCH_SQ_COLS[fromSq];

  switch (pieceCode & 7) {
    case 1: {
      const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
      for (let i = SEARCH_GENERAL_DEST_OFF[destBase], n = SEARCH_GENERAL_DEST_OFF[destBase + 1]; i < n; i++) {
        pushPseudoDest(squareCodes, moves, alliesOut, isRed, SEARCH_GENERAL_DEST_DATA[i]);
      }
      break;
    }
    case 5: {
      const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
      for (let i = SEARCH_ADVISOR_DEST_OFF[destBase], n = SEARCH_ADVISOR_DEST_OFF[destBase + 1]; i < n; i++) {
        pushPseudoDest(squareCodes, moves, alliesOut, isRed, SEARCH_ADVISOR_DEST_DATA[i]);
      }
      break;
    }
    case 4: {
      const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
      for (let i = SEARCH_ELEPHANT_DEST_OFF[destBase], n = SEARCH_ELEPHANT_DEST_OFF[destBase + 1]; i < n; i++) {
        const entry = SEARCH_ELEPHANT_DEST_DATA[i];
        if (squareCodes[entry >> 7] === 0) {
          pushPseudoDest(squareCodes, moves, alliesOut, isRed, entry & 0x7F);
        }
      }
      break;
    }
    case 3: {
      for (let i = SEARCH_HORSE_DEST_OFF[fromSq], n = SEARCH_HORSE_DEST_OFF[fromSq + 1]; i < n; i++) {
        const entry = SEARCH_HORSE_DEST_DATA[i];
        if (squareCodes[entry >> 7] === 0) {
          pushPseudoDest(squareCodes, moves, alliesOut, isRed, entry & 0x7F);
        }
      }
      break;
    }
    case 2:
      for (let i = 0; i < ORTH_DIRS.length; i++) {
        const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
        let nr = r + dr, nc = c + dc;
        while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          const toSq = nr * 9 + nc;
          const targetCode = squareCodes[toSq];
          if (targetCode === 0) {
            moves.push(toSq);
          } else {
            if ((targetCode < 8) !== isRed) moves.push(toSq);
            else if (alliesOut && (targetCode & 7) !== 1) alliesOut.push(toSq);
            break;
          }
          nr += dr; nc += dc;
        }
      }
      break;
    case 6:
      for (let i = 0; i < ORTH_DIRS.length; i++) {
        const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
        let nr = r + dr, nc = c + dc;
        let screenFound = false;
        while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          const toSq = nr * 9 + nc;
          const targetCode = squareCodes[toSq];
          if (!screenFound) {
            if (targetCode === 0) {
              moves.push(toSq);
            } else {
              screenFound = true;
            }
          } else if (targetCode !== 0) {
            if ((targetCode < 8) !== isRed) moves.push(toSq);
            break;
          }
          nr += dr; nc += dc;
        }
      }
      break;
    case 7: {
      const destBase = colorIdx * DEST_OFF_STRIDE + fromSq;
      for (let i = SEARCH_SOLDIER_DEST_OFF[destBase], n = SEARCH_SOLDIER_DEST_OFF[destBase + 1]; i < n; i++) {
        pushPseudoDest(squareCodes, moves, alliesOut, isRed, SEARCH_SOLDIER_DEST_DATA[i]);
      }
      break;
    }
  }
  return moves;
};

// 收集全部将军者（最多 4 个）。车/将走第一子，炮走第二子，马走无腿，兵走邻格。
const collectCheckersFromState = (state, color, out) => {
    out.count = 0;
    const ownIsRed = color === 'red';
    const generalSq = ownIsRed ? state.redGeneralSq : state.blackGeneralSq;
    if (generalSq < 0) {
        addChecker(out, -1, CHECK_KIND_RAY);
        return out;
    }

    const squareCodes = state.squareCodes;
    const enemyIsRed = !ownIsRed;
    const gr = SEARCH_SQ_ROWS[generalSq];
    const gc = SEARCH_SQ_COLS[generalSq];

    const rankKey = gc * RANK_OCC_COUNT + state.rowOccupancy[gr];
    const fileKey = gr * FILE_OCC_COUNT + state.colOccupancy[gc];
    let first = RANK_FIRST_LOW[rankKey];
    let second = RANK_SECOND_LOW[rankKey];
    if (first !== 255) {
        let pieceCode = squareCodes[gr * COLS + first];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) {
            addChecker(out, gr * COLS + first, CHECK_KIND_RAY);
        }
        if (second !== 255) {
            pieceCode = squareCodes[gr * COLS + second];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) {
                addChecker(out, gr * COLS + second, CHECK_KIND_CANNON, gr * COLS + first);
            }
        }
    }
    first = RANK_FIRST_HIGH[rankKey];
    second = RANK_SECOND_HIGH[rankKey];
    if (first !== 255) {
        let pieceCode = squareCodes[gr * COLS + first];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) {
            addChecker(out, gr * COLS + first, CHECK_KIND_RAY);
        }
        if (second !== 255) {
            pieceCode = squareCodes[gr * COLS + second];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) {
                addChecker(out, gr * COLS + second, CHECK_KIND_CANNON, gr * COLS + first);
            }
        }
    }
    first = FILE_FIRST_LOW[fileKey];
    second = FILE_SECOND_LOW[fileKey];
    if (first !== 255) {
        let pieceCode = squareCodes[first * COLS + gc];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) {
            addChecker(out, first * COLS + gc, CHECK_KIND_RAY);
        }
        if (second !== 255) {
            pieceCode = squareCodes[second * COLS + gc];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) {
                addChecker(out, second * COLS + gc, CHECK_KIND_CANNON, first * COLS + gc);
            }
        }
    }
    first = FILE_FIRST_HIGH[fileKey];
    second = FILE_SECOND_HIGH[fileKey];
    if (first !== 255) {
        let pieceCode = squareCodes[first * COLS + gc];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) {
            addChecker(out, first * COLS + gc, CHECK_KIND_RAY);
        }
        if (second !== 255) {
            pieceCode = squareCodes[second * COLS + gc];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) {
                addChecker(out, second * COLS + gc, CHECK_KIND_CANNON, first * COLS + gc);
            }
        }
    }

    const horseCheckerData = SEARCH_HORSE_CHECKER_DATA;
    for (let i = SEARCH_HORSE_CHECKER_OFF[generalSq], n = SEARCH_HORSE_CHECKER_OFF[generalSq + 1]; i < n; i++) {
        const entry = horseCheckerData[i];
        if (squareCodes[entry >>> 7] !== 0) continue;
        const horseSq = entry & 127;
        const pieceCode = squareCodes[horseSq];
        if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 3) {
            addChecker(out, horseSq, CHECK_KIND_HORSE, entry >>> 7);
        }
    }

    const enemyForward = enemyIsRed ? 1 : -1;
    const forwardR = gr - enemyForward;
    if (forwardR >= 0 && forwardR < ROWS) {
        const soldierSq = forwardR * 9 + gc;
        const pieceCode = squareCodes[soldierSq];
        if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 7) {
            addChecker(out, soldierSq, CHECK_KIND_SOLDIER);
        }
    }
    const crossedRiver = enemyIsRed ? gr >= 5 : gr <= 4;
    if (crossedRiver) {
        if (gc < COLS - 1) {
            const soldierSq = generalSq + 1;
            const pieceCode = squareCodes[soldierSq];
            if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 7) {
                addChecker(out, soldierSq, CHECK_KIND_SOLDIER);
            }
        }
        if (gc > 0) {
            const soldierSq = generalSq - 1;
            const pieceCode = squareCodes[soldierSq];
            if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 7) {
                addChecker(out, soldierSq, CHECK_KIND_SOLDIER);
            }
        }
    }

    return out;
};

// 占位表将军检测：occupancy 查车/将/炮，再查马和兵。白脸将算第一子为敌将。
const isCheckFromState = (state, color) => {
    const ownIsRed = color === 'red';
    const generalSq = ownIsRed ? state.redGeneralSq : state.blackGeneralSq;
    if (generalSq < 0) return true;

    const squareCodes = state.squareCodes;
    const enemyIsRed = !ownIsRed;
    const gr = SEARCH_SQ_ROWS[generalSq];
    const gc = SEARCH_SQ_COLS[generalSq];

    const rankKey = gc * RANK_OCC_COUNT + state.rowOccupancy[gr];
    const fileKey = gr * FILE_OCC_COUNT + state.colOccupancy[gc];
    let first = RANK_FIRST_LOW[rankKey];
    if (first !== 255) {
        let pieceCode = squareCodes[gr * COLS + first];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
        const second = RANK_SECOND_LOW[rankKey];
        if (second !== 255) {
            pieceCode = squareCodes[gr * COLS + second];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
        }
    }
    first = RANK_FIRST_HIGH[rankKey];
    if (first !== 255) {
        let pieceCode = squareCodes[gr * COLS + first];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
        const second = RANK_SECOND_HIGH[rankKey];
        if (second !== 255) {
            pieceCode = squareCodes[gr * COLS + second];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
        }
    }
    first = FILE_FIRST_LOW[fileKey];
    if (first !== 255) {
        let pieceCode = squareCodes[first * COLS + gc];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
        const second = FILE_SECOND_LOW[fileKey];
        if (second !== 255) {
            pieceCode = squareCodes[second * COLS + gc];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
        }
    }
    first = FILE_FIRST_HIGH[fileKey];
    if (first !== 255) {
        let pieceCode = squareCodes[first * COLS + gc];
        if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) < 3) return true;
        const second = FILE_SECOND_HIGH[fileKey];
        if (second !== 255) {
            pieceCode = squareCodes[second * COLS + gc];
            if ((pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 6) return true;
        }
    }

    const horseCheckerData = SEARCH_HORSE_CHECKER_DATA;
    for (let i = SEARCH_HORSE_CHECKER_OFF[generalSq], n = SEARCH_HORSE_CHECKER_OFF[generalSq + 1]; i < n; i++) {
        const entry = horseCheckerData[i];
        if (squareCodes[entry >>> 7] !== 0) continue;
        const pieceCode = squareCodes[entry & 127];
        if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 3) return true;
    }

    const enemyForward = enemyIsRed ? 1 : -1;
    const forwardR = gr - enemyForward;
    if (forwardR >= 0 && forwardR < ROWS) {
        const pieceCode = squareCodes[forwardR * 9 + gc];
        if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 7) return true;
    }
    const crossedRiver = enemyIsRed ? gr >= 5 : gr <= 4;
    if (crossedRiver) {
        if (gc < COLS - 1) {
            const pieceCode = squareCodes[generalSq + 1];
            if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 7) return true;
        }
        if (gc > 0) {
            const pieceCode = squareCodes[generalSq - 1];
            if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 7) return true;
        }
    }

    return false;
};

// 父节点：走子后对方是否被将。第 0 级只看坐标（将线 / 马位腿 / 兵位），否证则不再全量扫。
const probeMoveGivesCheck = (state, checkedColor, fromSq, toSq) => {
    const generalSq = checkedColor === 'red' ? state.redGeneralSq : state.blackGeneralSq;
    if (generalSq < 0) return true;
    const gr = SEARCH_SQ_ROWS[generalSq];
    const gc = SEARCH_SQ_COLS[generalSq];
    if (
        SEARCH_SQ_ROWS[fromSq] !== gr &&
        SEARCH_SQ_ROWS[toSq] !== gr &&
        SEARCH_SQ_COLS[fromSq] !== gc &&
        SEARCH_SQ_COLS[toSq] !== gc
    ) {
        const nearBase = generalSq * 3;
        if (
            (SEARCH_GIVES_CHECK_NEAR[nearBase + (fromSq >>> 5)] & (1 << (fromSq & 31))) === 0 &&
            (SEARCH_GIVES_CHECK_NEAR[nearBase + (toSq >>> 5)] & (1 << (toSq & 31))) === 0
        ) {
            return false;
        }
    }
    return isCheckAfterGivingMove(state, checkedColor, fromSq, toSq);
};

const isCheck = (board, color, piecesInfo = null, boardInfo = null) => {
    if (boardInfo) {
        return color === 'red' ? boardInfo.redIsInCheck : boardInfo.blackIsInCheck;
    }
    if (piecesInfo && piecesInfo.length > 0) {
        return color === 'red' ? piecesInfo[0].redIsInCheck : piecesInfo[0].blackIsInCheck;
    }
    const state = activePieceStateFor(board);
    if (state) return isCheckFromState(state, color);
    return runWithPieceState(board, () => {
        const created = activePieceStateFor(board);
        return created ? isCheckFromState(created, color) : true;
    });
};

// 合法着法：伪合法 + 不送将/不飞将。返回落点格号（r * 9 + c），UI 再解码。
const getValidMovesFromSq = (board, fromSq) => {
  const state = activePieceStateFor(board);
  if (!state) return [];
  const pieceCode = state.squareCodes[fromSq];
  if (!pieceCode) return [];
  const color = pieceCode < 8 ? 'red' : 'black';
  return filterLegalMoves(board, fromSq, color, getPieceMoves(state, fromSq, pieceCode));
};

const getValidMoves = (board, pos) => runWithPieceState(board, () =>
  getValidMovesFromSq(board, pos.r * 9 + pos.c)
);

const checkGameState = (board, turn, piecesInfo = null, boardInfo = null) => {
    // 优先使用预计算的gameState
    if (boardInfo && boardInfo.gameState) {
        return boardInfo.gameState;
    }
    
    // 没有预计算结果时，执行原始计算
    let hasMoves = false;
    runWithPieceState(board, () => {
        const state = activePieceStateFor(board);
        const wantRed = turn === 'red';
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const code = state.squareCodes[r * 9 + c];
                if (!code || (code < 8) !== wantRed) continue;
                if (getValidMovesFromSq(board, r * 9 + c).length > 0) {
                    hasMoves = true;
                    return;
                }
            }
        }
    });

    if (hasMoves) return { status: 'playing' };

    const inCheck = isCheck(board, turn, piecesInfo, boardInfo);
    const opponent = turn === 'red' ? 'black' : 'red';
    
    if (inCheck) {
        return { status: 'checkmate', winner: opponent };
    } else {
        return { status: 'stalemate', winner: opponent };
    }
};



const getGamePhase = () => {
  return 'opening';
};

// 实例化ZobristHasher
const zobristHasher = new ZobristHasher();

// 定长槽位 TT：8 字节 AoS + generation O(1) clear。
// 长度取 2^22：d8 约 110 万独特局面时负载~0.27，显著低于 2^21 下的冲突覆盖率。
const TT_DEFAULT_SIZE = 1 << 22; // 4194304
const TT_FLAG_NAMES = ['exact', 'lowerbound', 'upperbound'];
// word0: key16:0-15 | gen:16-23 | flag:24-25 | keyHigh:26 | depth:27-31
// word1: value18:0-17 | move:18-31
// 索引已用 key 低 22 位；key16 只存高 16 位，校验强度与原先满 32 位 key 相同。
const TT_W0_KEY_MASK = 0xFFFF;
const TT_W0_GEN_SHIFT = 16;
const TT_W0_GEN_CLEAR = 0xFF00FFFF;
const TT_W0_FLAG_SHIFT = 24;
const TT_W0_KEYHIGH = 0x04000000;
const TT_W0_DEPTH_SHIFT = 27;
const TT_W1_VALUE_MASK = 0x3FFFF;
const TT_W1_MOVE_SHIFT = 18;
const TT_W1_MOVE_MASK = 0x3FFF;
const TT_VALUE_MIN = -131072;
const TT_VALUE_MAX = 131071;
const TT_DEPTH_MAX = 31;
const TT_GEN_MASK8 = 0xFF;

class TranspositionTable {
    constructor(size = TT_DEFAULT_SIZE) {
        let n = size | 0;
        if (n < 1024) n = 1024;
        // 强制 2 的幂，便于 key & mask
        n = 1 << (32 - Math.clz32(n - 1));
        this.size = n;
        this.mask = n - 1;
        this.generation = 1;
        this.retainedGenerations = 0;
        this.reuseScope = null;
        this.lastSearchPly = null;
        this.occupiedApprox = 0;
        this.hasher = zobristHasher;

        this.data = new Uint32Array(n << 1);
        // retrieve 复用，避免每次分配；调用方须在下一次 retrieve/递归前读完字段
        this.entryScratch = {
            depth: 0,
            value: 0,
            flag: 'exact',
            bestMove: null
        };

        this.stats = {
            hits: 0,
            misses: 0,
            exactHits: 0,
            lowerboundHits: 0,
            upperboundHits: 0,
            stores: 0,
            lruEvictions: 0,
            depthPreferredEvictions: 0,
            updatedStores: 0,
            retainedUpdates: 0,
            clears: 0,
            retainedSearches: 0,
            retainedEntriesAtStart: 0,
            historicalHits: 0,
            historicalReplacements: 0
        };
    }

    _writeSlot(base, key16, gen, flagCode, keyHigh, depth, value, move) {
        const d = depth > TT_DEPTH_MAX ? TT_DEPTH_MAX : (depth < 0 ? 0 : depth);
        let v = value | 0;
        if (v > TT_VALUE_MAX) v = TT_VALUE_MAX;
        else if (v < TT_VALUE_MIN) v = TT_VALUE_MIN;
        this.data[base] = key16
            | (gen << TT_W0_GEN_SHIFT)
            | (flagCode << TT_W0_FLAG_SHIFT)
            | (keyHigh ? TT_W0_KEYHIGH : 0)
            | (d << TT_W0_DEPTH_SHIFT);
        this.data[base + 1] = (v & TT_W1_VALUE_MASK) | ((move & TT_W1_MOVE_MASK) << TT_W1_MOVE_SHIFT);
    }

    store(key, depth, value, flag, bestMove = null) {
        const keyLow = key >>> 0;
        const key16 = keyLow >>> 16;
        const keyHigh = key < 0;
        const base = (keyLow & this.mask) << 1;
        const word0 = this.data[base];
        const gen = this.generation;
        const slotGen = (word0 >>> TT_W0_GEN_SHIFT) & TT_GEN_MASK8;
        const live = this.retainedGenerations === 0
            ? slotGen === gen
            : slotGen !== 0 && ((gen - slotGen) >>> 0) <= this.retainedGenerations;
        const flagCode = flag === 'exact' ? 0 : (flag === 'lowerbound' ? 1 : 2);
        const move = bestMove === null
            ? 0
            : (isEncodedMove(bestMove) ? bestMove : encodeMove(bestMove.from, bestMove.to));

        if (live && (word0 & TT_W0_KEY_MASK) === key16 &&
            !!(word0 & TT_W0_KEYHIGH) === keyHigh) {
            if (searchContext.collectMetrics) this.stats.updatedStores++;
            const slotDepth = word0 >>> TT_W0_DEPTH_SHIFT;
            // 更深 exact 不被更浅 bound 覆盖
            if (slotDepth > depth &&
                ((word0 >>> TT_W0_FLAG_SHIFT) & 3) === 0 && flagCode !== 0) {
                if (searchContext.collectMetrics) this.stats.retainedUpdates++;
                // The matching historical entry is useful in this search; refresh
                // its generation so it cannot expire while the current search runs.
                this.data[base] = (word0 & TT_W0_GEN_CLEAR) | (gen << TT_W0_GEN_SHIFT);
                return;
            }
            this._writeSlot(base, key16, gen, flagCode, keyHigh, depth, value, move);
            if (searchContext.collectMetrics) this.stats.stores++;
            return;
        }

        if (live) {
            const historicalSlot = slotGen !== gen;
            const slotDepth = word0 >>> TT_W0_DEPTH_SHIFT;
            // Current-search entries remain depth preferred. A different-key
            // historical entry must never block the current generation.
            if (!historicalSlot && slotDepth > depth) {
                if (searchContext.collectMetrics) {
                    this.stats.retainedUpdates++;
                    this.stats.depthPreferredEvictions++;
                }
                return;
            }
            if (searchContext.collectMetrics) {
                this.stats.lruEvictions++;
                if (historicalSlot) this.stats.historicalReplacements++;
            }
        } else if (searchContext.collectMetrics) {
            this.occupiedApprox++;
        }

        this._writeSlot(base, key16, gen, flagCode, keyHigh, depth, value, move);
        if (searchContext.collectMetrics) this.stats.stores++;
    }

    retrieve(key) {
        const keyLow = key >>> 0;
        const base = (keyLow & this.mask) << 1;
        const word0 = this.data[base];
        const slotGen = (word0 >>> TT_W0_GEN_SHIFT) & TT_GEN_MASK8;
        const age = this.retainedGenerations === 0
            ? (slotGen === this.generation ? 0 : 0xffffffff)
            : (slotGen === 0 ? 0xffffffff : ((this.generation - slotGen) >>> 0));
        if (age > this.retainedGenerations ||
            (word0 & TT_W0_KEY_MASK) !== (keyLow >>> 16) ||
            !!(word0 & TT_W0_KEYHIGH) !== (key < 0)) {
            if (searchContext.collectMetrics) this.stats.misses++;
            return null;
        }
        if (searchContext.collectMetrics) {
            this.stats.hits++;
            if (age > 0) this.stats.historicalHits++;
        }
        const flagCode = (word0 >>> TT_W0_FLAG_SHIFT) & 3;
        if (searchContext.profile) {
            if (flagCode === 0) this.stats.exactHits++;
            else if (flagCode === 1) this.stats.lowerboundHits++;
            else this.stats.upperboundHits++;
        }
        const word1 = this.data[base + 1];
        const e = this.entryScratch;
        e.depth = word0 >>> TT_W0_DEPTH_SHIFT;
        e.value = (word1 << 14) >> 14;
        e.flag = TT_FLAG_NAMES[flagCode];
        e.bestMove = (word1 >>> TT_W1_MOVE_SHIFT) || null;
        return e;
    }

    beginSearch(retainPrevious, maxAge = 1, reuseScope = null, searchPly = 0) {
        const canRetain = !!retainPrevious &&
            reuseScope != null &&
            reuseScope === this.reuseScope &&
            this.lastSearchPly != null &&
            searchPly === this.lastSearchPly + 2;
        this.generation = (this.generation + 1) & TT_GEN_MASK8;
        if (this.generation === 0) {
            this.generation = 1;
            this.data.fill(0);
            this.occupiedApprox = 0;
        }
        this.retainedGenerations = canRetain ? Math.max(1, maxAge | 0) : 0;
        this.reuseScope = reuseScope;
        this.lastSearchPly = searchPly;
        if (!canRetain) this.occupiedApprox = 0;
        if (searchContext.collectMetrics) {
            this.stats.clears++;
            if (canRetain) {
                this.stats.retainedSearches++;
                this.stats.retainedEntriesAtStart = Math.min(this.occupiedApprox, this.size);
            }
        }
    }

    clear() {
        this.beginSearch(false, 0, null, 0);
        this.lastSearchPly = null;
    }

    getStats() {
        const totalAccesses = this.stats.hits + this.stats.misses;
        const hitRate = totalAccesses > 0 ? (this.stats.hits / totalAccesses * 100).toFixed(2) : 0;
        const currentSize = Math.min(this.occupiedApprox, this.size);
        return {
            ...this.stats,
            totalAccesses,
            hitRate,
            currentSize,
            maxSize: this.size,
            fillPercentage: ((currentSize / this.size) * 100).toFixed(2)
        };
    }

    resetStats() {
        this.stats = {
            hits: 0,
            misses: 0,
            exactHits: 0,
            lowerboundHits: 0,
            upperboundHits: 0,
            stores: 0,
            lruEvictions: 0,
            depthPreferredEvictions: 0,
            updatedStores: 0,
            retainedUpdates: 0,
            clears: 0,
            retainedSearches: 0,
            retainedEntriesAtStart: 0,
            historicalHits: 0,
            historicalReplacements: 0
        };
    }
}

// bench / profile 用。对弈默认不采集。
let perfStats = {
    alphaBetaCalls: 0,
    legalMovesSearched: 0,
    lmrAttempts: 0,
    lmrReSearches: 0,
    pvsAttempts: 0,
    pvsReSearches: 0,
    nmpAttempts: 0,
    nmpCutoffs: 0,
    fastLeafEvalCount: 0,
    fastLeafEvalMs: 0,
    leafRelationsMs: 0,
    leafTacticalMs: 0,
    prepareCheckMs: 0,
    prepareMoveGenMs: 0,
    sortMovesCount: 0,
    sortMovesMs: 0,
    captureGenCount: 0,
    captureGenMs: 0,
    quiescenceCalls: 0,
    quiescenceCaptureMoves: 0,
    staticEvalCacheHits: 0,
    staticEvalCacheMisses: 0,
    evaluateBoardMs: 0,
    prepareSearchInfoMs: 0,
    startTime: Date.now()
};

const resetPerfStats = () => {
    if (!searchContext.collectMetrics && !searchContext.profile) return;
    perfStats.alphaBetaCalls = 0;
    perfStats.legalMovesSearched = 0;
    perfStats.lmrAttempts = 0;
    perfStats.lmrReSearches = 0;
    perfStats.pvsAttempts = 0;
    perfStats.pvsReSearches = 0;
    perfStats.nmpAttempts = 0;
    perfStats.nmpCutoffs = 0;
    perfStats.fastLeafEvalCount = 0;
    perfStats.fastLeafEvalMs = 0;
    perfStats.leafRelationsMs = 0;
    perfStats.leafTacticalMs = 0;
    perfStats.prepareCheckMs = 0;
    perfStats.prepareMoveGenMs = 0;
    perfStats.sortMovesCount = 0;
    perfStats.sortMovesMs = 0;
    perfStats.captureGenCount = 0;
    perfStats.captureGenMs = 0;
    perfStats.quiescenceCalls = 0;
    perfStats.quiescenceCaptureMoves = 0;
    perfStats.staticEvalCacheHits = 0;
    perfStats.staticEvalCacheMisses = 0;
    perfStats.evaluateBoardMs = 0;
    perfStats.prepareSearchInfoMs = 0;
    perfStats.startTime = Date.now();
};

const snapshotPerfStats = () => {
    const elapsed = Date.now() - perfStats.startTime;
    const evalHits = perfStats.staticEvalCacheHits;
    const evalMisses = perfStats.staticEvalCacheMisses;
    return {
        elapsedMs: elapsed,
        profile: searchContext.profile,
        alphaBetaCalls: perfStats.alphaBetaCalls,
        legalMovesSearched: perfStats.legalMovesSearched,
        lmr: searchContext.collectMetrics ? {
            minDepth: searchContext.lmrMinDepth,
            minMove: searchContext.lmrMinMove,
            attempts: perfStats.lmrAttempts,
            reSearches: perfStats.lmrReSearches,
            reSearchRate: perfStats.lmrAttempts
                ? Number((perfStats.lmrReSearches / perfStats.lmrAttempts * 100).toFixed(2))
                : 0
        } : null,
        pvs: searchContext.collectMetrics ? {
            attempts: perfStats.pvsAttempts,
            reSearches: perfStats.pvsReSearches,
            reSearchRate: perfStats.pvsAttempts
                ? Number((perfStats.pvsReSearches / perfStats.pvsAttempts * 100).toFixed(2))
                : 0
        } : null,
        nmp: searchContext.collectMetrics ? {
            minDepth: searchContext.nmpMinDepth,
            reduction: searchContext.nmpReduction,
            attempts: perfStats.nmpAttempts,
            cutoffs: perfStats.nmpCutoffs,
            cutoffRate: perfStats.nmpAttempts
                ? Number((perfStats.nmpCutoffs / perfStats.nmpAttempts * 100).toFixed(2))
                : 0
        } : null,
        fastLeafEvalCount: perfStats.fastLeafEvalCount,
        fastLeafEvalMs: perfStats.fastLeafEvalMs,
        leafRelations: searchContext.profile ? {
            relationMs: perfStats.leafRelationsMs,
            tacticalMs: perfStats.leafTacticalMs
        } : null,
        prepareCheckMs: perfStats.prepareCheckMs,
        prepareMoveGenMs: perfStats.prepareMoveGenMs,
        sortMovesCount: perfStats.sortMovesCount,
        sortMovesMs: perfStats.sortMovesMs,
        captureGenCount: perfStats.captureGenCount,
        captureGenMs: perfStats.captureGenMs,
        quiescenceCalls: perfStats.quiescenceCalls,
        quiescenceCaptureMoves: perfStats.quiescenceCaptureMoves,
        staticEvalCacheHits: evalHits,
        staticEvalCacheMisses: evalMisses,
        evalCacheSize: EVAL_CACHE_SIZE,
        evalCacheBytes: evalCacheKeys.byteLength +
            evalCacheValues.byteLength +
            evalCacheGenerations.byteLength,
        evaluateBoardMs: perfStats.evaluateBoardMs,
        prepareSearchInfoMs: perfStats.prepareSearchInfoMs,
        tt: transpositionTable.getStats()
    };
};

// 打印统计信息
const logPerfStats = (currentPlayer) => {
    const snap = snapshotPerfStats();
    console.log(`Search stats (${currentPlayer}): ${snap.elapsedMs}ms, nodes=${snap.alphaBetaCalls}, legal=${snap.legalMovesSearched}, leaves=${snap.fastLeafEvalCount}`);
    console.log(`TT: ${snap.tt.hits}/${snap.tt.misses} (${snap.tt.hitRate}%), stores=${snap.tt.stores}, size=${snap.tt.currentSize}`);
};

const transpositionTable = new TranspositionTable();

// 叶评估缓存（完整形势分）：定长直接映射，完整 key 校验避免槽位冲突误命中。
// generation 让每次搜索的 clear 保持 O(1)，也避免 Map 满载后的批量 delete。
const EVAL_CACHE_SIZE = 1 << 20;
const EVAL_CACHE_MASK = EVAL_CACHE_SIZE - 1;
const evalCacheKeys = new Int32Array(EVAL_CACHE_SIZE);
const evalCacheValues = new Int32Array(EVAL_CACHE_SIZE);
const evalCacheGenerations = new Uint8Array(EVAL_CACHE_SIZE);
let evalCacheGeneration = 1;
const clearEvalCache = () => {
    evalCacheGeneration = (evalCacheGeneration + 1) & 0xff;
    if (evalCacheGeneration === 0) {
        evalCacheGeneration = 1;
        evalCacheGenerations.fill(0);
    }
};

// 剪枝开关：完整评估下若开局出废棋则先关，保棋力再重标定
const SEARCH_QUIESCENCE_DEPTH = 2;
const NULL_WINDOW = 1;
// LMR 减深：复刻 (log(d)*log(m)/ln2)|0，热路径不走 Math.log
const LMR_TABLE_DEPTH_MAX = 32;
const LMR_TABLE_MOVE_MAX = 64;
const LMR_TABLE_STRIDE = LMR_TABLE_MOVE_MAX + 1;
const LMR_REDUCTION = new Int8Array((LMR_TABLE_DEPTH_MAX + 1) * LMR_TABLE_STRIDE);
for (let depth = 1; depth <= LMR_TABLE_DEPTH_MAX; depth++) {
    for (let moveNo = 1; moveNo <= LMR_TABLE_MOVE_MAX; moveNo++) {
        LMR_REDUCTION[depth * LMR_TABLE_STRIDE + moveNo] =
            (Math.log(depth) * Math.log(moveNo) / Math.LN2) | 0;
    }
}
// True staged generation owns one move list per active alpha-beta stack level.
// Depth always decreases on recursion, including LMR/NMP probes, so siblings
// and re-searches can safely reuse the list after the previous call returns.
const playStagedMoveBuffers = [];
// 着法合法性：true=搜索内试走时检测（可跳过剪枝未触及着法）；false=prepare 时全量 filterLegalMoves（旧路径）

// Zobrist/TT：true=搜索内增量维护局面哈希 + 数值 TT key；false=每节点全盘 hash + 字符串 key（旧路径，便于 A/B）
// 调试：增量后与全盘 hash 比对（仅校验脚本开启，正式搜索关闭）

// 搜索启发：杀棋表 + 历史启发（每次 getBestMove 重置）
let killerMoves = [];
let historyTable = null;
const EMPTY_KILLERS = [null, null];
const HISTORY_TABLE_SIZE = REL_SQUARES << 7;

const resetSearchHeuristics = (maxDepth) => {
    const need = Math.max(2, (maxDepth | 0) + 2);
    for (let i = killerMoves.length; i < need; i++) {
        killerMoves.push([null, null]);
    }
    for (let i = 0; i < need; i++) {
        killerMoves[i][0] = null;
        killerMoves[i][1] = null;
    }
    if (!historyTable || historyTable.length !== HISTORY_TABLE_SIZE) {
        historyTable = new Int32Array(HISTORY_TABLE_SIZE);
    } else {
        historyTable.fill(0);
    }
};

const isSameMove = (a, b) =>
    a != null && b != null &&
    moveFromSq(a) === moveFromSq(b) &&
    moveToSq(a) === moveToSq(b);

const storeKillerMove = (depth, move) => {
    if (depth < 0 || depth >= killerMoves.length || !move) return;
    const slot = killerMoves[depth];
    if (isSameMove(slot[0], move)) return;
    slot[1] = slot[0];
    slot[0] = isEncodedMove(move) ? move : encodeMove(move.from, move.to);
};

const historyIndex = (move) => (moveFromSq(move) << 7) | moveToSq(move);

const addHistoryScore = (move, depth) => {
    if (!historyTable || !move) return;
    const key = historyIndex(move);
    historyTable[key] += depth * depth;
};

const getHistoryScore = (move) => {
    if (!historyTable || !move) return 0;
    return historyTable[historyIndex(move)];
};

// 仅在仍有车、马或炮时允许空步，避开最容易出现 zugzwang 的低子力残局。
const hasNullMoveMaterial = (pieceState, color) => {
    const isRed = color === 'red';
    const pieceCodes = pieceState.pieceCodes;
    let mask = (isRed ? pieceState.redAliveMask : pieceState.blackAliveMask) >>> 0;
    while (mask !== 0) {
        const bit = mask & -mask;
        const pieceType = pieceCodes[31 - Math.clz32(bit)] & 7;
        if (pieceType === 2 || pieceType === 3 || pieceType === 6) return true;
        mask ^= bit;
    }
    return false;
};

// 搜索用 TT key：增量模式为 number，旧模式为 `${hash}:${side}` 字符串
const makeSearchTTKey = (board, currentPlayer, boardHash) => {
    return zobristHasher.ttKeyFromHash(boardHash, currentPlayer);
};

// 走子后的子节点局面哈希（仅增量模式有意义；须在 make 前保存 movingPiece）
const childBoardHash = (boardHash, move, moverCode, capturedCode) => {
    const from = move >>> 7;
    const to = move & MOVE_TO_MASK;
    let newHash = boardHash;
    const hashTableFlat = zobristHasher.hashTableFlat;
    const movingIdx = SEARCH_CODE_TO_ZOBRIST[moverCode];
    if (movingIdx >= 0) {
        newHash ^= hashTableFlat[from * 14 + movingIdx];
        newHash ^= hashTableFlat[to * 14 + movingIdx];
    }
    if (capturedCode) {
        const capturedIdx = SEARCH_CODE_TO_ZOBRIST[capturedCode];
        if (capturedIdx >= 0) newHash ^= hashTableFlat[to * 14 + capturedIdx];
    }
    return newHash;
};

// 搜索叶：关系 + 威胁/SEE + 安全 + 汇总（要求 activeSearchPieceState 已绑定 board）
const evaluateLeafNumeric = (board, searchInitiator, gameStage, capturePlayer = null) => {
    const __t0 = searchContext.profile ? performance.now() : 0;
    const pieceState = activePieceStateFor(board);
    const stateCodes = pieceState.pieceCodes;
    const materialValues = pieceState.materialValues;
    const squareCodes = pieceState.squareCodes;
    const aliveMask = (pieceState.redAliveMask | pieceState.blackAliveMask) >>> 0;

    calculatePackedSearchLeafRelationsNumeric(pieceState, aliveMask, capturePlayer);

    const checkBonus = CHECK_BONUS;
    const attackBySlot = scratchLeafAttackBySlot;
    const guardBySlot = scratchLeafGuardBySlot;
    const blackAttack = scratchBlackAttack;
    const redAttack = scratchRedAttack;
    let redThreat = 0;
    let blackThreat = 0;
    const tacticalStart = searchContext.profile ? performance.now() : 0;
    let attackedTargets = scratchLeafAttackedTargetMask >>> 0;
    while (attackedTargets !== 0) {
        const targetBit = attackedTargets & -attackedTargets;
        const targetSlot = 31 - Math.clz32(targetBit);
        attackedTargets ^= targetBit;
        const attackers = attackBySlot[targetSlot] >>> 0;
        const firstBit = attackers & -attackers;
        const attackerIndex = 31 - Math.clz32(firstBit);
        const targetCode = stateCodes[targetSlot];
        let threatValue = 0;
        if ((targetCode & 7) === 1) {
            threatValue = checkBonus;
        } else {
            const targetValue = materialValues[targetCode & 7];
            const guards = guardBySlot[targetSlot] >>> 0;
            if (guards === 0) {
                threatValue = targetValue;
            } else if (attackers === (firstBit >>> 0)) {
                const seeScore = targetValue - materialValues[stateCodes[attackerIndex] & 7];
                if (seeScore > 0) threatValue = seeScore >> 1;
            } else {
                const seeScore = calculateStaticExchangeScoreNumeric(
                    targetValue, attackers, guards, stateCodes, materialValues
                );
                if (seeScore > 0) threatValue = seeScore >> 1;
            }
        }
        if (stateCodes[attackerIndex] < 8) redThreat += threatValue;
        else blackThreat += threatValue;
    }
    if (searchContext.profile) perfStats.leafTacticalMs += performance.now() - tacticalStart;

    let redSafety = 0;
    let blackSafety = 0;
    const redGeneralSq = pieceState.redGeneralSq;
    if (redGeneralSq >= 0) {
        for (let i = SEARCH_GENERAL_DEST_OFF[redGeneralSq], n = SEARCH_GENERAL_DEST_OFF[redGeneralSq + 1]; i < n; i++) {
            const sq = SEARCH_GENERAL_DEST_DATA[i];
            if (squareCodes[sq] === 0 && (blackAttack[sq >>> 5] & (1 << (sq & 31))) !== 0) {
                redSafety -= 50;
            }
        }
    }
    const blackGeneralSq = pieceState.blackGeneralSq;
    if (blackGeneralSq >= 0) {
        const blackDestBase = DEST_OFF_STRIDE + blackGeneralSq;
        for (let i = SEARCH_GENERAL_DEST_OFF[blackDestBase], n = SEARCH_GENERAL_DEST_OFF[blackDestBase + 1]; i < n; i++) {
            const sq = SEARCH_GENERAL_DEST_DATA[i];
            if (squareCodes[sq] === 0 && (redAttack[sq >>> 5] & (1 << (sq & 31))) !== 0) {
                blackSafety -= 50;
            }
        }
    }

    let redTotal;
    let blackTotal;
    if (leafUnityWeights) {
        redTotal = pieceState.redMaterial + pieceState.redPosition +
            redThreat + redSafety + scratchLeafTotals[2];
        blackTotal = pieceState.blackMaterial + pieceState.blackPosition +
            blackThreat + blackSafety + scratchLeafTotals[5];
    } else {
        const wMaterial = leafWMaterial;
        const wPosition = leafWPosition;
        const wThreat = leafWThreat;
        const wSafety = leafWSafety;
        const wMobility = leafWMobility;
        redTotal =
            pieceState.redMaterial * wMaterial +
            pieceState.redPosition * wPosition +
            redThreat * wThreat +
            redSafety * wSafety +
            scratchLeafTotals[2] * wMobility;
        blackTotal =
            pieceState.blackMaterial * wMaterial +
            pieceState.blackPosition * wPosition +
            blackThreat * wThreat +
            blackSafety * wSafety +
            scratchLeafTotals[5] * wMobility;
    }

    if (searchContext.profile) {
        perfStats.fastLeafEvalCount++;
        perfStats.fastLeafEvalMs += performance.now() - __t0;
    } else if (searchContext.collectMetrics) {
        perfStats.fastLeafEvalCount++;
    }
    return searchInitiator === 'red' ? redTotal - blackTotal : blackTotal - redTotal;
};

// 搜索用净分：完整形势评估（关系/威胁/安全/机动），仅跳过终局着法枚举；带 Zobrist 缓存
const staticSearchEval = (board, searchInitiator, gameStage, boardHash = 0, capturePlayer = null) => {
    const cacheKey = zobristHasher.evalCacheKeyFromHash(boardHash, searchInitiator, gameStage);
    const pieceState = activePieceStateFor(board);
    const verificationKey = pieceState ? pieceState.evalVerificationHash : 0;
    const combinedKey = cacheKey ^ verificationKey;
    const cacheSlot = (cacheKey >>> 0) & EVAL_CACHE_MASK;
    if (evalCacheGenerations[cacheSlot] === evalCacheGeneration &&
        evalCacheKeys[cacheSlot] === combinedKey) {
        if (searchContext.collectMetrics) perfStats.staticEvalCacheHits++;
        leafRelationScratchFresh = false;
        return evalCacheValues[cacheSlot];
    }
    if (searchContext.collectMetrics) perfStats.staticEvalCacheMisses++;
    const net = evaluateLeafNumeric(board, searchInitiator, gameStage, capturePlayer);
    if (capturePlayer != null) {
        packedCaptureCacheKey = cacheKey;
        packedCaptureCombinedKey = combinedKey;
        packedCaptureGeneration = evalCacheGeneration;
        packedCapturePlayer = capturePlayer;
    }
    evalCacheGenerations[cacheSlot] = evalCacheGeneration;
    evalCacheKeys[cacheSlot] = combinedKey;
    evalCacheValues[cacheSlot] = net;
    return net;
};

// Generate captures for normal QS nodes, or every pseudo move when the side to
// move is in check and must search all evasions.
const quiescenceMoveBuffers = [];

const copyPackedRelationCaptures = (
    moves, currentPlayer, boardHash, searchInitiator, gameStage, board
) => {
    const pieceState = activePieceStateFor(board);
    if (packedCaptureGeneration !== evalCacheGeneration) return false;
    const cacheKey = zobristHasher.evalCacheKeyFromHash(boardHash, searchInitiator, gameStage);
    const verificationKey = pieceState.evalVerificationHash;
    if (packedCaptureCombinedKey !== (cacheKey ^ verificationKey)) return false;
    if (packedCapturePlayer !== currentPlayer) return false;
    const captures = scratchPackedCaptures;
    for (let i = 0; i < captures.length; i++) moves.push(captures[i]);
    return true;
};

const generateQuiescenceMoves = (board, currentPlayer, capturesOnly, destination = null) => {
    const __t0 = searchContext.profile ? performance.now() : 0;
    if (searchContext.profile) perfStats.captureGenCount++;
    const moves = destination || [];
    moves.length = 0;
    const pieceState = activePieceStateFor(board);
    const pieceCodes = pieceState.pieceCodes;
    const pieceSquares = pieceState.pieceSquares;
    const isRed = currentPlayer === 'red';
    const n = collectOwnSlotsInScanOrder(pieceState, isRed);
    for (let i = 0; i < n; i++) {
        const slot = scratchOwnScanSlots[i];
        appendSearchPseudoMovesForPiece(
            moves, pieceSquares[slot], pieceCodes[slot], pieceState, capturesOnly
        );
    }
    if (searchContext.profile) perfStats.captureGenMs += performance.now() - __t0;
    return moves;
};

// Fast 叶关系已写入 attackBySlot。有吃才走原几何，落点顺序与 generateQuiescenceMoves 一致。
const emitCapturesFromLeafRelations = (moves, currentPlayer, pieceState) => {
    const attacked = scratchLeafAttackedTargetMask >>> 0;
    if (attacked === 0) return 0;
    const isRed = currentPlayer === 'red';
    const pieceSquares = pieceState.pieceSquares;
    const pieceCodes = pieceState.pieceCodes;
    const attackBySlot = scratchLeafAttackBySlot;
    const n = collectOwnSlotsInScanOrder(pieceState, isRed);
    const start = moves.length;
    let attackerUnion = 0;
    let targets = attacked;
    while (targets !== 0) {
        const targetBit = targets & -targets;
        attackerUnion |= attackBySlot[31 - Math.clz32(targetBit)];
        targets ^= targetBit;
    }
    if (attackerUnion === 0) return 0;
    for (let i = 0; i < n; i++) {
        const slot = scratchOwnScanSlots[i];
        if ((attackerUnion & (1 << slot)) === 0) continue;
        appendSearchPseudoMovesForPiece(
            moves, pieceSquares[slot], pieceCodes[slot], pieceState, true
        );
    }
    return moves.length - start;
};

// generateCapturesForSearch removed (unused alias)

const quiescenceMateValue = (currentPlayer, searchInitiator) =>
    currentPlayer === searchInitiator ? -100000 : 100000;

// 静默搜索：stand-pat 用完整形势评估；仅对吃子延伸（QS≤3）
const sortCaptures = (captures, board, gameStage) => {
    const pieceState = activePieceStateFor(board);
    const squareToSlot = pieceState.squareToSlot;
    const pieceCodes = pieceState.pieceCodes;
    const materialValues = pieceState.materialValues;

    for (let index = 0; index < captures.length; index++) {
        const move = captures[index];
        const fromSq = move >>> 7;
        const toSq = move & MOVE_TO_MASK;
        captureSortScoreScratch[index] =
            materialValues[pieceCodes[squareToSlot[toSq]] & 7] * 16 -
            materialValues[pieceCodes[squareToSlot[fromSq]] & 7];
    }

    // Stable insertion ordering exactly matches the previous numeric comparator.
    for (let i = 1; i < captures.length; i++) {
        const move = captures[i];
        const score = captureSortScoreScratch[i];
        let j = i - 1;
        while (j >= 0 && captureSortScoreScratch[j] < score) {
            captures[j + 1] = captures[j];
            captureSortScoreScratch[j + 1] = captureSortScoreScratch[j];
            j--;
        }
        captures[j + 1] = move;
        captureSortScoreScratch[j + 1] = score;
    }
    return captures;
};

const quiescence = (
    b, alpha, beta, maximizing, currentPlayer,
    searchInitiator, gameStage, qsDepth, boardHash = 0, qsPly = 0, knownInCheck = null
) => {
    if (searchContext.profile) perfStats.quiescenceCalls++;
    const qsState = activePieceStateFor(b);
    let checkInfo = null;
    let inCheck;
    if (knownInCheck == null) {
        inCheck = isCheckFromState(qsState, currentPlayer);
    } else {
        inCheck = knownInCheck;
    }
    if (inCheck) {
        checkInfo = acquireCheckInfo(qsCheckInfoPool, qsPly);
        collectCheckersFromState(qsState, currentPlayer, checkInfo);
    }
    let standPat;
    if (!inCheck) {
        standPat = staticSearchEval(
            b, searchInitiator, gameStage, boardHash,
            null
        );
        if (qsDepth <= 0) return standPat;
        if (maximizing) {
            if (standPat >= beta) return standPat;
            if (standPat > alpha) alpha = standPat;
        } else {
            if (standPat <= alpha) return standPat;
            if (standPat < beta) beta = standPat;
        }
    }

    let moves = quiescenceMoveBuffers[qsPly];
    if (!moves) {
        moves = [];
        quiescenceMoveBuffers[qsPly] = moves;
    } else {
        moves.length = 0;
    }
    if (inCheck) {
        generateCheckEvasions(moves, currentPlayer, qsState, checkInfo);
    } else if (leafRelationScratchFresh) {
        emitCapturesFromLeafRelations(moves, currentPlayer, qsState);
    } else if (!copyPackedRelationCaptures(
        moves, currentPlayer, boardHash, searchInitiator, gameStage, b
    )) {
        generateQuiescenceMoves(b, currentPlayer, true, moves);
    }
    if (searchContext.profile) perfStats.quiescenceCaptureMoves += moves.length;
    if (moves.length === 0) return inCheck
        ? quiescenceMateValue(currentPlayer, searchInitiator)
        : standPat;

    if (inCheck) {
        sortMoves(moves, b, currentPlayer, null, gameStage, null, null, null, false);
    } else {
        sortCaptures(moves, b, gameStage);
    }

    const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';
    let bestEval = inCheck ? (maximizing ? -Infinity : Infinity) : standPat;
    let legalMovesFound = 0;
    for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        const fromSq = move >>> 7;
        const toSq = move & MOVE_TO_MASK;
        const moverCode = qsState.squareCodes[fromSq];
        const capturedCode = qsState.squareCodes[toSq];
        makeSearchMove(b, move);
        if (leavesOwnKingUnsafe(qsState, currentPlayer, fromSq, toSq, inCheck, checkInfo)) {
            unmakeSearchMove(b, move);
            continue;
        }
        const nextHash = childBoardHash(boardHash, move, moverCode, capturedCode);
        const childInCheck = probeMoveGivesCheck(
            qsState, nextPlayer, fromSq, toSq
        );
        legalMovesFound++;
        if (searchContext.collectMetrics) perfStats.legalMovesSearched++;
        const value = quiescence(
            b, alpha, beta, !maximizing, nextPlayer,
            searchInitiator, gameStage, qsDepth - 1, nextHash, qsPly + 1, childInCheck
        );
        unmakeSearchMove(b, move);

        if (maximizing) {
            if (value > bestEval) bestEval = value;
            if (value > alpha) alpha = value;
        } else {
            if (value < bestEval) bestEval = value;
            if (value < beta) beta = value;
        }
        if (beta <= alpha) break;
    }
    if (inCheck && legalMovesFound === 0) {
        return quiescenceMateValue(currentPlayer, searchInitiator);
    }
    return bestEval;
};

const alphaBeta = (
    b, d, alpha, beta, maximizing, currentPlayer,
    searchDepth = 0, searchInitiator = currentPlayer, gameStage = 'mid', boardHash = 0,
    allowNull = true, knownInCheck = null
) => {
    const originalAlpha = alpha;
    const originalBeta = beta;

    if (searchContext.collectMetrics) perfStats.alphaBetaCalls++;

    if (d === 0) {
        return quiescence(
            b, alpha, beta, maximizing, currentPlayer,
            searchInitiator, gameStage, SEARCH_QUIESCENCE_DEPTH, boardHash, 0, knownInCheck
        );
    }

    const ttKey = makeSearchTTKey(b, currentPlayer, boardHash);
    const ttEntry = transpositionTable.retrieve(ttKey);
    let ttMove = null;
    if (ttEntry) {
        ttMove = ttEntry.bestMove || null;
        if (ttEntry.depth >= d) {
            if (ttEntry.flag === 'exact') return ttEntry.value;
            if (ttEntry.flag === 'lowerbound' && ttEntry.value >= beta) return ttEntry.value;
            if (ttEntry.flag === 'upperbound' && ttEntry.value <= alpha) return ttEntry.value;
        }
    }

    const stagedPieceState = activePieceStateFor(b);
    const plyFromRoot = searchDepth - d;
    let checkInfo = null;
    // TT 截断后才问是否被将。已知结果（空步子节点未将军）才跳过扫描。
    const checkStarted = searchContext.profile ? performance.now() : 0;
    let inCheck;
    if (knownInCheck == null) {
        inCheck = isCheckFromState(stagedPieceState, currentPlayer);
    } else {
        inCheck = knownInCheck;
    }
    if (inCheck) {
        checkInfo = acquireCheckInfo(abCheckInfoPool, plyFromRoot);
        collectCheckersFromState(stagedPieceState, currentPlayer, checkInfo);
    }
    if (searchContext.profile) perfStats.prepareCheckMs += performance.now() - checkStarted;

    const useTrueStagedGeneration = !inCheck;
    let moves = playStagedMoveBuffers[plyFromRoot];
    if (!moves) {
        moves = [];
        playStagedMoveBuffers[plyFromRoot] = moves;
    } else {
        moves.length = 0;
    }
    if (inCheck) {
        const genStarted = searchContext.profile ? performance.now() : 0;
        generateCheckEvasions(
            moves, currentPlayer, stagedPieceState, checkInfo
        );
        if (searchContext.profile) perfStats.prepareMoveGenMs += performance.now() - genStarted;
        if (moves.length === 0) {
            const isInitiatorWinner = currentPlayer !== searchInitiator;
            return (isInitiatorWinner ? 100000 : -100000) +
                (isInitiatorWinner ? d : (searchDepth - d));
        }
    }

    const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';

    // 非 PV 空窗节点采用空步裁剪。空步不改变棋盘与哈希，只切换行棋方。
        const canNmp = allowNull &&
        !inCheck &&
        d >= searchContext.nmpMinDepth &&
        (beta - alpha) <= NULL_WINDOW &&
        Math.abs(alpha) < 90000 &&
        Math.abs(beta) < 90000 &&
        hasNullMoveMaterial(stagedPieceState, currentPlayer);
    if (canNmp) {
        const reduction = Math.min(searchContext.nmpReduction, d - 1);
        const nullDepth = d - 1 - reduction;
        if (searchContext.collectMetrics) perfStats.nmpAttempts++;
        const nullValue = maximizing
            ? alphaBeta(
                b, nullDepth, beta - NULL_WINDOW, beta, !maximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, boardHash, false, false
            )
            : alphaBeta(
                b, nullDepth, alpha, alpha + NULL_WINDOW, !maximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, boardHash, false, false
            );
        if ((maximizing && nullValue >= beta) || (!maximizing && nullValue <= alpha)) {
            if (searchContext.collectMetrics) perfStats.nmpCutoffs++;
            return nullValue;
        }
    }

    const killersAtDepth = killerMoves[plyFromRoot] || EMPTY_KILLERS;
    let nextTrueStagedStage = 0;
    if (useTrueStagedGeneration) {
        nextTrueStagedStage = advanceTrueStagedMoves(
            moves, nextTrueStagedStage, b, currentPlayer, stagedPieceState,
            ttMove, killersAtDepth, d
        );
    } else {
        moves = sortMoves(
            moves, b, currentPlayer, null, gameStage, null,
            ttMove, killersAtDepth, inCheck
        );
    }

    let bestEval = maximizing ? -Infinity : Infinity;
    let bestMove = null;
    let legalMovesFound = 0;

    for (let moveIndex = 0; ; moveIndex++) {
        if (moveIndex >= moves.length) {
            if (!useTrueStagedGeneration) break;
            const before = moves.length;
            nextTrueStagedStage = advanceTrueStagedMoves(
                moves, nextTrueStagedStage, b, currentPlayer, stagedPieceState,
                ttMove, killersAtDepth, d
            );
            if (moves.length === before) break;
        }
        const move = moves[moveIndex];
        const fromSq = move >>> 7;
        const toSq = move & MOVE_TO_MASK;
        const moverCode = stagedPieceState.squareCodes[fromSq];
        const capturedCode = stagedPieceState.squareCodes[toSq];
        const isCapture = capturedCode !== 0;
        makeSearchMove(b, move);
        if (leavesOwnKingUnsafe(stagedPieceState, currentPlayer, fromSq, toSq, inCheck, checkInfo)) {
            unmakeSearchMove(b, move);
            continue;
        }
        const nextHash = childBoardHash(boardHash, move, moverCode, capturedCode);
        const childInCheck = probeMoveGivesCheck(stagedPieceState, nextPlayer, fromSq, toSq);
        legalMovesFound++;
        if (searchContext.collectMetrics) perfStats.legalMovesSearched++;
        // LMR：未将军时，靠后的安静着先减深空窗；看起来能改进 α/β 再全深回搜
        const canLmr = !inCheck &&
            !isCapture &&
            d >= searchContext.lmrMinDepth &&
            legalMovesFound >= searchContext.lmrMinMove &&
            move !== ttMove &&
            move !== killersAtDepth[0] &&
            move !== killersAtDepth[1];

        // 树内 PVS：非首着且窗口够宽时先空窗；fail-high 再全窗回搜
        const pvsEligible = legalMovesFound > 1 && (beta - alpha) > NULL_WINDOW;

        let reducedDepth = d - 1;
        if (canLmr) {
            let reduction = (d <= LMR_TABLE_DEPTH_MAX && legalMovesFound <= LMR_TABLE_MOVE_MAX)
                ? LMR_REDUCTION[d * LMR_TABLE_STRIDE + legalMovesFound]
                : (Math.log(d) * Math.log(legalMovesFound) / Math.LN2) | 0;
            if (reduction < 1) reduction = 1;
            const maxReduction = Math.min(searchContext.lmrMaxReduction | 0 || 2, d - 2);
            if (reduction > maxReduction) reduction = maxReduction;
            reducedDepth = d - 1 - reduction;
            if (searchContext.collectMetrics) perfStats.lmrAttempts++;
        }

        let value;
        if (maximizing) {
            if (canLmr) {
                value = alphaBeta(
                    b, reducedDepth, alpha, alpha + NULL_WINDOW, !maximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                );
                if (value > alpha) {
                    if (searchContext.collectMetrics) perfStats.lmrReSearches++;
                    if (pvsEligible) {
                        if (searchContext.collectMetrics) perfStats.pvsAttempts++;
                        value = alphaBeta(
                            b, d - 1, alpha, alpha + NULL_WINDOW, !maximizing, nextPlayer,
                            searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                        );
                        if (value > alpha) {
                            if (searchContext.collectMetrics) perfStats.pvsReSearches++;
                            value = alphaBeta(
                                b, d - 1, alpha, beta, !maximizing, nextPlayer,
                                searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                            );
                        }
                    } else {
                        value = alphaBeta(
                            b, d - 1, alpha, beta, !maximizing, nextPlayer,
                            searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                        );
                    }
                }
            } else if (pvsEligible) {
                if (searchContext.collectMetrics) perfStats.pvsAttempts++;
                value = alphaBeta(
                    b, d - 1, alpha, alpha + NULL_WINDOW, !maximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                );
                if (value > alpha) {
                    if (searchContext.collectMetrics) perfStats.pvsReSearches++;
                    value = alphaBeta(
                        b, d - 1, alpha, beta, !maximizing, nextPlayer,
                        searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                    );
                }
            } else {
                value = alphaBeta(
                    b, d - 1, alpha, beta, !maximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                );
            }
        } else if (canLmr) {
            value = alphaBeta(
                b, reducedDepth, beta - NULL_WINDOW, beta, !maximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
            );
            if (value < beta) {
                if (searchContext.collectMetrics) perfStats.lmrReSearches++;
                if (pvsEligible) {
                    if (searchContext.collectMetrics) perfStats.pvsAttempts++;
                    value = alphaBeta(
                        b, d - 1, beta - NULL_WINDOW, beta, !maximizing, nextPlayer,
                        searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                    );
                    if (value < beta) {
                        if (searchContext.collectMetrics) perfStats.pvsReSearches++;
                        value = alphaBeta(
                            b, d - 1, alpha, beta, !maximizing, nextPlayer,
                            searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                        );
                    }
                } else {
                    value = alphaBeta(
                        b, d - 1, alpha, beta, !maximizing, nextPlayer,
                        searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                    );
                }
            }
        } else if (pvsEligible) {
            if (searchContext.collectMetrics) perfStats.pvsAttempts++;
            value = alphaBeta(
                b, d - 1, beta - NULL_WINDOW, beta, !maximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
            );
            if (value < beta) {
                if (searchContext.collectMetrics) perfStats.pvsReSearches++;
                value = alphaBeta(
                    b, d - 1, alpha, beta, !maximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
                );
            }
        } else {
            value = alphaBeta(
                b, d - 1, alpha, beta, !maximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, nextHash, true, childInCheck
            );
        }
        unmakeSearchMove(b, move);

        if (maximizing) {
            if (value > bestEval) {
                bestEval = value;
                bestMove = move;
            }
            alpha = Math.max(alpha, value);
        } else {
            if (value < bestEval) {
                bestEval = value;
                bestMove = move;
            }
            beta = Math.min(beta, value);
        }

        if (beta <= alpha) {
            if (!isCapture) {
                storeKillerMove(plyFromRoot, move);
                addHistoryScore(move, d);
            }
            break;
        }
    }

    if (legalMovesFound === 0) {
        const isInitiatorWinner = currentPlayer !== searchInitiator;
        return (isInitiatorWinner ? 100000 : -100000) +
            (isInitiatorWinner ? d : (searchDepth - d));
    }

    let flag;
    if (bestEval <= originalAlpha) flag = 'upperbound';
    else if (bestEval >= originalBeta) flag = 'lowerbound';
    else flag = 'exact';
    transpositionTable.store(ttKey, d, bestEval, flag, bestMove);
    return bestEval;
};


// 从子节点沿 TT bestMove 回放 PV；走子须可还原，避免污染后续根着法。
const extractPvFromTt = (board, turn, boardHash, maxPly) => {
  const sequence = [];
  const undoMoves = [];
  let currentTurn = turn;
  let hash = boardHash;
  const plyLimit = Math.max(0, maxPly | 0);
  for (let ply = 0; ply < plyLimit; ply++) {
    const entry = transpositionTable.retrieve(zobristHasher.ttKeyFromHash(hash, currentTurn));
    const move = entry && entry.bestMove;
    if (!move) break;
    const encoded = isEncodedMove(move) ? move : encodeMove(move.from, move.to);
    const state = activePieceStateFor(board);
    const from = encoded >>> 7;
    const moverCode = state ? state.squareCodes[from] : 0;
    const capturedCode = state ? state.squareCodes[encoded & MOVE_TO_MASK] : 0;
    if (!moverCode || ((moverCode < 8) !== (currentTurn === 'red'))) break;
    makeSearchMove(board, encoded);
    if (leavesOwnKingUnsafe(state, currentTurn, from, encoded & MOVE_TO_MASK, true)) {
      unmakeSearchMove(board, encoded);
      break;
    }
    sequence.push(encoded);
    undoMoves.push(encoded);
    hash = childBoardHash(hash, encoded, moverCode, capturedCode);
    currentTurn = currentTurn === 'red' ? 'black' : 'red';
  }
  for (let i = undoMoves.length - 1; i >= 0; i--) {
    unmakeSearchMove(board, undoMoves[i]);
  }
  return sequence;
};

const scratchRootThreatenedSquares = [];
const scratchRootCanCaptureSquares = [];
const scratchRootCheckerSquares = [];
const scratchRootCheckInfo = createCheckInfo();
const scratchRootSortInfo = {
    redIsInCheck: false,
    blackIsInCheck: false,
    threatenedSquares: scratchRootThreatenedSquares,
    canCaptureSquares: scratchRootCanCaptureSquares,
    checkerSquares: scratchRootCheckerSquares
};

const fillRootSortHints = (pieceState, turn) => {
    scratchRootThreatenedSquares.length = 0;
    scratchRootCanCaptureSquares.length = 0;
    scratchRootCheckerSquares.length = 0;
    const inCheck = isCheckFromState(pieceState, turn);
    scratchRootSortInfo.redIsInCheck = turn === 'red' && inCheck;
    scratchRootSortInfo.blackIsInCheck = turn === 'black' && inCheck;
    if (inCheck) {
        collectCheckersFromState(pieceState, turn, scratchRootCheckInfo);
        const n = Math.min(scratchRootCheckInfo.count, CHECK_INFO_CAP);
        for (let i = 0; i < n; i++) {
            const sq = scratchRootCheckInfo.sq[i];
            if (sq >= 0) scratchRootCheckerSquares.push(sq);
        }
        return scratchRootSortInfo;
    }
    const aliveMask = (pieceState.redAliveMask | pieceState.blackAliveMask) >>> 0;
    calculatePackedSearchLeafRelationsNumeric(pieceState, aliveMask, null);
    const attackBySlot = scratchLeafAttackBySlot;
    const guardBySlot = scratchLeafGuardBySlot;
    const pieceCodes = pieceState.pieceCodes;
    const pieceSquares = pieceState.pieceSquares;
    const turnIsRed = turn === 'red';
    const slotCount = pieceState.slotCount;
    for (let slot = 0; slot < slotCount; slot++) {
        const attackers = attackBySlot[slot] >>> 0;
        if (!attackers) continue;
        const targetCode = pieceCodes[slot];
        if ((targetCode & 7) === 1) continue;
        if (guardBySlot[slot]) continue;
        const firstSlot = 31 - Math.clz32(attackers & -attackers);
        const firstIsRed = pieceCodes[firstSlot] < 8;
        if (firstIsRed === turnIsRed) {
            scratchRootCanCaptureSquares.push(pieceSquares[slot]);
        } else if ((targetCode < 8) === turnIsRed) {
            scratchRootThreatenedSquares.push(pieceSquares[slot]);
        }
    }
    return scratchRootSortInfo;
};

// exactRootScores: true=Analysis 根着法精确分（数量由 exactRootLimit 限制，0=不限制）；false=对弈标准 PVS（fail-low 不回搜）
const getBestMove = (
  board,
  turn,
  depth = 8,
  ply = 0,
  exactRootScores = false,
  excludedRootMoves = []
) => {
  const excludedRootMoveSet = new Set(
    excludedRootMoves
      .filter((move) => move?.from && move?.to)
      .map((move) => encodeMove(move.from, move.to))
  );

  const searchBoard = {};
  const phase = getGamePhase();
  const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
  activeSearchPieceState = createSearchPieceState(board, gameStage);
  if (activeSearchPieceState) activeSearchPieceState.board = searchBoard;
  const rootPieceState = activeSearchPieceState;
  try {
  const bookMove = openingBook.getBookMoveFromState(rootPieceState, ply);
  if (bookMove && bookMove.from && bookMove.to &&
      typeof bookMove.from.r === 'number' && typeof bookMove.from.c === 'number' &&
      typeof bookMove.to.r === 'number' && typeof bookMove.to.c === 'number') {
    const fromSq = bookMove.from.r * 9 + bookMove.from.c;
    const toSq = bookMove.to.r * 9 + bookMove.to.c;
    const moverCode = rootPieceState.squareCodes[fromSq];
    const encodedBook = (fromSq << 7) | toSq;
    if (moverCode && ((moverCode < 8) === (turn === 'red')) &&
        !excludedRootMoveSet.has(encodedBook)) {
      const validDestinations = getValidMovesFromSq(searchBoard, fromSq);
      if (validDestinations.some((dest) => dest === toSq)) {
        resetPerfStats();
        return {
          bestMove: encodedBook,
          secondBestMove: null,
          moveSequence: [],
          secondMoveSequence: [],
          bestMoveScore: 0,
          secondBestMoveScore: 0,
          allMovesWithScores: [],
          completedDepth: 0,
          fromBook: true,
          thinkingTime: 0
        };
      }
    }
  }

  // 根节点：迭代加深 + PVS；TT/killer/history 跨深度保留（仅开局清空一次）
  resetPerfStats();
  snapshotLeafWeights();
  const startTime = Date.now();
  if (typeof searchContext.reportSearchProgress === 'function') {
    try {
      searchContext.reportSearchProgress({
        phase: 'root-eval',
        turn,
        maxDepth: Math.max(1, depth | 0),
        completedDepth: -1,
        elapsedMs: 0
      });
    } catch (_) { /* ignore */ }
  }
  transpositionTable.resetStats();
  const ttReuseScope = searchContext.ttReuseScope == null
    ? null
    : [
        searchContext.ttReuseScope,
        turn,
        exactRootScores ? 'analysis' : 'play',
        gameStage,
        VALUE_WEIGHTS.material,
        VALUE_WEIGHTS.position,
        VALUE_WEIGHTS.threat,
        VALUE_WEIGHTS.safety,
        VALUE_WEIGHTS.mobility
      ].join(':');
  transpositionTable.beginSearch(
    true,
    searchContext.ttMaxAge,
    ttReuseScope,
    searchContext.ttSearchPly
  );
  clearEvalCache();
  const maxDepth = Math.max(1, depth | 0);
  resetSearchHeuristics(maxDepth);
  syncGeneralPosCache(board);
  const rootBoardInfo = fillRootSortHints(rootPieceState, turn);

  // 收集根节点走法（只做一次）：编码整数 + 平行分数/PV
  const rootMoves = [];
  const rootScores = [];
  const rootSeqs = [];

  const wantRed = turn === 'red';
  for (let scanRow = 0; scanRow < ROWS; scanRow++) {
    const r = turn === 'black'
      ? ROWS - 1 - scanRow
      : scanRow;
    for (let c = 0; c < COLS; c++) {
      const fromSq = r * 9 + c;
      const code = rootPieceState.squareCodes[fromSq];
      if (!code || (code < 8) !== wantRed) continue;
      const validDestinations = getValidMovesFromSq(searchBoard, fromSq);
      for (let di = 0; di < validDestinations.length; di++) {
        const encoded = (fromSq << 7) | validDestinations[di];
        if (excludedRootMoveSet.has(encoded)) continue;
        rootMoves.push(encoded);
        rootScores.push(0);
        rootSeqs.push(null);
      }
    }
  }

  if (rootMoves.length === 0) {
    return {
      bestMove: null,
      secondBestMove: null,
      moveSequence: [],
      secondMoveSequence: [],
      bestMoveScore: 0,
      secondBestMoveScore: 0,
      allMovesWithScores: []
    };
  }

  const emitSearchProgress = (info) => {
    if (typeof searchContext.reportSearchProgress !== 'function') return;
    try {
      searchContext.reportSearchProgress({
        turn,
        maxDepth,
        rootMoves: rootMoves.length,
        elapsedMs: Date.now() - startTime,
        ...info
      });
    } catch (_) {
      /* debug sink must never break search */
    }
  };
  emitSearchProgress({ phase: 'start', completedDepth: 0 });

  const sortRootMovesByScore = () => {
    const n = rootMoves.length;
    for (let i = 1; i < n; i++) {
      const move = rootMoves[i];
      const score = rootScores[i];
      const seq = rootSeqs[i];
      const seqLen = seq ? seq.length : 0;
      let j = i - 1;
      while (j >= 0) {
        const scoreDiff = rootScores[j] - score;
        let shouldShift = scoreDiff < 0;
        if (scoreDiff === 0) {
          const otherLen = rootSeqs[j] ? rootSeqs[j].length : 0;
          if (score > 0) shouldShift = otherLen > seqLen;
          else if (score < 0) shouldShift = otherLen < seqLen;
          else shouldShift = false;
        }
        if (!shouldShift) break;
        rootMoves[j + 1] = rootMoves[j];
        rootScores[j + 1] = rootScores[j];
        rootSeqs[j + 1] = rootSeqs[j];
        j--;
      }
      rootMoves[j + 1] = move;
      rootScores[j + 1] = score;
      rootSeqs[j + 1] = seq;
    }
  };

  const promoteRootMove = (preferred) => {
    if (!preferred) return;
    let idx = -1;
    for (let i = 0; i < rootMoves.length; i++) {
      if (isSameMove(rootMoves[i], preferred)) {
        idx = i;
        break;
      }
    }
    if (idx <= 0) return;
    const move = rootMoves[idx];
    const score = rootScores[idx];
    const seq = rootSeqs[idx];
    for (let i = idx; i > 0; i--) {
      rootMoves[i] = rootMoves[i - 1];
      rootScores[i] = rootScores[i - 1];
      rootSeqs[i] = rootSeqs[i - 1];
    }
    rootMoves[0] = move;
    rootScores[0] = score;
    rootSeqs[0] = seq;
  };

  const nextTurn = turn === 'red' ? 'black' : 'red';
  // 根局面哈希只算一次；增量模式整棵搜索树由此派生
  const rootHash = zobristHasher.hashFromSquareCodes(rootPieceState.squareCodes);
  const rootTTKey = zobristHasher.ttKeyFromHash(rootHash, turn);

  let completedDepth = 0;

  for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
    emitSearchProgress({
      phase: 'iterating',
      completedDepth,
      currentDepth
    });

    // 浅层最佳着 + TT 着排到最前，供本层 PVS 第一着全窗使用
    const ttEntry = transpositionTable.retrieve(rootTTKey);
    const ttMove = ttEntry && ttEntry.bestMove ? ttEntry.bestMove : null;
    const prevBest = rootMoves[0];
    sortMovesFast(rootMoves, searchBoard, turn, null, gameStage, rootBoardInfo, ttMove, null, null, [rootScores, rootSeqs]);
    // 上一层最佳着放第一（最后 promote），保证本层 PVS 首着全窗命中热路径
    promoteRootMove(ttMove);
    promoteRootMove(prevBest);

    const useExactRoot = exactRootScores && currentDepth === maxDepth;
    const collectRootPv = useExactRoot;
    const exactRootLimit = searchContext.exactRootLimit | 0;
    let rootAlpha = -Infinity;

    for (let i = 0; i < rootMoves.length; i++) {
      const encodedRootMove = rootMoves[i];
      const rootFromSq = encodedRootMove >>> 7;
      const rootToSq = encodedRootMove & MOVE_TO_MASK;
      const moverCode = activeSearchPieceState.squareCodes[rootFromSq];
      const capturedCode = activeSearchPieceState.squareCodes[rootToSq];
      makeSearchMove(searchBoard, encodedRootMove);
      const childHash = childBoardHash(rootHash, encodedRootMove, moverCode, capturedCode);
      const childInCheck = probeMoveGivesCheck(
        activeSearchPieceState, nextTurn, rootFromSq, rootToSq
      );

      let score;
      let scoreIsExact = true;
      const remaining = currentDepth - 1;
      const exactThisMove = useExactRoot && (exactRootLimit <= 0 || i < exactRootLimit);
      const childTTKey = makeSearchTTKey(searchBoard, nextTurn, childHash);
      // TT 值为整数，只采用 ≤α 的 exact，避免截断后误超当前最优
      const exactFromTt = () => {
        const entry = transpositionTable.retrieve(childTTKey);
        if (!entry || entry.flag !== 'exact' || entry.depth < remaining) return null;
        if (entry.value > rootAlpha) return null;
        return entry.value;
      };
      if (i === 0 || rootAlpha === -Infinity) {
        score = alphaBeta(
          searchBoard, remaining, -Infinity, Infinity,
          false, nextTurn, currentDepth, turn, gameStage, childHash, true, childInCheck
        );
      } else {
        const cachedExact = exactThisMove ? exactFromTt() : null;
        if (cachedExact != null) {
          score = cachedExact;
        } else {
          const probe = alphaBeta(
            searchBoard, remaining,
            rootAlpha, rootAlpha + NULL_WINDOW,
            false, nextTurn, currentDepth, turn, gameStage, childHash, true, childInCheck
          );
          if (probe > rootAlpha) {
            score = alphaBeta(
              searchBoard, remaining, rootAlpha, Infinity,
              false, nextTurn, currentDepth, turn, gameStage, childHash, true, childInCheck
            );
          } else if (exactThisMove) {
            const afterProbe = exactFromTt();
            if (afterProbe != null) {
              score = afterProbe;
            } else {
              // 已 fail-low，精确分 ≤ α；用紧 β 回搜，不再开 (+∞)
              score = alphaBeta(
                searchBoard, remaining, -Infinity, rootAlpha + NULL_WINDOW,
                false, nextTurn, currentDepth, turn, gameStage, childHash, true, childInCheck
              );
              if (score > rootAlpha) {
                // NMP/TT 下紧窗可能不稳定 fail-high，不当更好着
                score = probe;
              }
            }
          } else {
            // fail-low：探测分只是上界，不能当精确分写入（否则 ID 下层排序被污染，易反复走炮）
            score = probe;
            scoreIsExact = false;
          }
        }
      }

      if (collectRootPv) {
        rootSeqs[i] = [
          encodedRootMove,
          ...extractPvFromTt(searchBoard, nextTurn, childHash, currentDepth - 1)
        ];
      }

      unmakeSearchMove(searchBoard, encodedRootMove);

      if (scoreIsExact) {
        rootScores[i] = score;
        if (score > rootAlpha) {
          rootAlpha = score;
        }
      } else if (rootScores[i] > rootAlpha) {
        // 保留上一层分数；若仍高于当前 α（异常），略降以免挤掉真最优
        rootScores[i] = rootAlpha - 1e-3;
      }
    }

    sortRootMovesByScore();
    completedDepth = currentDepth;
    emitSearchProgress({
      phase: 'depth',
      completedDepth: currentDepth,
      bestMove: rootMoves[0] || null,
      score: rootMoves[0] != null ? rootScores[0] : 0
    });

    // 把本层最佳着写入 TT，供更深一层根排序
    transpositionTable.store(
      rootTTKey,
      currentDepth,
      rootScores[0],
      'exact',
      rootMoves[0]
    );

  }

  const bestMove = rootMoves.length ? rootMoves[0] : null;
  const secondBestMove = rootMoves.length > 1 ? rootMoves[1] : null;
  const bestMoveSequence = bestMove != null ? (rootSeqs[0] || []) : [];
  const secondMoveSequence = secondBestMove != null ? (rootSeqs[1] || []) : [];
  const bestMoveScore = bestMove != null ? rootScores[0] : 0;
  const secondBestMoveScore = secondBestMove != null ? rootScores[1] : 0;

  const allMovesWithScores = rootMoves.map((move, index) => ({
    move,
    score: rootScores[index],
    moveSequence: rootSeqs[index] || []
  }));

  const result = {
    bestMove,
    secondBestMove,
    moveSequence: bestMoveSequence,
    secondMoveSequence,
    bestMoveScore,
    secondBestMoveScore,
    allMovesWithScores,
    completedDepth,
    fromBook: false,
    thinkingTime: Date.now() - startTime
  };
  return result;
  } finally {
    activeSearchPieceState = null;
  }
};

const searchTestApi = {
  collectPackedCaptures(board, capturePlayer) {
    return runWithPieceState(board, () =>
      generateQuiescenceMoves(board, capturePlayer, true, []).slice()
    );
  },
  collectCheckers(board, color) {
    return runWithPieceState(board, () => {
      const state = activePieceStateFor(board);
      if (!state) return { count: 0 };
      const info = createCheckInfo();
      collectCheckersFromState(state, color, info);
      return {
        count: info.count,
        sq: info.sq.slice(0, Math.min(info.count, CHECK_INFO_CAP)),
        kind: info.kind.slice(0, Math.min(info.count, CHECK_INFO_CAP)),
        leg: info.leg.slice(0, Math.min(info.count, CHECK_INFO_CAP)),
        generalSq: color === 'red' ? state.redGeneralSq : state.blackGeneralSq
      };
    });
  },
  generatedEvasions(board, color) {
    return runWithPieceState(board, () => {
      const state = activePieceStateFor(board);
      if (!state) return [];
      const info = createCheckInfo();
      collectCheckersFromState(state, color, info);
      const moves = [];
      generateCheckEvasions(moves, color, state, info);
      return moves.slice();
    });
  },
  legalEvasions(board, color) {
    return runWithPieceState(board, () => {
      const state = activePieceStateFor(board);
      if (!state) return [];
      const info = createCheckInfo();
      collectCheckersFromState(state, color, info);
      if (info.count <= 0) return [];
      const moves = [];
      generateCheckEvasions(moves, color, state, info);
      const legal = [];
      for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        makeSearchMove(board, move);
        const unsafe = leavesOwnKingUnsafe(state, color, move >>> 7, move & MOVE_TO_MASK, true, info);
        unmakeSearchMove(board, move);
        if (!unsafe) legal.push(move);
      }
      return legal;
    });
  },
  allLegalMoves(board, color) {
    return runWithPieceState(board, () => {
      const legal = [];
      const state = activePieceStateFor(board);
      const wantRed = color === 'red';
      for (let fromSq = 0; fromSq < REL_SQUARES; fromSq++) {
        const code = state.squareCodes[fromSq];
        if (!code || (code < 8) !== wantRed) continue;
        const dests = getValidMovesFromSq(board, fromSq);
        for (let i = 0; i < dests.length; i++) {
          legal.push((fromSq << 7) | dests[i]);
        }
      }
      return legal;
    });
  },
  hashConsistency(board) {
    return runWithPieceState(board, () => {
      const state = activePieceStateFor(board);
      const objectHash = zobristHasher.hash(board);
      const codeHash = zobristHasher.hashFromSquareCodes(state.squareCodes);
      const mirroredBoard = zobristHasher.mirrorBoard(board);
      const mirroredObject = zobristHasher.hash(mirroredBoard);
      const mirroredCodes = zobristHasher.hashMirroredFromSquareCodes(state.squareCodes);
      const bookObject = openingBook.hasher.hash(board);
      const bookCodes = openingBook.hasher.hashFromSquareCodes(state.squareCodes);
      const bookMirroredObject = openingBook.hasher.hash(mirroredBoard);
      const bookMirroredCodes = openingBook.hasher.hashMirroredFromSquareCodes(state.squareCodes);
      return {
        objectHash,
        codeHash,
        match: objectHash === codeHash,
        mirroredObject,
        mirroredCodes,
        mirroredMatch: mirroredObject === mirroredCodes,
        bookMatch: bookObject === bookCodes,
        bookMirroredMatch: bookMirroredObject === bookMirroredCodes
      };
    });
  },
  givesCheckMatches(board, color, move) {
    return runWithPieceState(board, () => {
      const state = activePieceStateFor(board);
      if (!state) return false;
      const fromSq = move >>> 7;
      const toSq = move & MOVE_TO_MASK;
      const moverCode = state.squareCodes[fromSq];
      if (!moverCode) return false;
      makeSearchMove(board, move);
      const got = moveGivesCheck(state, color);
      const expect = isCheckFromState(state, color === 'red' ? 'black' : 'red');
      unmakeSearchMove(board, move);
      return got === expect;
    });
  }
};

export {
  checkGameState,
  evaluateBoard,
  evaluateBoardForUi,
  getBestMove,
  getGamePhase,
  getValidMoves,
  hydrateRelationsFromMasks,
  isCheck,
  isValidPlacement,
  logPerfStats,
  openingBook,
  searchTestApi,
  snapshotPerfStats,
  syncGeneralPosCache
};


