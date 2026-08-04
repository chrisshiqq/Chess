/* eslint-disable no-restricted-globals */

// 棋盘常量定义
const ROWS = 10;
const COLS = 9;

// 棋子类型定义
const PIECE_TYPES = {
    GENERAL: 'general',
    CHARIOT: 'chariot',
    CANNON: 'cannon',
    HORSE: 'horse',
    ELEPHANT: 'elephant',
    ADVISOR: 'advisor',
    SOLDIER: 'soldier'
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

// 棋子价值权重配置
let VALUE_WEIGHTS = {
    //material: 0.4,   // 材料值权重
    //position: 0.2,   // 位置值权重
    //threat: 0.15,    // 威胁值权重
    //tactic: 0.1,     // 战术值权重
    //safety: 0.1,     // 安全值权重
    //mobility: 0.05   // 机动值权重

    material: 1,    // 材料值权重
    position: 1,    // 位置值权重
    threat: 1,     // 威胁值权重
    tactic: 1,      // 战术值权重
    safety: 1,      // 安全值权重
    mobility: 1     // 机动值权重
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
        [0, 10, 5, 5, 5, 5, 10, 5, 0]
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
// true=搜索叶用攻击位图（默认）；false=叶评估仍建 10×9 控制者表（A/B）
// true=关系用格位 Uint32 攻/守/控 mask（默认）；false=threat/guard 对象列表（A/B）
// Packed destinations/rays and inlined relation writes for search leaves.
// Kept separate from the original specialized path for benchmark verification.
// 搜索期间维护紧凑棋子表，避免叶评估/着法准备反复扫描 10x9 对象棋盘（A/B 可关闭）
// 静默搜索吃子生成复用搜索态棋子表；独立开关用于 A/B。
// 仅基准诊断开启：额外 performance.now 会影响绝对耗时，正式对弈保持关闭。
let SEARCH_PROFILE = false;

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
const REL_SQUARES = 90;
// 格号 → 行列：避免热路径反复 (sq/9)|0 与 sq%9
const SQ_ROW = new Uint8Array(REL_SQUARES);
const SQ_COL = new Uint8Array(REL_SQUARES);
for (let __sq = 0; __sq < REL_SQUARES; __sq++) {
    SQ_ROW[__sq] = (__sq / 9) | 0;
    SQ_COL[__sq] = __sq % 9;
}
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

const scratchLeafPiecesInfo = [];
const scratchLeafPieceSlots = Array.from({ length: 32 }, (_, pieceIndex) => ({
    piece: null,
    pieceCode: 0,
    r: 0,
    c: 0,
    sq: 0,
    pieceIndex,
    moves: [],
    allyGuards: [],
    materialValue: 0,
    positionValue: 0,
    threatValue: 0,
    safetyValue: 0,
    tacticValue: 0,
    mobilityValue: 0,
    threat: [],
    threatenedBy: [],
    guard: [],
    guardedBy: [],
    control: [],
    protect: []
}));

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

const SEARCH_MATERIAL_VALUES = {
    early: new Int16Array([0, 10000, 900, 400, 200, 200, 450, 100]),
    mid: new Int16Array([0, 10000, 900, 450, 200, 200, 400, 200]),
    late: new Int16Array([0, 10000, 900, 450, 200, 200, 400, 450])
};

const searchMaterialTable = (gameStage) => SEARCH_MATERIAL_VALUES[gameStage] || SEARCH_MATERIAL_VALUES.mid;

const createSearchPieceState = (board, gameStage = 'mid') => {
    const records = [];
    const squareToSlot = new Int8Array(REL_SQUARES);
    const squareCodes = new Uint8Array(REL_SQUARES);
    const pieceCodes = new Uint8Array(32);
    const materialValues = searchMaterialTable(gameStage);
    let redMaterial = 0;
    let redPosition = 0;
    let blackMaterial = 0;
    let blackPosition = 0;
    let redGeneralSq = -1;
    let blackGeneralSq = -1;
    squareToSlot.fill(-1);
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece) continue;
            if (records.length >= 32) return null;
            const slot = records.length;
            records.push({ piece, r, c, sq: r * 9 + c, alive: true });
            const code = searchPieceCode(piece);
            if ((code & 7) === 1) {
                if (code < 8) redGeneralSq = r * 9 + c;
                else blackGeneralSq = r * 9 + c;
            }
            pieceCodes[slot] = code;
            squareToSlot[r * 9 + c] = slot;
            squareCodes[r * 9 + c] = code;
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
        board,
        records,
        squareToSlot,
        squareCodes,
        pieceCodes,
        materialValues,
        redMaterial,
        redPosition,
        blackMaterial,
        blackPosition,
        redGeneralSq,
        blackGeneralSq,
        moverStack: new Int8Array(32),
        capturedStack: new Int8Array(32),
        stackDepth: 0
    };
};

const activePieceStateFor = (board) => {
    const state = activeSearchPieceState;
    return state && state.board === board ? state : null;
};

const updatePieceStateAfterMake = (board, fromSq, toSq) => {
    const state = activePieceStateFor(board);
    if (!state) return;
    const moverSlot = state.squareToSlot[fromSq];
    const capturedSlot = state.squareToSlot[toSq];
    const stackIndex = state.stackDepth++;
    state.moverStack[stackIndex] = moverSlot;
    state.capturedStack[stackIndex] = capturedSlot;
    if (moverSlot < 0) return;

    const mover = state.records[moverSlot];
    const moverCode = state.pieceCodes[moverSlot];
    const moverPositionDelta = SEARCH_POSITION_VALUES[moverCode][toSq] -
        SEARCH_POSITION_VALUES[moverCode][fromSq];
    if (moverCode < 8) state.redPosition += moverPositionDelta;
    else state.blackPosition += moverPositionDelta;
    if (capturedSlot >= 0) {
        const capturedCode = state.pieceCodes[capturedSlot];
        const capturedMaterial = state.materialValues[capturedCode & 7];
        const capturedPosition = SEARCH_POSITION_VALUES[capturedCode][toSq];
        if (capturedCode < 8) {
            state.redMaterial -= capturedMaterial;
            state.redPosition -= capturedPosition;
        } else {
            state.blackMaterial -= capturedMaterial;
            state.blackPosition -= capturedPosition;
        }
    }
    mover.sq = toSq;
    mover.r = SQ_ROW[toSq];
    mover.c = SQ_COL[toSq];
    state.squareToSlot[fromSq] = -1;
    state.squareToSlot[toSq] = moverSlot;
    state.squareCodes[fromSq] = 0;
    state.squareCodes[toSq] = state.pieceCodes[moverSlot];
    if ((moverCode & 7) === 1) {
        if (moverCode < 8) state.redGeneralSq = toSq;
        else state.blackGeneralSq = toSq;
    }
    if (capturedSlot >= 0 && (state.pieceCodes[capturedSlot] & 7) === 1) {
        if (state.pieceCodes[capturedSlot] < 8) state.redGeneralSq = -1;
        else state.blackGeneralSq = -1;
    }
    if (capturedSlot >= 0) state.records[capturedSlot].alive = false;
};

const updatePieceStateAfterUnmake = (board, fromSq, toSq) => {
    const state = activePieceStateFor(board);
    if (!state) return;
    const stackIndex = --state.stackDepth;
    const moverSlot = state.moverStack[stackIndex];
    const capturedSlot = state.capturedStack[stackIndex];
    if (moverSlot < 0) return;

    const mover = state.records[moverSlot];
    const moverCode = state.pieceCodes[moverSlot];
    const moverPositionDelta = SEARCH_POSITION_VALUES[moverCode][fromSq] -
        SEARCH_POSITION_VALUES[moverCode][toSq];
    if (moverCode < 8) state.redPosition += moverPositionDelta;
    else state.blackPosition += moverPositionDelta;
    if (capturedSlot >= 0) {
        const capturedCode = state.pieceCodes[capturedSlot];
        const capturedMaterial = state.materialValues[capturedCode & 7];
        const capturedPosition = SEARCH_POSITION_VALUES[capturedCode][toSq];
        if (capturedCode < 8) {
            state.redMaterial += capturedMaterial;
            state.redPosition += capturedPosition;
        } else {
            state.blackMaterial += capturedMaterial;
            state.blackPosition += capturedPosition;
        }
    }
    mover.sq = fromSq;
    mover.r = SQ_ROW[fromSq];
    mover.c = SQ_COL[fromSq];
    state.squareToSlot[fromSq] = moverSlot;
    state.squareToSlot[toSq] = capturedSlot;
    state.squareCodes[fromSq] = state.pieceCodes[moverSlot];
    state.squareCodes[toSq] = capturedSlot >= 0 ? state.pieceCodes[capturedSlot] : 0;
    if ((moverCode & 7) === 1) {
        if (moverCode < 8) state.redGeneralSq = fromSq;
        else state.blackGeneralSq = fromSq;
    }
    if (capturedSlot >= 0 && (state.pieceCodes[capturedSlot] & 7) === 1) {
        if (state.pieceCodes[capturedSlot] < 8) state.redGeneralSq = toSq;
        else state.blackGeneralSq = toSq;
    }
    if (capturedSlot >= 0) state.records[capturedSlot].alive = true;
};

const lowestSetBitIndex = (mask) => 31 - Math.clz32(mask & -mask);

const forEachSetBit = (mask, fn) => {
    let m = mask >>> 0;
    while (m !== 0) {
        const bit = m & -m;
        fn(31 - Math.clz32(bit));
        m ^= bit;
    }
};

// 主评估函数 - 详细评估棋盘局势（UI / 点棋关系 / 搜索叶 / 根节点）
// options.forSearchLeaf: 仅跳过终局 getValidMoves（无着已在父节点处理）；可用攻击位图代替控制者表
const evaluateBoard = (board, currentPlayer = null, gameStage = 'mid', options = null) => {
    const __t0 = SEARCH_PROFILE ? performance.now() : 0;
    // 统计
    if (currentPlayer) {
        perfStats.evaluateBoardCount[currentPlayer]++;
    }
    const forSearchLeaf = !!(options && options.forSearchLeaf);

    const outputPhase = gameStage;

    // 遍历棋盘：只收集子力/PST；着法+关系统一在 calculatePieceRelations 一次几何生成（对齐炮）
    let piecesInfo = [];
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
                tacticValue: 0,
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
    const useAttackBits = false;
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
    } else if (useAttackBits) {
        clearAttackBits(scratchRedAttack);
        clearAttackBits(scratchBlackAttack);
        boardInfo = {
            useAttackBits: true,
            redAttack: scratchRedAttack,
            blackAttack: scratchBlackAttack
        };
    } else {
        boardInfo = makeEmptyControllerGrid();
    }
    calculateDerivedValues(board, piecesInfo, currentPlayer, boardInfo, forSearchLeaf);
    
    // 第三步：计算总分（只计算剩余分数，基础分数已在棋盘遍历时计算）
    let redThreat = 0, redTactic = 0, redSafety = 0, redMobility = 0;
    let blackThreat = 0, blackTactic = 0, blackSafety = 0, blackMobility = 0;
    
    for (const info of piecesInfo) {
        const { piece, threatValue, tacticValue, safetyValue, mobilityValue } = info;
        
        if (piece.color === 'red') {
            redThreat += threatValue;
            redTactic += tacticValue;
            redSafety += safetyValue;
            redMobility += mobilityValue;
        } else {
            blackThreat += threatValue;
            blackTactic += tacticValue;
            blackSafety += safetyValue;
            blackMobility += mobilityValue;
        }
    }
    
    // 计算局势总分
    const redTotal = 
        redMaterial * VALUE_WEIGHTS.material +
        redPosition * VALUE_WEIGHTS.position +
        redThreat * VALUE_WEIGHTS.threat +
        redTactic * VALUE_WEIGHTS.tactic +
        redSafety * VALUE_WEIGHTS.safety +
        redMobility * VALUE_WEIGHTS.mobility; 
    
    const blackTotal = 
        blackMaterial * VALUE_WEIGHTS.material +
        blackPosition * VALUE_WEIGHTS.position +
        blackThreat * VALUE_WEIGHTS.threat +
        blackTactic * VALUE_WEIGHTS.tactic +
        blackSafety * VALUE_WEIGHTS.safety +
        blackMobility * VALUE_WEIGHTS.mobility;
    
    // 返回详细评估结果
    const __evalResult = {
        red: {
            total: redTotal,
            material: redMaterial * VALUE_WEIGHTS.material,
            position: redPosition * VALUE_WEIGHTS.position,
            threat: redThreat * VALUE_WEIGHTS.threat,
            tactic: redTactic * VALUE_WEIGHTS.tactic,
            safety: redSafety * VALUE_WEIGHTS.safety,
            mobility: redMobility * VALUE_WEIGHTS.mobility,
            phase: outputPhase,
            weights: {
                material: 0.4,
                position: 0.2,
                tactic: 0.1,
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
            tactic: blackTactic * VALUE_WEIGHTS.tactic,
            safety: blackSafety * VALUE_WEIGHTS.safety,
            mobility: blackMobility * VALUE_WEIGHTS.mobility,
            phase: outputPhase,
            weights: {
                material: 0.4,
                position: 0.2,
                tactic: 0.1,
                safety: 0.1,
                mobility: 0.05,
                threat: 0.15
            }
        },
        piecesInfo: piecesInfo,
        gameStage: gameStage,
        boardInfo: boardInfo
    };
    if (SEARCH_PROFILE) {
        perfStats.evaluateBoardMs += performance.now() - __t0;
    }
    return __evalResult;
};

// 将/帅位置缓存：供 post-move isCheck / 飞将快速查询，由 make/unmake 维护
let generalPosCache = { red: null, black: null };

// 将帅仅在九宫内，按九宫扫描即可
const findGeneralPos = (board, color) => {
    const rowStart = color === 'red' ? 0 : 7;
    const rowEnd = color === 'red' ? 2 : 9;
    for (let r = rowStart; r <= rowEnd; r++) {
        for (let c = 3; c <= 5; c++) {
            const p = board[r][c];
            if (p && p.type === 'general' && p.color === color) {
                return { r, c };
            }
        }
    }
    return null;
};

const syncGeneralPosCache = (board) => {
    generalPosCache.red = findGeneralPos(board, 'red');
    generalPosCache.black = findGeneralPos(board, 'black');
};

const getGeneralPos = (board, color) => {
    const cached = generalPosCache[color];
    if (cached) {
        const p = board[cached.r]?.[cached.c];
        if (p && p.type === 'general' && p.color === color) {
            return cached;
        }
    }
    const pos = findGeneralPos(board, color);
    generalPosCache[color] = pos;
    return pos;
};

// 搜索用原地走子 / 恢复（避免每次递归 board.map）；同步维护将位缓存
const makeMove = (board, from, to) => {
    const piece = board[from.r][from.c];
    const captured = board[to.r][to.c];
    board[to.r][to.c] = piece;
    board[from.r][from.c] = null;
    updatePieceStateAfterMake(board, from.r * 9 + from.c, to.r * 9 + to.c);
    if (piece && piece.type === 'general') {
        generalPosCache[piece.color] = { r: to.r, c: to.c };
    }
    if (captured && captured.type === 'general') {
        generalPosCache[captured.color] = null;
    }
    return captured;
};

const unmakeMove = (board, from, to, captured) => {
    const piece = board[to.r][to.c];
    board[from.r][from.c] = piece;
    board[to.r][to.c] = captured;
    updatePieceStateAfterUnmake(board, from.r * 9 + from.c, to.r * 9 + to.c);
    if (piece && piece.type === 'general') {
        generalPosCache[piece.color] = { r: from.r, c: from.c };
    }
    if (captured && captured.type === 'general') {
        generalPosCache[captured.color] = { r: to.r, c: to.c };
    }
};

// 仅普通节点使用：父局面安全且起终点不影响将线或敌马依赖格时，走子后仍必然安全。
const kingSafetyIsUnchangedByMove = (state, color, move, wasInCheck) => {
    if (!SEARCH_ENABLE_KING_SAFETY_FAST_PATH || wasInCheck || !state || move == null) return false;
    const fromSq = moveFromSq(move);
    const toSq = moveToSq(move);
    const generalSq = color === 'red' ? state.redGeneralSq : state.blackGeneralSq;
    if (generalSq < 0 || generalSq === toSq) return false;

    const generalRow = SEARCH_SQ_ROWS[generalSq];
    const generalCol = SEARCH_SQ_COLS[generalSq];
    if (
        SEARCH_SQ_ROWS[fromSq] === generalRow ||
        SEARCH_SQ_COLS[fromSq] === generalCol ||
        SEARCH_SQ_ROWS[toSq] === generalRow ||
        SEARCH_SQ_COLS[toSq] === generalCol
    ) {
        return false;
    }

    const horseCheckers = SEARCH_HORSE_CHECKERS[generalSq];
    for (let i = 0; i < horseCheckers.length; i++) {
        const entry = horseCheckers[i];
        const legSq = entry >>> 7;
        const horseSq = entry & MOVE_TO_MASK;
        if (fromSq === legSq || toSq === legSq || fromSq === horseSq || toSq === horseSq) return false;
    }
    return true;
};

// 走子后是否使己方将不安全（飞将或被将）。调用前须已 makeMove。
const leavesOwnKingUnsafe = (board, color, move = null, wasInCheck = true) => {
    const __t0 = SEARCH_PROFILE ? performance.now() : 0;
    perfStats.legalityChecks++;
    const pieceState = activePieceStateFor(board);
    if (kingSafetyIsUnchangedByMove(pieceState, color, move, wasInCheck)) {
        if (SEARCH_COLLECT_METRICS) perfStats.kingSafetyFastSkips++;
        if (SEARCH_VERIFY_KING_SAFETY_FAST_PATH) {
            const unsafe = pieceState
                ? isCheckRawFromPieceState(pieceState, color)
                : (isFlyingGeneral(board) || isCheckRaw(board, color));
            if (unsafe) {
                if (SEARCH_COLLECT_METRICS) perfStats.kingSafetyVerificationFailures++;
                return true;
            }
        }
        return false;
    }
    if (SEARCH_COLLECT_METRICS) perfStats.kingSafetyFullChecks++;
    const unsafe = pieceState ? isCheckRawFromPieceState(pieceState, color) : (isFlyingGeneral(board) || isCheckRaw(board, color));
    if (SEARCH_PROFILE) perfStats.legalityCheckMs += performance.now() - __t0;
    return unsafe;
};

// 从伪合法着法中过滤出不送将/不飞将的合法着法（UI/根节点/开局库校验）
// 搜索热路径使用延迟合法性（试走时检测），避免对剪枝未触及的着法做全量过滤
const filterLegalMoves = (board, from, piece, pseudoMoves) => {
    const validMoves = [];
    for (const to of pseudoMoves) {
        const captured = makeMove(board, from, to);
        const illegal = leavesOwnKingUnsafe(board, piece.color);
        unmakeMove(board, from, to, captured);
        if (!illegal) validMoves.push(to);
    }
    return validMoves;
};

// Search hot path move encoding: move = (fromSq << 7) | toSq.
const MOVE_TO_MASK = 0x7f;
const encodeMove = (from, to) => ((from.r * 9 + from.c) << 7) | (to.r * 9 + to.c);
const encodeMoveFromCoords = (fr, fc, tr, tc) => ((fr * 9 + fc) << 7) | (tr * 9 + tc);
const isEncodedMove = (move) => typeof move === 'number';
const moveFromSq = (move) => isEncodedMove(move) ? (move >>> 7) : move.from.r * 9 + move.from.c;
const moveToSq = (move) => isEncodedMove(move) ? (move & MOVE_TO_MASK) : move.to.r * 9 + move.to.c;
const moveFromR = (move) => SQ_ROW[moveFromSq(move)];
const moveFromC = (move) => SQ_COL[moveFromSq(move)];
const moveToR = (move) => SQ_ROW[moveToSq(move)];
const moveToC = (move) => SQ_COL[moveToSq(move)];
const moveToObject = (move) => {
    if (!isEncodedMove(move)) return move;
    const from = moveFromSq(move);
    const to = moveToSq(move);
    return {
        from: { r: SQ_ROW[from], c: SQ_COL[from] },
        to: { r: SQ_ROW[to], c: SQ_COL[to] }
    };
};

const makeSearchMove = (board, move) => {
    if (!isEncodedMove(move)) return makeMove(board, move.from, move.to);
    const from = move >>> 7;
    const to = move & MOVE_TO_MASK;
    const fr = SQ_ROW[from], fc = SQ_COL[from];
    const tr = SQ_ROW[to], tc = SQ_COL[to];
    const piece = board[fr][fc];
    const captured = board[tr][tc];
    board[tr][tc] = piece;
    board[fr][fc] = null;
    updatePieceStateAfterMake(board, from, to);
    if (piece && piece.type === 'general') {
        generalPosCache[piece.color] = { r: tr, c: tc };
    }
    if (captured && captured.type === 'general') {
        generalPosCache[captured.color] = null;
    }
    return captured;
};

const unmakeSearchMove = (board, move, captured) => {
    if (!isEncodedMove(move)) {
        unmakeMove(board, move.from, move.to, captured);
        return;
    }
    const from = move >>> 7;
    const to = move & MOVE_TO_MASK;
    const fr = SQ_ROW[from], fc = SQ_COL[from];
    const tr = SQ_ROW[to], tc = SQ_COL[to];
    const piece = board[tr][tc];
    board[fr][fc] = piece;
    board[tr][tc] = captured;
    updatePieceStateAfterUnmake(board, from, to);
    if (piece && piece.type === 'general') {
        generalPosCache[piece.color] = { r: fr, c: fc };
    }
    if (captured && captured.type === 'general') {
        generalPosCache[captured.color] = { r: tr, c: tc };
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

const sortMovesFast = (moves, board, currentPlayer, piecesInfo, gameStage = 'mid', boardInfo = null, searchHeuristics = null) => {
    const __t0 = SEARCH_PROFILE ? performance.now() : 0;
    if (SEARCH_PROFILE) perfStats.sortMovesCount++;
    const currentIsInCheck = boardInfo
        ? ((currentPlayer === 'red' && boardInfo.redIsInCheck) ||
           (currentPlayer === 'black' && boardInfo.blackIsInCheck))
        : isCheck(board, currentPlayer);

    if (currentIsInCheck && piecesInfo && piecesInfo.length > 0) {
        let generalInfo = null;
        for (let i = 0; i < piecesInfo.length; i++) {
            const info = piecesInfo[i];
            if (info.piece && info.piece.type === 'general' && info.piece.color === currentPlayer) {
                generalInfo = info;
                break;
            }
        }
        if (generalInfo) {
            if (boardInfo && boardInfo.useRelationMasks) {
                let m = boardInfo.attackMask[generalInfo.r * 9 + generalInfo.c] >>> 0;
                while (m !== 0) {
                    const bit = m & -m;
                    const t = piecesInfo[31 - Math.clz32(bit)];
                    if (t && t.piece && t.piece.color !== currentPlayer) {
                        markSortSquare(t.r * 9 + t.c);
                    }
                    m ^= bit;
                }
            } else if (generalInfo.threatenedBy) {
                for (let i = 0; i < generalInfo.threatenedBy.length; i++) {
                    const t = generalInfo.threatenedBy[i];
                    if (t.piece && t.piece.color !== currentPlayer) {
                        markSortSquare(t.r * 9 + t.c);
                    }
                }
            }
        }
    }

    const hasThreatened = !currentIsInCheck && !!(boardInfo && boardInfo.threatenedPieces && boardInfo.threatenedPieces.length > 0);
    if (hasThreatened) {
        for (let i = 0; i < boardInfo.threatenedPieces.length; i++) {
            const p = boardInfo.threatenedPieces[i];
            markSortSquare(p.r * 9 + p.c);
        }
    }
    const threatenedMarkEnd = squareMarkTouched.length;

    const hasCanCapture = !currentIsInCheck && !!(boardInfo && boardInfo.canCapture && boardInfo.canCapture.length > 0);
    if (hasCanCapture) {
        for (let i = 0; i < boardInfo.canCapture.length; i++) {
            const p = boardInfo.canCapture[i];
            markSortSquare(p.r * 9 + p.c);
        }
    }

    const ttMove = searchHeuristics?.ttMove || null;
    const killers = searchHeuristics?.killers || null;
    const pieceState = activePieceStateFor(board);
    const useSimpleSearchSort = pieceState && !currentIsInCheck && !hasThreatened && !hasCanCapture;
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
        const fromSq = moveFromSq(move);
        const toSq = moveToSq(move);
        const fromR = (fromSq / 9) | 0, fromC = fromSq % 9;
        const toR = (toSq / 9) | 0, toC = toSq % 9;
        const piece = board[fromR][fromC];
        const pieceValue = getMaterialValue(piece, gameStage);
        const targetPiece = board[toR][toC];
        const targetPieceValue = targetPiece ? getMaterialValue(targetPiece, gameStage) : 0;
        let priority = 4;
        let score = 0;

        if (ttMove && isSameMove(move, ttMove)) {
            priority = -1;
            score = 1000000;
        } else if (currentIsInCheck) {
            const capturesChecker = targetPiece && squareMarkScratch[toSq] !== 0;
            if (capturesChecker) {
                priority = 0;
                score = 10000 + targetPieceValue;
            } else if (targetPiece) {
                priority = 2;
                score = targetPieceValue * 16 - pieceValue;
            } else if (piece.type === 'general') {
                priority = 3;
                score = pieceValue;
            }
        } else if (hasThreatened) {
            if (isMarkedThreatened(fromSq)) {
                priority = 1;
                score = pieceValue;
            } else if (targetPiece) {
                priority = hasCanCapture && squareMarkScratch[toSq] !== 0 ? 2 : 3;
                score = targetPieceValue;
            }
        } else if (hasCanCapture) {
            if (squareMarkScratch[toSq] !== 0) {
                priority = 2;
                score = targetPieceValue;
            } else if (targetPiece) {
                priority = 3;
                score = targetPieceValue;
            }
        } else if (targetPiece) {
            priority = 3;
            score = targetPieceValue * 16 - pieceValue;
        }

        if (priority >= 0) {
            if (!targetPiece && killers && isSameMove(move, killers[0])) {
                priority = Math.min(priority, 2);
                score += 8000;
            } else if (!targetPiece && killers && isSameMove(move, killers[1])) {
                priority = Math.min(priority, 2);
                score += 7000;
            }
            score += getHistoryScore(move);
        }

        sortMovePriorityScratch[index] = priority;
        sortMoveScoreScratch[index] = score;
        if (!isEncodedMove(move)) {
            move.priority = priority;
            move.sortScore = score;
            move.originalIndex = index;
        }
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

    clearSortSquareMarks();
    if (SEARCH_PROFILE) perfStats.sortMovesMs += performance.now() - __t0;
    return moves;
};

// Play-only normal-node ordering. prepareSearchInfo has no relation lists, so
// its non-check path is exactly the simple branch of sortMovesFast without the
// generic UI/analysis bookkeeping. Checked positions retain the generic order.
const sortMovesPlay = (moves, board, currentPlayer, piecesInfo, gameStage, boardInfo, ttMove, killers, inCheck) => {
    if (inCheck) {
        return sortMovesFast(moves, board, currentPlayer, piecesInfo, gameStage, boardInfo, { ttMove, killers });
    }
    const pieceState = activePieceStateFor(board);
    if (!pieceState) {
        return sortMovesFast(moves, board, currentPlayer, piecesInfo, gameStage, boardInfo, { ttMove, killers });
    }

    const __t0 = SEARCH_PROFILE ? performance.now() : 0;
    if (SEARCH_PROFILE) perfStats.sortMovesCount++;
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

    if (SEARCH_PROFILE) perfStats.sortMovesMs += performance.now() - __t0;
    return moves;
};

// 搜索用着法准备（轻量）：不建关系图/威胁/机动性
// SEARCH_DEFER_LEGALITY=true：只生成伪合法，合法性在试走时检测
// SEARCH_DEFER_LEGALITY=false：预过滤合法着（旧路径，便于 A/B）
// 点棋关系仍走完整 evaluateBoard，不受影响
const prepareSearchInfo = (board, currentPlayer) => {
    const __t0 = SEARCH_PROFILE ? performance.now() : 0;
    perfStats.prepareSearchInfoCount[currentPlayer]++;

    const inCheck = isCheckRaw(board, currentPlayer);
    if (SEARCH_PROFILE) perfStats.prepareCheckMs += performance.now() - __t0;
    const __movesT0 = SEARCH_PROFILE ? performance.now() : 0;
    const piecesInfo = [];
    const legalMoveList = [];
    const defer = true;
    const pieceState = activePieceStateFor(board);

    if (pieceState) {
        const records = pieceState.records;
        const squareToSlot = pieceState.squareToSlot;
        const squareCodes = pieceState.squareCodes;
        const pieceCodes = pieceState.pieceCodes;
        for (let sq = 0; sq < REL_SQUARES; sq++) {
            const slot = squareToSlot[sq];
            if (slot < 0) continue;
            const record = records[slot];
            if (!record.alive || record.piece.color !== currentPlayer) continue;
            piecesInfo.push({ piece: record.piece, r: record.r, c: record.c });
            perfStats.pseudoMovesGenerated += appendSearchPseudoMovesForPiece(
                legalMoveList, sq, pieceCodes[slot], squareCodes, false
            );
        }
    } else {
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const piece = board[r][c];
                if (!piece || piece.color !== currentPlayer) continue;
                const from = { r, c };
                const moves = getPieceMoves(board, from, piece);
                const useMoves = defer ? moves : filterLegalMoves(board, from, piece, moves);
                piecesInfo.push({ piece, r, c, moves, legalMoves: useMoves });
                for (let i = 0; i < useMoves.length; i++) {
                    const to = useMoves[i];
                    legalMoveList.push(encodeMoveFromCoords(r, c, to.r, to.c));
                }
                perfStats.pseudoMovesGenerated += moves.length;
            }
        }
    }
    if (SEARCH_PROFILE) perfStats.prepareMoveGenMs += performance.now() - __movesT0;

    // 轻量 boardInfo：仅被将标志
    const boardInfo = {
        redIsInCheck: currentPlayer === 'red' ? inCheck : false,
        blackIsInCheck: currentPlayer === 'black' ? inCheck : false,
        gameState: null
    };

    if (legalMoveList.length === 0) {
        const opponent = currentPlayer === 'red' ? 'black' : 'red';
        boardInfo.gameState = inCheck
            ? { status: 'checkmate', winner: opponent }
            : { status: 'stalemate', winner: opponent };
    } else {
        boardInfo.gameState = { status: 'playing' };
    }

    if (SEARCH_PROFILE) perfStats.prepareSearchInfoMs += performance.now() - __t0;
    return { piecesInfo, boardInfo, legalMoveList, inCheck };
};

// 计算衍生值：威胁值、安全值、战术值、机动值
const calculateDerivedValues = (board, piecesInfo, currentPlayer = null, boardInfo = null, forSearchLeaf = false) => {
    // 重置所有衍生值，除了机动值（已在收集棋子信息时计算）
    for (const info of piecesInfo) {
        info.threatValue = 0;
        info.safetyValue = 0;
        info.tacticValue = 0;
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
    if (currentPlayer && !forSearchLeaf) {
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

const SEARCH_GENERAL_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];
const SEARCH_ADVISOR_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];
const SEARCH_ELEPHANT_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];
const SEARCH_HORSE_DEST = new Array(REL_SQUARES);
const SEARCH_SOLDIER_DEST = [new Array(REL_SQUARES), new Array(REL_SQUARES)];
// All orthogonal rays live in one compact buffer. The offset table avoids
// hundreds of tiny TypedArrays in the relation, pseudo-move, and check paths.
const SEARCH_RAY_OFFSETS = new Uint16Array(REL_SQUARES * ORTH_DIRS.length + 1);
let SEARCH_RAY_SQUARES = null;
const SEARCH_RAY_DIRS = 4;
const SEARCH_HORSE_CHECKERS = new Array(REL_SQUARES);
const SEARCH_SQ_ROWS = new Uint8Array(REL_SQUARES);
const SEARCH_SQ_COLS = new Uint8Array(REL_SQUARES);

(() => {
    const searchRaySquares = [];
    const squareDestinations = (dests) => {
        const packed = new Uint8Array(dests.length);
        for (let i = 0; i < dests.length; i++) packed[i] = dests[i].r * 9 + dests[i].c;
        return packed;
    };
    const blockedDestinations = (dests) => {
        const packed = new Uint16Array(dests.length);
        for (let i = 0; i < dests.length; i++) {
            packed[i] = (dests[i].br * 9 + dests[i].bc) * 128 + dests[i].r * 9 + dests[i].c;
        }
        return packed;
    };

    for (let sq = 0; sq < REL_SQUARES; sq++) {
        SEARCH_GENERAL_DEST[0][sq] = squareDestinations(GENERAL_DEST[0][sq]);
        SEARCH_GENERAL_DEST[1][sq] = squareDestinations(GENERAL_DEST[1][sq]);
        SEARCH_ADVISOR_DEST[0][sq] = squareDestinations(ADVISOR_DEST[0][sq]);
        SEARCH_ADVISOR_DEST[1][sq] = squareDestinations(ADVISOR_DEST[1][sq]);
        SEARCH_ELEPHANT_DEST[0][sq] = blockedDestinations(ELEPHANT_DEST[0][sq]);
        SEARCH_ELEPHANT_DEST[1][sq] = blockedDestinations(ELEPHANT_DEST[1][sq]);
        SEARCH_HORSE_DEST[sq] = blockedDestinations(HORSE_DEST[sq]);
        SEARCH_SOLDIER_DEST[0][sq] = squareDestinations(SOLDIER_DEST[0][sq]);
        SEARCH_SOLDIER_DEST[1][sq] = squareDestinations(SOLDIER_DEST[1][sq]);

        const r = (sq / 9) | 0;
        const c = sq % 9;
        SEARCH_SQ_ROWS[sq] = r;
        SEARCH_SQ_COLS[sq] = c;
        for (let dir = 0; dir < ORTH_DIRS.length; dir++) {
            SEARCH_RAY_OFFSETS[(sq << 2) | dir] = searchRaySquares.length;
            const dr = ORTH_DIRS[dir][0];
            const dc = ORTH_DIRS[dir][1];
            for (let nr = r + dr, nc = c + dc; nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS; nr += dr, nc += dc) {
                searchRaySquares.push(nr * 9 + nc);
            }
        }

        const horseCheckers = [];
        for (let i = 0; i < HORSE_DIRS.length; i++) {
            const d = HORSE_DIRS[i];
            const horseR = r + d.dr;
            const horseC = c + d.dc;
            if (horseR < 0 || horseR >= ROWS || horseC < 0 || horseC >= COLS) continue;
            const legR = horseR - d.legDr;
            const legC = horseC - d.legDc;
            horseCheckers.push((legR * 9 + legC) * 128 + horseR * 9 + horseC);
        }
        SEARCH_HORSE_CHECKERS[sq] = new Uint16Array(horseCheckers);
    }
    SEARCH_RAY_OFFSETS[REL_SQUARES << 2] = searchRaySquares.length;
    SEARCH_RAY_SQUARES = new Uint8Array(searchRaySquares);
})();

const appendSearchShortMoves = (moves, fromSq, dests, squareCodes, isRed, capturesOnly, blocked) => {
    let generated = 0;
    for (let i = 0; i < dests.length; i++) {
        let toSq = dests[i];
        if (blocked) {
            if (squareCodes[toSq >>> 7] !== 0) continue;
            toSq &= 127;
        }
        const targetCode = squareCodes[toSq];
        if (targetCode === 0) {
            generated++;
            if (!capturesOnly) moves.push((fromSq << 7) | toSq);
        } else if ((targetCode < 8) !== isRed) {
            generated++;
            moves.push((fromSq << 7) | toSq);
        }
    }
    return generated;
};

const appendSearchPseudoMovesForPiece = (moves, fromSq, pieceCode, squareCodes, capturesOnly = false) => {
    const pieceType = pieceCode & 7;
    const isRed = pieceCode < 8;
    const colorIdx = isRed ? 0 : 1;
    let generated = 0;

    switch (pieceType) {
        case 1:
            return appendSearchShortMoves(moves, fromSq, SEARCH_GENERAL_DEST[colorIdx][fromSq], squareCodes, isRed, capturesOnly, false);
        case 5:
            return appendSearchShortMoves(moves, fromSq, SEARCH_ADVISOR_DEST[colorIdx][fromSq], squareCodes, isRed, capturesOnly, false);
        case 4:
            return appendSearchShortMoves(moves, fromSq, SEARCH_ELEPHANT_DEST[colorIdx][fromSq], squareCodes, isRed, capturesOnly, true);
        case 3:
            return appendSearchShortMoves(moves, fromSq, SEARCH_HORSE_DEST[fromSq], squareCodes, isRed, capturesOnly, true);
        case 7:
            return appendSearchShortMoves(moves, fromSq, SEARCH_SOLDIER_DEST[colorIdx][fromSq], squareCodes, isRed, capturesOnly, false);
        case 2:
            for (let dir = 0, rayIndex = fromSq << 2; dir < SEARCH_RAY_DIRS; dir++, rayIndex++) {
                const rayEnd = SEARCH_RAY_OFFSETS[rayIndex + 1];
                for (let rayPos = SEARCH_RAY_OFFSETS[rayIndex]; rayPos < rayEnd; rayPos++) {
                    const toSq = SEARCH_RAY_SQUARES[rayPos];
                    const targetCode = squareCodes[toSq];
                    if (targetCode === 0) {
                        generated++;
                        if (!capturesOnly) moves.push((fromSq << 7) | toSq);
                    } else {
                        if ((targetCode < 8) !== isRed) {
                            generated++;
                            moves.push((fromSq << 7) | toSq);
                        }
                        break;
                    }
                }
            }
            return generated;
        case 6:
            for (let dir = 0, rayIndex = fromSq << 2; dir < SEARCH_RAY_DIRS; dir++, rayIndex++) {
                let screenFound = false;
                const rayEnd = SEARCH_RAY_OFFSETS[rayIndex + 1];
                for (let rayPos = SEARCH_RAY_OFFSETS[rayIndex]; rayPos < rayEnd; rayPos++) {
                    const toSq = SEARCH_RAY_SQUARES[rayPos];
                    const targetCode = squareCodes[toSq];
                    if (!screenFound) {
                        if (targetCode === 0) {
                            generated++;
                            if (!capturesOnly) moves.push((fromSq << 7) | toSq);
                        } else {
                            screenFound = true;
                        }
                    } else if (targetCode !== 0) {
                        if ((targetCode < 8) !== isRed) {
                            generated++;
                            moves.push((fromSq << 7) | toSq);
                        }
                        break;
                    }
                }
            }
            return generated;
        default:
            return generated;
    }
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
                mobilityValue += applyRelationSquare(
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
    const { baseMoveValue } = EVALUATION_PARAMETERS.mobility;
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
                mobilityValue += baseMoveValue;
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

// 从格位 mask 还原 threat/guard/control 列表（点棋/UI）
// Search leaves always use masks and attack bits, so this avoids UI/control-list branches.
const applySearchLeafRelationSquare = (squareCodes, sq, bit, isRed) => {
    const targetCode = squareCodes[sq];
    if (targetCode === 0) {
        if (isRed) setAttackBit(scratchRedAttack, sq);
        else setAttackBit(scratchBlackAttack, sq);
        return EVALUATION_PARAMETERS.mobility.baseMoveValue;
    }
    if ((targetCode < 8) !== isRed) {
        scratchAttackMask[sq] |= bit;
    } else if ((targetCode & 7) !== 1) {
        scratchGuardMask[sq] |= bit;
    }
    return 0;
};

const calculateSearchLeafRelations = (piecesInfo, squareCodes) => {
    scratchAttackMask.fill(0);
    scratchGuardMask.fill(0);
    clearAttackBits(scratchRedAttack);
    clearAttackBits(scratchBlackAttack);

    const baseMoveValue = EVALUATION_PARAMETERS.mobility.baseMoveValue;
    for (let pi = 0; pi < piecesInfo.length; pi++) {
        const info = piecesInfo[pi];
        const r = info.r;
        const c = info.c;
        const fromSq = r * 9 + c;
        const pieceCode = info.pieceCode;
        const pieceType = pieceCode & 7;
        const isRed = pieceCode < 8;
        const colorIdx = isRed ? 0 : 1;
        const bit = 1 << pi;
        let mobilityValue = 0;

        switch (pieceType) {
            case 1: {
                const dests = GENERAL_DEST[colorIdx][fromSq];
                for (let i = 0; i < dests.length; i++) {
                    const d = dests[i];
                    mobilityValue += applySearchLeafRelationSquare(squareCodes, d.r * 9 + d.c, bit, isRed);
                }
                break;
            }
            case 5: {
                const dests = ADVISOR_DEST[colorIdx][fromSq];
                for (let i = 0; i < dests.length; i++) {
                    const d = dests[i];
                    mobilityValue += applySearchLeafRelationSquare(squareCodes, d.r * 9 + d.c, bit, isRed);
                }
                break;
            }
            case 4: {
                const dests = ELEPHANT_DEST[colorIdx][fromSq];
                for (let i = 0; i < dests.length; i++) {
                    const d = dests[i];
                    if (squareCodes[d.br * 9 + d.bc] === 0) {
                        mobilityValue += applySearchLeafRelationSquare(squareCodes, d.r * 9 + d.c, bit, isRed);
                    }
                }
                break;
            }
            case 3: {
                const dests = HORSE_DEST[fromSq];
                for (let i = 0; i < dests.length; i++) {
                    const d = dests[i];
                    if (squareCodes[d.br * 9 + d.bc] === 0) {
                        mobilityValue += applySearchLeafRelationSquare(squareCodes, d.r * 9 + d.c, bit, isRed);
                    }
                }
                break;
            }
            case 2:
                for (let i = 0; i < ORTH_DIRS.length; i++) {
                    const dr = ORTH_DIRS[i][0];
                    const dc = ORTH_DIRS[i][1];
                    let nr = r + dr;
                    let nc = c + dc;
                    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                        const sq = nr * 9 + nc;
                        const targetCode = squareCodes[sq];
                        if (targetCode === 0) {
                            if (isRed) setAttackBit(scratchRedAttack, sq);
                            else setAttackBit(scratchBlackAttack, sq);
                            mobilityValue += baseMoveValue;
                        } else {
                            if ((targetCode < 8) !== isRed) scratchAttackMask[sq] |= bit;
                            else if ((targetCode & 7) !== 1) scratchGuardMask[sq] |= bit;
                            break;
                        }
                        nr += dr;
                        nc += dc;
                    }
                }
                break;
            case 6:
                for (let i = 0; i < ORTH_DIRS.length; i++) {
                    const dr = ORTH_DIRS[i][0];
                    const dc = ORTH_DIRS[i][1];
                    let nr = r + dr;
                    let nc = c + dc;
                    let screens = 0;
                    while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && screens < 2) {
                        const sq = nr * 9 + nc;
                        const targetCode = squareCodes[sq];
                        if (targetCode !== 0) {
                            screens++;
                            if (screens === 2) {
                                if ((targetCode < 8) !== isRed) scratchAttackMask[sq] |= bit;
                                else if ((targetCode & 7) !== 1) scratchGuardMask[sq] |= bit;
                                break;
                            }
                        } else if (screens === 0) {
                            mobilityValue += baseMoveValue;
                        } else {
                            if (isRed) setAttackBit(scratchRedAttack, sq);
                            else setAttackBit(scratchBlackAttack, sq);
                        }
                        nr += dr;
                        nc += dc;
                    }
                }
                break;
            case 7: {
                const dests = SOLDIER_DEST[colorIdx][fromSq];
                for (let i = 0; i < dests.length; i++) {
                    const d = dests[i];
                    mobilityValue += applySearchLeafRelationSquare(squareCodes, d.r * 9 + d.c, bit, isRed);
                }
                break;
            }
            default:
                break;
        }
        info.mobilityValue = mobilityValue;
    }
};

// Search-only relation builder. It is equivalent to calculateSearchLeafRelations,
// but reuses the packed move tables and rays already used by pseudo move generation.
const calculatePackedSearchLeafRelations = (piecesInfo, squareCodes) => {
    scratchAttackMask.fill(0);
    scratchGuardMask.fill(0);
    clearAttackBits(scratchRedAttack);
    clearAttackBits(scratchBlackAttack);

    const baseMoveValue = EVALUATION_PARAMETERS.mobility.baseMoveValue;
    const attackMask = scratchAttackMask;
    const guardMask = scratchGuardMask;
    const redAttack = scratchRedAttack;
    const blackAttack = scratchBlackAttack;

    for (let pi = 0; pi < piecesInfo.length; pi++) {
        const info = piecesInfo[pi];
        // Slots are reused between leaves. Clear derived scores while already
        // visiting each piece to build its packed attack and guard relations.
        info.threatValue = 0;
        info.safetyValue = 0;
        info.tacticValue = 0;
        const fromSq = info.sq;
        const pieceCode = info.pieceCode;
        const pieceType = pieceCode & 7;
        const isRed = pieceCode < 8;
        const colorIdx = isRed ? 0 : 1;
        const bit = 1 << pi;
        const attackBits = isRed ? redAttack : blackAttack;
        let mobilityValue = 0;

        switch (pieceType) {
            case 1:
            case 5:
            case 7: {
                const dests = pieceType === 1
                    ? SEARCH_GENERAL_DEST[colorIdx][fromSq]
                    : pieceType === 5
                        ? SEARCH_ADVISOR_DEST[colorIdx][fromSq]
                        : SEARCH_SOLDIER_DEST[colorIdx][fromSq];
                for (let i = 0; i < dests.length; i++) {
                    const sq = dests[i];
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        attackBits[sq >>> 5] |= 1 << (sq & 31);
                        mobilityValue += baseMoveValue;
                    } else if ((targetCode < 8) !== isRed) {
                        attackMask[sq] |= bit;
                    } else if ((targetCode & 7) !== 1) {
                        guardMask[sq] |= bit;
                    }
                }
                break;
            }
            case 4:
            case 3: {
                const dests = pieceType === 4
                    ? SEARCH_ELEPHANT_DEST[colorIdx][fromSq]
                    : SEARCH_HORSE_DEST[fromSq];
                for (let i = 0; i < dests.length; i++) {
                    const packed = dests[i];
                    if (squareCodes[packed >>> 7] !== 0) continue;
                    const sq = packed & 127;
                    const targetCode = squareCodes[sq];
                    if (targetCode === 0) {
                        attackBits[sq >>> 5] |= 1 << (sq & 31);
                        mobilityValue += baseMoveValue;
                    } else if ((targetCode < 8) !== isRed) {
                        attackMask[sq] |= bit;
                    } else if ((targetCode & 7) !== 1) {
                        guardMask[sq] |= bit;
                    }
                }
                break;
            }
            case 2:
                for (let dir = 0, rayIndex = fromSq << 2; dir < SEARCH_RAY_DIRS; dir++, rayIndex++) {
                    const rayEnd = SEARCH_RAY_OFFSETS[rayIndex + 1];
                    for (let rayPos = SEARCH_RAY_OFFSETS[rayIndex]; rayPos < rayEnd; rayPos++) {
                        const sq = SEARCH_RAY_SQUARES[rayPos];
                        const targetCode = squareCodes[sq];
                        if (targetCode === 0) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                            mobilityValue += baseMoveValue;
                            continue;
                        }
                        if ((targetCode < 8) !== isRed) attackMask[sq] |= bit;
                        else if ((targetCode & 7) !== 1) guardMask[sq] |= bit;
                        break;
                    }
                }
                break;
            case 6:
                for (let dir = 0, rayIndex = fromSq << 2; dir < SEARCH_RAY_DIRS; dir++, rayIndex++) {
                    let screenFound = false;
                    const rayEnd = SEARCH_RAY_OFFSETS[rayIndex + 1];
                    for (let rayPos = SEARCH_RAY_OFFSETS[rayIndex]; rayPos < rayEnd; rayPos++) {
                        const sq = SEARCH_RAY_SQUARES[rayPos];
                        const targetCode = squareCodes[sq];
                        if (!screenFound) {
                            if (targetCode === 0) {
                                mobilityValue += baseMoveValue;
                            } else {
                                screenFound = true;
                            }
                        } else if (targetCode === 0) {
                            attackBits[sq >>> 5] |= 1 << (sq & 31);
                        } else {
                            if ((targetCode < 8) !== isRed) attackMask[sq] |= bit;
                            else if ((targetCode & 7) !== 1) guardMask[sq] |= bit;
                            break;
                        }
                    }
                }
                break;
            default:
                break;
        }
        info.mobilityValue = mobilityValue;
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

    // 供 isPositionAcceptable / 点棋 controllers：与旧语义一致，仅空控格
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
};

const isPositionAcceptable = (board, from, to, currentPlayer, boardInfo = null, piecesInfo = null, tryMovePiece = null, gameStage = 'mid') => {
    const movingPiece = tryMovePiece || board[from.r][from.c];
    const targetPiece = board[to.r][to.c];
    const isCapture = targetPiece && targetPiece.color !== currentPlayer;

    // 收集所有棋子信息，只在没有提供时计算
    let localPiecesInfo = piecesInfo;
    if (!localPiecesInfo) {
        localPiecesInfo = [];
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const piece = board[r][c];
                if (piece) {
                    const allyGuards = [];
                    const moves = getPieceMoves(board, { r, c }, piece, allyGuards);
                    localPiecesInfo.push({
                        piece,
                        r, c, moves, allyGuards,
                        materialValue: getMaterialValue(piece, gameStage),
                        threat: [],
                        threatenedBy: [],
                        guard: [],
                        guardedBy: [],
                        mobilityValue: 0,
                        threatValue: 0,
                        safetyValue: 0,
                        tacticValue: 0
                    });
                }
            }
        }
    }

    // 计算棋子关系和控制信息，只在没有提供时计算
    let localBoardInfo = boardInfo;
    if (!localBoardInfo) {
        if (localPiecesInfo.length <= 32) {
            clearRelationMasks();
            clearAttackBits(scratchRedAttack);
            clearAttackBits(scratchBlackAttack);
            for (let i = 0; i < localPiecesInfo.length; i++) {
                localPiecesInfo[i].pieceIndex = i;
            }
            localBoardInfo = {
                useRelationMasks: true,
                useAttackBits: true,
                attackMask: scratchAttackMask,
                guardMask: scratchGuardMask,
                controlMask: scratchControlMask,
                redAttack: scratchRedAttack,
                blackAttack: scratchBlackAttack
            };
        } else {
            localBoardInfo = makeEmptyControllerGrid();
        }
        calculatePieceRelations(board, localPiecesInfo, localBoardInfo);
    }

    // 控制者：mask 用 controlMask；旧路径用 boardInfo[r][c]；hydrate 后可用 controllerGrid
    let controllers;
    if (localBoardInfo.useRelationMasks) {
        controllers = [];
        forEachSetBit(localBoardInfo.controlMask[to.r * 9 + to.c], (i) => {
            controllers.push(localPiecesInfo[i]);
        });
    } else if (localBoardInfo.controllerGrid) {
        controllers = localBoardInfo.controllerGrid[to.r][to.c] || [];
    } else {
        controllers = localBoardInfo[to.r][to.c] || [];
    }
    let hasAllyController = false;
    let hasEnemyController = false;

    // 控制者可能是 piecesInfo 引用 {piece,r,c} 或旧结构 {color,type,r,c}
    const controllerColor = (controller) =>
        controller.piece ? controller.piece.color : controller.color;

    for (const controller of controllers) {
        // 排除正在移动的棋子本身（走后它不再从原位控制目标）
        if (movingPiece && controller.r === from.r && controller.c === from.c) {
            continue;
        }
        if (controllerColor(controller) === currentPlayer) {
            hasAllyController = true;
        } else {
            hasEnemyController = true;
        }
    }

    if (isCapture) {
        // 白吃：目标未被敌方保护
        if (!hasEnemyController) {
            return true;
        }
        // 简单 SEE：先得目标分，若会被反吃则再失己方棋子
        const targetValue = getMaterialValue(targetPiece, gameStage);
        const ourValue = getMaterialValue(movingPiece, gameStage);
        let see = targetValue - ourValue;
        // 若有己方继续保护，粗略认为可能再吃回最低价值的敌方保护者
        if (hasAllyController) {
            const enemyGuardValues = controllers
                .filter(c => controllerColor(c) !== currentPlayer && !(c.r === from.r && c.c === from.c))
                .map(c => {
                    const p = board[c.r][c.c];
                    return p ? getMaterialValue(p, gameStage) : 0;
                })
                .filter(v => v > 0)
                .sort((a, b) => a - b);
            if (enemyGuardValues.length > 0) {
                see += enemyGuardValues[0];
            }
        }
        // 明显亏换（如车换无根兵且会被反吃）则过滤；平换/赚换留给搜索
        return see >= 0;
    }

    // 非吃子：目标仅被敌方控制则视为送吃
    if (controllers.length === 0) {
        return true;
    }
    return !hasEnemyController || hasAllyController;
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

// 计算威胁值（基于完整的威胁关系）
// 按被威胁子聚合：每个目标最多一次 SEE；分值加给 threatenedBy[0]
// （关系构建按 piecesInfo 顺序 push，故与旧“攻击方外层遍历首次计分”归属一致）
const calculateTacticalValues = (piecesInfo, currentPlayer, boardInfo = null, board = null, forSearchLeaf = false) => {
    // 统计
    if (currentPlayer) {
        perfStats.calculateThreatValuesCount[currentPlayer]++;
    }

    // 初始化威胁类型统计信息
    const collectUi = !!boardInfo && !forSearchLeaf;
    if (collectUi) {
        boardInfo.checks = [];      // 将军信息
        boardInfo.threatenedPieces = [];  // 被捉的棋子
        boardInfo.canCapture = [];  // 可吃的棋子
    }

    const checkBonus = EVALUATION_PARAMETERS.check.bonus;
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
                firstAttacker.threatValue += sseScore * 0.5;
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
    hashTable;  // [row][col][pieceIndex]
    pieceToIndex;

    constructor() {
        this.pieceToIndex = new Map([
            ['red-general', 0], ['red-advisor', 1], ['red-elephant', 2], ['red-horse', 3],
            ['red-chariot', 4], ['red-cannon', 5], ['red-soldier', 6],
            ['black-general', 7], ['black-advisor', 8], ['black-elephant', 9], ['black-horse', 10],
            ['black-chariot', 11], ['black-cannon', 12], ['black-soldier', 13]
        ]);
        // Initialize random hash values using seeded RNG (53-bit integers to avoid precision issues)
        this.hashTable = [];
        const MAX_SAFE = 0x1FFFFFFFFFFFFF; // 2^53 - 1
        
        // Simple seeded RNG (LCG - Linear Congruential Generator)
        let seed = 123456789; // Fixed seed for deterministic hashing
        const seededRandom = () => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed / 0x7fffffff;
        };

        for (let r = 0; r < 10; r++) {
            this.hashTable[r] = [];
            for (let c = 0; c < 9; c++) {
                this.hashTable[r][c] = [];
                for (let p = 0; p < 14; p++) {
                    // Generate deterministic 53-bit integer
                    const value = Math.floor(seededRandom() * MAX_SAFE);
                    this.hashTable[r][c][p] = value;
                }
            }
        }

        // 格号直索引：hashBySq[sq][pieceIdx]，避免热路径 (sq/9)|0 与 %9
        this.hashBySq = new Array(90);
        for (let sq = 0; sq < 90; sq++) {
            this.hashBySq[sq] = this.hashTable[SQ_ROW[sq]][SQ_COL[sq]];
        }

        // 叶评估缓存键：boardHash ^ initiatorKey ^ stageKey
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
                        h ^= this.hashTable[r][c][pieceIdx];
                    }
                }
            }
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
            newHash ^= this.hashTable[move.from.r][move.from.c][movingIdx];
            newHash ^= this.hashTable[move.to.r][move.to.c][movingIdx];
        }
        if (capturedPiece) {
            const capturedIdx = this.pieceIndex(capturedPiece);
            if (capturedIdx !== undefined) {
                newHash ^= this.hashTable[move.to.r][move.to.c][capturedIdx];
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

// 模块级伪合法落点（避免 getPieceMoves 每调用新建闭包）
const pushPseudoDest = (board, moves, alliesOut, pieceColor, tr, tc) => {
  if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return;
  const target = board[tr][tc];
  if (!target || target.color !== pieceColor) {
    moves.push({ r: tr, c: tc });
  } else if (alliesOut && target.type !== 'general') {
    alliesOut.push({ r: tr, c: tc });
  }
};

// alliesOut: 可选，收集可保护的己方落点（不含将帅），供关系计算复用，避免二次射线
const getPieceMoves = (board, pos, piece, alliesOut = null) => {
  const moves = [];
  const { r, c } = pos;
  const isRed = piece.color === 'red';
  const pieceColor = piece.color;
  const colorIdx = isRed ? 0 : 1;
  const fromSq = r * 9 + c;

  switch (piece.type) {
    case 'general': {
      const dests = GENERAL_DEST[colorIdx][fromSq];
      for (let i = 0; i < dests.length; i++) {
        const d = dests[i];
        pushPseudoDest(board, moves, alliesOut, pieceColor, d.r, d.c);
      }
      break;
    }
    case 'advisor': {
      const dests = ADVISOR_DEST[colorIdx][fromSq];
      for (let i = 0; i < dests.length; i++) {
        const d = dests[i];
        pushPseudoDest(board, moves, alliesOut, pieceColor, d.r, d.c);
      }
      break;
    }
    case 'elephant': {
      const dests = ELEPHANT_DEST[colorIdx][fromSq];
      for (let i = 0; i < dests.length; i++) {
        const d = dests[i];
        if (board[d.br][d.bc] === null) {
          pushPseudoDest(board, moves, alliesOut, pieceColor, d.r, d.c);
        }
      }
      break;
    }
    case 'horse': {
      const dests = HORSE_DEST[fromSq];
      for (let i = 0; i < dests.length; i++) {
        const d = dests[i];
        if (board[d.br][d.bc] === null) {
          pushPseudoDest(board, moves, alliesOut, pieceColor, d.r, d.c);
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
            moves.push({ r: nr, c: nc });
          } else {
            if (target.color !== pieceColor) moves.push({ r: nr, c: nc });
            else if (alliesOut && target.type !== 'general') alliesOut.push({ r: nr, c: nc });
            break;
          }
          nr += dr; nc += dc;
        }
      }
      break;
    case 'cannon':
      // 着法仍只含敌方隔打；己方隔打保护由 fillCannonRelations 统一处理
      for (let i = 0; i < ORTH_DIRS.length; i++) {
        const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
        let nr = r + dr, nc = c + dc;
        let screenFound = false;
        while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
          if (!screenFound) {
            if (board[nr][nc] === null) {
              moves.push({ r: nr, c: nc });
            } else {
              screenFound = true;
            }
          } else {
            if (board[nr][nc] !== null) {
              if (board[nr][nc].color !== pieceColor) moves.push({ r: nr, c: nc });
              break;
            }
          }
          nr += dr; nc += dc;
        }
      }
      break;
    case 'soldier': {
      const dests = SOLDIER_DEST[colorIdx][fromSq];
      for (let i = 0; i < dests.length; i++) {
        const d = dests[i];
        pushPseudoDest(board, moves, alliesOut, pieceColor, d.r, d.c);
      }
      break;
    }
  }
  return moves;
};

const isFlyingGeneral = (board) => {
  const redG = getGeneralPos(board, 'red');
  const blackG = getGeneralPos(board, 'black');
  if (!redG || !blackG || redG.c !== blackG.c) return false;
  
  // 确保循环方向正确，从较小的r到较大的r
  const startR = Math.min(blackG.r, redG.r) + 1;
  const endR = Math.max(blackG.r, redG.r) - 1;
  
  for (let r = startR; r <= endR; r++) {
    if (board[r][redG.c] !== null) return false;
  }
  return true;
};

// 无 boardInfo 时的快速将军检测：将位缓存 + 从将位四向射线（车/将/炮合并）
const isCheckRawFromPieceState = (state, color) => {
    const ownIsRed = color === 'red';
    const generalSq = ownIsRed ? state.redGeneralSq : state.blackGeneralSq;
    if (generalSq < 0) return true;

    const squareCodes = state.squareCodes;
    const enemyIsRed = !ownIsRed;
    const gr = SEARCH_SQ_ROWS[generalSq];
    const gc = SEARCH_SQ_COLS[generalSq];

    for (let dir = 0, rayIndex = generalSq << 2; dir < SEARCH_RAY_DIRS; dir++, rayIndex++) {
        let seen = 0;
        const rayEnd = SEARCH_RAY_OFFSETS[rayIndex + 1];
        for (let rayPos = SEARCH_RAY_OFFSETS[rayIndex]; rayPos < rayEnd; rayPos++) {
            const pieceCode = squareCodes[SEARCH_RAY_SQUARES[rayPos]];
            if (pieceCode === 0) continue;
            seen++;
            const isEnemy = (pieceCode < 8) === enemyIsRed;
            const pieceType = pieceCode & 7;
            if (seen === 1) {
                if (isEnemy && (pieceType === 2 || pieceType === 1)) return true;
            } else {
                if (isEnemy && pieceType === 6) return true;
                break;
            }
        }
    }

    const horseCheckers = SEARCH_HORSE_CHECKERS[generalSq];
    for (let i = 0; i < horseCheckers.length; i++) {
        const entry = horseCheckers[i];
        if (squareCodes[entry >>> 7] !== 0) continue;
        const pieceCode = squareCodes[entry & 127];
        if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 3) return true;
    }

    const advisorSquares = SEARCH_ADVISOR_DEST[ownIsRed ? 0 : 1][generalSq];
    for (let i = 0; i < advisorSquares.length; i++) {
        const pieceCode = squareCodes[advisorSquares[i]];
        if (pieceCode !== 0 && (pieceCode < 8) === enemyIsRed && (pieceCode & 7) === 5) return true;
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

const isCheckRaw = (board, color) => {
    const pieceState = activePieceStateFor(board);
    if (pieceState) return isCheckRawFromPieceState(pieceState, color);
    const generalPos = getGeneralPos(board, color);
    if (!generalPos) return true;

    const enemyColor = color === 'red' ? 'black' : 'red';
    const { r: gr, c: gc } = generalPos;

    // 直线：第一子为敌车/将则将军；越过炮架后第二子为敌炮则将军
    for (let i = 0; i < ORTH_DIRS.length; i++) {
        const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
        let nr = gr + dr;
        let nc = gc + dc;
        let seen = 0;

        while (isValidPos(nr, nc)) {
            const p = board[nr][nc];
            if (p) {
                seen++;
                if (seen === 1) {
                    if (p.color === enemyColor && (p.type === 'chariot' || p.type === 'general')) {
                        return true;
                    }
                } else {
                    if (p.color === enemyColor && p.type === 'cannon') {
                        return true;
                    }
                    break;
                }
            }
            nr += dr;
            nc += dc;
        }
    }

    // 马：从将位反推，马腿在马一侧（与 getPieceMoves / HORSE_DIRS 一致）
    for (let i = 0; i < HORSE_DIRS.length; i++) {
        const d = HORSE_DIRS[i];
        const nr = gr + d.dr;
        const nc = gc + d.dc;
        if (isValidPos(nr, nc)) {
            const legR = nr - d.legDr;
            const legC = nc - d.legDc;
            if (board[legR][legC] === null) {
                const p = board[nr][nc];
                if (p && p.color === enemyColor && p.type === 'horse') {
                    return true;
                }
            }
        }
    }

    // 士（九宫内）
    for (let i = 0; i < DIAG_DIRS.length; i++) {
        const dr = DIAG_DIRS[i][0], dc = DIAG_DIRS[i][1];
        const nr = gr + dr;
        const nc = gc + dc;
        if (isValidPos(nr, nc) &&
            ((color === 'red' && nr >= 0 && nr <= 2) || (color === 'black' && nr >= 7 && nr <= 9)) &&
            nc >= 3 && nc <= 5) {
            const p = board[nr][nc];
            if (p && p.color === enemyColor && p.type === 'advisor') {
                return true;
            }
        }
    }

    // 兵：正前方始终可攻；左右仅过河兵
    const enemyForward = enemyColor === 'red' ? 1 : -1;
    const forwardFromR = gr - enemyForward;
    if (isValidPos(forwardFromR, gc)) {
        const p = board[forwardFromR][gc];
        if (p && p.color === enemyColor && p.type === 'soldier') {
            return true;
        }
    }
    for (const dc of [1, -1]) {
        const nc = gc + dc;
        if (isValidPos(gr, nc)) {
            const p = board[gr][nc];
            if (p && p.color === enemyColor && p.type === 'soldier') {
                const crossedRiver = enemyColor === 'red' ? gr >= 5 : gr <= 4;
                if (crossedRiver) {
                    return true;
                }
            }
        }
    }

    return false;
};

const isCheck = (board, color, piecesInfo = null, boardInfo = null) => {
    // 优先使用预计算的将军状态
    if (boardInfo) {
        return color === 'red' ? boardInfo.redIsInCheck : boardInfo.blackIsInCheck;
    }

    // 如果有piecesInfo，也可以从中获取将军状态
    if (piecesInfo && piecesInfo.length > 0) {
        return color === 'red' ? piecesInfo[0].redIsInCheck : piecesInfo[0].blackIsInCheck;
    }

    return isCheckRaw(board, color);
};

// 合法着法：伪合法 + 不送将/不飞将（make/unmake）
const getValidMoves = (board, pos) => {
  const piece = board[pos.r][pos.c];
  if (!piece) return [];
  const pseudoMoves = getPieceMoves(board, pos, piece);
  return filterLegalMoves(board, pos, piece, pseudoMoves);
};

const isValidPlacement = (type, color, r, c) => {
    const isRed = color === 'red';
    switch(type) {
        case 'general':
            // 帅将只能在九宫中心的一条线上
            if (c < 3 || c > 5) return false;
            if (isRed) return r >= 0 && r <= 2;
            else return r >= 7 && r <= 9;
        case 'advisor':
            // 士只能在九宫的5个点之一
            const validAdvisorPositions = {
                red: [[0, 3], [0, 5], [1, 4], [2, 3], [2, 5]],
                black: [[7, 3], [7, 5], [8, 4], [9, 3], [9, 5]]
            };
            return validAdvisorPositions[isRed ? 'red' : 'black'].some(pos => pos[0] === r && pos[1] === c);
        case 'elephant':
            // 相只能在己方半场的7个点之一
            const validElephantPositions = {
                red: [[0, 2], [0, 6], [2, 0], [2, 4], [2, 8], [4, 2], [4, 6]],
                black: [[5, 2], [5, 6], [7, 0], [7, 4], [7, 8], [9, 2], [9, 6]]
            };
            return validElephantPositions[isRed ? 'red' : 'black'].some(pos => pos[0] === r && pos[1] === c);
        case 'soldier':
            // 兵的位置限制：过河前只能在偶数列，过河后可以在任何列
            // 红方兵过河条件是r >= 5，黑方兵过河条件是r <= 4
            const crossedRiver = isRed ? r >= 5 : r <= 4;
            
            if (!crossedRiver) {
                // 过河前只能在偶数列（c=0,2,4,6,8）
                if (![0, 2, 4, 6, 8].includes(c)) return false;
            }
            
            // 兵的位置限制：过河前只能在兵位和兵位前方，过河后敌方半场都合法
            const validSoldierPositions = {
                red: {
                    // 红方初始兵位：r=3, c=0,2,4,6,8
                    initial: [[3, 0], [3, 2], [3, 4], [3, 6], [3, 8]],
                    // 红方兵位前方：r=4, c=0,2,4,6,8
                    forward: [[4, 0], [4, 2], [4, 4], [4, 6], [4, 8]],
                    // 红方过河线：r>=5
                    crossedRiver: r >= 5
                },
                black: {
                    // 黑方初始兵位：r=6, c=0,2,4,6,8
                    initial: [[6, 0], [6, 2], [6, 4], [6, 6], [6, 8]],
                    // 黑方兵位前方：r=5, c=0,2,4,6,8
                    forward: [[5, 0], [5, 2], [5, 4], [5, 6], [5, 8]],
                    // 黑方过河线：r<=4
                    crossedRiver: r <= 4
                }
            };
            
            const soldierInfo = validSoldierPositions[isRed ? 'red' : 'black'];
            const isInitialPos = soldierInfo.initial.some(pos => pos[0] === r && pos[1] === c);
            const isForwardPos = soldierInfo.forward.some(pos => pos[0] === r && pos[1] === c);
            
            if (soldierInfo.crossedRiver) {
                // 过河后敌方半场都合法
                return true;
            } else {
                // 过河前只能在兵位和兵位前方
                return isInitialPos || isForwardPos;
            }
        default:
            return true;
    }
};

const checkGameState = (board, turn, piecesInfo = null, boardInfo = null) => {
    // 优先使用预计算的gameState
    if (boardInfo && boardInfo.gameState) {
        return boardInfo.gameState;
    }
    
    // 没有预计算结果时，执行原始计算
    let hasMoves = false;
    for(let r=0; r<ROWS; r++) {
        for(let c=0; c<COLS; c++) {
            if (board[r][c]?.color === turn) {
                if (getValidMoves(board, {r,c}).length > 0) {
                    hasMoves = true;
                    break;
                }
            }
        }
        if (hasMoves) break;
    }

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

// 定长槽位 TT：TypedArray 热字段 + generation O(1) clear。
// 长度取 2^22：d8 约 110 万独特局面时负载~0.27，显著低于 2^21 下的冲突覆盖率。
const TT_DEFAULT_SIZE = 1 << 22; // 4194304
const TT_DEFAULT_EVICTION_BATCH = 512; // API 兼容，定长 TT 不再批量淘汰
const TT_FLAG_NAMES = ['exact', 'lowerbound', 'upperbound'];

class TranspositionTable {
    constructor(size = TT_DEFAULT_SIZE, evictionBatch = TT_DEFAULT_EVICTION_BATCH) {
        let n = size | 0;
        if (n < 1024) n = 1024;
        // 强制 2 的幂，便于 key & mask
        n = 1 << (32 - Math.clz32(n - 1));
        this.size = n;
        this.mask = n - 1;
        this.evictionBatch = evictionBatch;
        this.generation = 1;
        this.occupiedApprox = 0;
        this.hasher = zobristHasher;

        this.keys = new Float64Array(n);
        this.depths = new Int16Array(n);
        this.values = new Int32Array(n);
        this.flags = new Uint8Array(n);
        this.gens = new Uint32Array(n);
        this.bestMoves = new Array(n);
        this.moveSequences = new Array(n);
        // retrieve 复用，避免每次分配；调用方须在下一次 retrieve/递归前读完字段
        this.entryScratch = {
            depth: 0,
            value: 0,
            flag: 'exact',
            bestMove: null,
            moveSequence: null
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
            fallbackEvictions: 0,
            updatedStores: 0,
            retainedUpdates: 0,
            evictionBatches: 0,
            clears: 0
        };
    }

    setEvictionBatch(batch) {
        this.evictionBatch = Math.max(1, batch | 0);
    }

    store(key, depth, value, flag, bestMove = null, moveSequence = null) {
        const i = (key >>> 0) & this.mask;
        const gen = this.generation;
        const live = this.gens[i] === gen;
        const flagCode = flag === 'exact' ? 0 : (flag === 'lowerbound' ? 1 : 2);

        if (live && this.keys[i] === key) {
            this.stats.updatedStores++;
            // 更深 exact 不被更浅 bound 覆盖
            if (this.depths[i] > depth && this.flags[i] === 0 && flagCode !== 0) {
                this.stats.retainedUpdates++;
                return;
            }
            this.depths[i] = depth;
            this.values[i] = value | 0;
            this.flags[i] = flagCode;
            this.bestMoves[i] = bestMove;
            this.moveSequences[i] = moveSequence;
            this.stats.stores++;
            return;
        }

        if (live) {
            // 哈希冲突：保留更深条目（不限 exact），降低有效命中损失
            if (this.depths[i] > depth) {
                this.stats.retainedUpdates++;
                this.stats.depthPreferredEvictions++;
                return;
            }
            this.stats.lruEvictions++;
            this.stats.fallbackEvictions++;
        } else {
            this.occupiedApprox++;
        }

        this.gens[i] = gen;
        this.keys[i] = key;
        this.depths[i] = depth;
        this.values[i] = value | 0;
        this.flags[i] = flagCode;
        this.bestMoves[i] = bestMove;
        this.moveSequences[i] = moveSequence;
        this.stats.stores++;
    }

    retrieve(key) {
        const i = (key >>> 0) & this.mask;
        if (this.gens[i] !== this.generation || this.keys[i] !== key) {
            this.stats.misses++;
            return null;
        }
        this.stats.hits++;
        const flagCode = this.flags[i];
        if (SEARCH_PROFILE) {
            if (flagCode === 0) this.stats.exactHits++;
            else if (flagCode === 1) this.stats.lowerboundHits++;
            else this.stats.upperboundHits++;
        }
        const e = this.entryScratch;
        e.depth = this.depths[i];
        e.value = this.values[i];
        e.flag = TT_FLAG_NAMES[flagCode];
        e.bestMove = this.bestMoves[i];
        e.moveSequence = this.moveSequences[i];
        return e;
    }

    clear() {
        // O(1)：抬升 generation；槽位惰性失效
        this.generation = (this.generation + 1) >>> 0;
        if (this.generation === 0) {
            this.generation = 1;
            this.gens.fill(0);
        }
        this.occupiedApprox = 0;
        this.stats.clears++;
    }

    getStats() {
        const totalAccesses = this.stats.hits + this.stats.misses;
        const hitRate = totalAccesses > 0 ? (this.stats.hits / totalAccesses * 100).toFixed(2) : 0;
        const currentSize = Math.min(this.occupiedApprox, this.size);
        return {
            ...this.stats,
            evictionBatch: this.evictionBatch,
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
            fallbackEvictions: 0,
            updatedStores: 0,
            retainedUpdates: 0,
            evictionBatches: 0,
            clears: 0
        };
    }
}

// 性能统计
let perfStats = {
    evaluateBoardCount: { red: 0, black: 0 },
    prepareSearchInfoCount: { red: 0, black: 0 },
    calculateThreatValuesCount: { red: 0, black: 0 },
    alphaBetaCalls: 0,  // 总调用次数
    nodesSearched: {}, // 按深度统计搜索的节点数
    movesGenerated: {}, // 按深度统计生成的走法数
    cutoffs: {}, // 按深度统计剪枝次数
    moveOrdering: {
        topMoveSources: { tt: 0, killer: 0, capture: 0, quiet: 0 },
        firstLegalMovesByDepth: {},
        firstLegalCutoffsByDepth: {},
        firstLegalMoveIndexTotalByDepth: {}
    },
    // 合法性路径：伪合法生成量、试走合法性检测、非法跳过、实际进入搜索的合法着
    pseudoMovesGenerated: 0,
    legalityChecks: 0,
    kingSafetyFullChecks: 0,
    kingSafetyFastSkips: 0,
    kingSafetyVerificationFailures: 0,
    illegalMovesSkipped: 0,
    legalMovesSearched: 0,
    // Zobrist：全盘重算次数 / 增量更新次数 / 校验不一致（仅 verify 模式）
    fullHashCount: 0,
    incrementalHashUpdates: 0,
    hashMismatches: 0,
    fastLeafEvalCount: 0,
    fastLeafEvalMs: 0,
    prepareCheckMs: 0,
    prepareMoveGenMs: 0,
    sortMovesCount: 0,
    sortMovesMs: 0,
    legalityCheckMs: 0,
    captureGenCount: 0,
    captureGenMs: 0,
    quiescenceCalls: 0,
    quiescenceCaptureMoves: 0,
    staticEvalCacheHits: 0,
    staticEvalCacheMisses: 0,
    pvsProbes: 0,
    pvsResearches: 0,
    pvsProbeNodes: 0,
    pvsResearchNodes: 0,
    evaluateBoardMs: 0,
    prepareSearchInfoMs: 0,
    startTime: Date.now()
};

// 重置统计（每次搜索开始时调用）
const resetPerfStats = () => {
    activeSearchPieceState = null;
    perfStats.evaluateBoardCount = { red: 0, black: 0 };
    perfStats.prepareSearchInfoCount = { red: 0, black: 0 };
    perfStats.calculateThreatValuesCount = { red: 0, black: 0 };
    perfStats.alphaBetaCalls = 0;
    perfStats.nodesSearched = {};
    perfStats.movesGenerated = {};
    perfStats.cutoffs = {};
    perfStats.moveOrdering = {
        topMoveSources: { tt: 0, killer: 0, capture: 0, quiet: 0 },
        firstLegalMovesByDepth: {},
        firstLegalCutoffsByDepth: {},
        firstLegalMoveIndexTotalByDepth: {}
    };
    perfStats.pseudoMovesGenerated = 0;
    perfStats.legalityChecks = 0;
    perfStats.kingSafetyFullChecks = 0;
    perfStats.kingSafetyFastSkips = 0;
    perfStats.kingSafetyVerificationFailures = 0;
    perfStats.illegalMovesSkipped = 0;
    perfStats.legalMovesSearched = 0;
    perfStats.fullHashCount = 0;
    perfStats.incrementalHashUpdates = 0;
    perfStats.hashMismatches = 0;
    perfStats.fastLeafEvalCount = 0;
    perfStats.fastLeafEvalMs = 0;
    perfStats.prepareCheckMs = 0;
    perfStats.prepareMoveGenMs = 0;
    perfStats.sortMovesCount = 0;
    perfStats.sortMovesMs = 0;
    perfStats.legalityCheckMs = 0;
    perfStats.captureGenCount = 0;
    perfStats.captureGenMs = 0;
    perfStats.quiescenceCalls = 0;
    perfStats.quiescenceCaptureMoves = 0;
    perfStats.staticEvalCacheHits = 0;
    perfStats.staticEvalCacheMisses = 0;
    perfStats.pvsProbes = 0;
    perfStats.pvsResearches = 0;
    perfStats.pvsProbeNodes = 0;
    perfStats.pvsResearchNodes = 0;
    perfStats.evaluateBoardMs = 0;
    perfStats.prepareSearchInfoMs = 0;
    perfStats.startTime = Date.now();
};

const snapshotPerfStats = () => {
    const elapsed = Date.now() - perfStats.startTime;
    const ttStats = transpositionTable.getStats();
    const depths = Object.keys(perfStats.nodesSearched).sort((a, b) => Number(a) - Number(b));
    const byDepth = {};
    for (const d of depths) {
        byDepth[d] = {
            nodes: perfStats.nodesSearched[d] || 0,
            moves: perfStats.movesGenerated[d] || 0,
            cutoffs: perfStats.cutoffs[d] || 0
        };
    }
    return {
        elapsedMs: elapsed,
        profile: SEARCH_PROFILE,
        evaluateBoard: { ...perfStats.evaluateBoardCount },
        prepareSearchInfo: { ...perfStats.prepareSearchInfoCount },
        calculateThreatValues: { ...perfStats.calculateThreatValuesCount },
        alphaBetaCalls: perfStats.alphaBetaCalls,
        pseudoMovesGenerated: perfStats.pseudoMovesGenerated,
        legalityChecks: perfStats.legalityChecks,
        kingSafety: SEARCH_COLLECT_METRICS ? {
            fastPathEnabled: SEARCH_ENABLE_KING_SAFETY_FAST_PATH,
            fullChecks: perfStats.kingSafetyFullChecks,
            fastSkips: perfStats.kingSafetyFastSkips,
            verificationFailures: perfStats.kingSafetyVerificationFailures,
            skipRate: perfStats.legalityChecks
                ? Number((perfStats.kingSafetyFastSkips / perfStats.legalityChecks * 100).toFixed(2))
                : 0
        } : null,
        illegalMovesSkipped: perfStats.illegalMovesSkipped,
        legalMovesSearched: perfStats.legalMovesSearched,
        fullHashCount: perfStats.fullHashCount,
        incrementalHashUpdates: perfStats.incrementalHashUpdates,
        hashMismatches: perfStats.hashMismatches,
        fastLeafEvalCount: perfStats.fastLeafEvalCount,
        fastLeafEvalMs: perfStats.fastLeafEvalMs,
        prepareCheckMs: perfStats.prepareCheckMs,
        prepareMoveGenMs: perfStats.prepareMoveGenMs,
        sortMovesCount: perfStats.sortMovesCount,
        sortMovesMs: perfStats.sortMovesMs,
        legalityCheckMs: perfStats.legalityCheckMs,
        captureGenCount: perfStats.captureGenCount,
        captureGenMs: perfStats.captureGenMs,
        quiescenceCalls: perfStats.quiescenceCalls,
        quiescenceCaptureMoves: perfStats.quiescenceCaptureMoves,
        staticEvalCacheHits: perfStats.staticEvalCacheHits,
        staticEvalCacheMisses: perfStats.staticEvalCacheMisses,
        pvs: SEARCH_COLLECT_METRICS ? {
            enabled: SEARCH_ENABLE_NON_ROOT_PVS,
            probes: perfStats.pvsProbes,
            researches: perfStats.pvsResearches,
            researchRate: perfStats.pvsProbes
                ? Number((perfStats.pvsResearches / perfStats.pvsProbes * 100).toFixed(2))
                : 0,
            probeNodes: perfStats.pvsProbeNodes,
            researchNodes: perfStats.pvsResearchNodes
        } : null,
        evaluateBoardMs: perfStats.evaluateBoardMs,
        prepareSearchInfoMs: perfStats.prepareSearchInfoMs,
        moveOrdering: SEARCH_COLLECT_METRICS ? {
            topMoveSources: { ...perfStats.moveOrdering.topMoveSources },
            byDepth: Object.fromEntries(depths.map((d) => {
                const firstLegalMoves = perfStats.moveOrdering.firstLegalMovesByDepth[d] || 0;
                const firstLegalCutoffs = perfStats.moveOrdering.firstLegalCutoffsByDepth[d] || 0;
                return [d, {
                    firstLegalMoves,
                    firstLegalCutoffs,
                    firstLegalCutoffRate: firstLegalMoves
                        ? Number((firstLegalCutoffs / firstLegalMoves * 100).toFixed(2))
                        : 0,
                    averageFirstLegalMoveIndex: firstLegalMoves
                        ? Number((perfStats.moveOrdering.firstLegalMoveIndexTotalByDepth[d] / firstLegalMoves).toFixed(2))
                        : 0
                }];
            }))
        } : null,
        tt: ttStats,
        byDepth
    };
};

// 打印统计信息
const logPerfStats = (currentPlayer) => {
    const snap = snapshotPerfStats();
    console.log(`Search stats (${currentPlayer}): ${snap.elapsedMs}ms, nodes=${snap.alphaBetaCalls}, legal=${snap.legalMovesSearched}, leaves=${snap.fastLeafEvalCount}`);
    console.log(`TT: ${snap.tt.hits}/${snap.tt.misses} (${snap.tt.hitRate}%), stores=${snap.tt.stores}, size=${snap.tt.currentSize}`);
};

const transpositionTable = new TranspositionTable();

// 叶评估缓存（完整形势分）；每次 getBestMove 清空
const EVAL_CACHE_MAX = Math.pow(2, 18);
const evalCache = new Map();
const clearEvalCache = () => {
    evalCache.clear();
};

// 剪枝开关：完整评估下若开局出废棋则先关，保棋力再重标定
const SEARCH_QUIESCENCE_DEPTH = 2;
const SEARCH_NULL_WINDOW_EPS = 1e-6;
let SEARCH_COLLECT_METRICS = false;
let SEARCH_ENABLE_NON_ROOT_PVS = false;
let SEARCH_ENABLE_KING_SAFETY_FAST_PATH = true;
let SEARCH_VERIFY_KING_SAFETY_FAST_PATH = false;

// 着法合法性：true=搜索内试走时检测（可跳过剪枝未触及着法）；false=prepare 时全量 filterLegalMoves（旧路径）
let SEARCH_COLLECT_MOVE_SEQUENCE = true;

// Zobrist/TT：true=搜索内增量维护局面哈希 + 数值 TT key；false=每节点全盘 hash + 字符串 key（旧路径，便于 A/B）
// 调试：增量后与全盘 hash 比对（仅校验脚本开启，正式搜索关闭）

// 搜索启发：杀棋表 + 历史启发（每次 getBestMove 重置）
let killerMoves = [];
let historyTable = null;

const resetSearchHeuristics = (maxDepth) => {
    killerMoves = Array(maxDepth + 2).fill(null).map(() => [null, null]);
    historyTable = new Int32Array(REL_SQUARES << 7);
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

const addHistoryScore = (move, depth) => {
    if (!historyTable || !move) return;
    const key = (moveFromSq(move) << 7) | moveToSq(move);
    historyTable[key] += depth * depth;
};

const getHistoryScore = (move) => {
    if (!historyTable || !move) return 0;
    return historyTable[(moveFromSq(move) << 7) | moveToSq(move)];
};

const recordTopMoveSource = (depth, board, move, ttMove, killers) => {
    const sources = perfStats.moveOrdering.topMoveSources;
    if (isSameMove(move, ttMove)) sources.tt++;
    else if (isSameMove(move, killers[0]) || isSameMove(move, killers[1])) sources.killer++;
    else if (board[moveToR(move)][moveToC(move)]) sources.capture++;
    else sources.quiet++;
};

const recordFirstLegalMove = (depth, moveIndex) => {
    const ordering = perfStats.moveOrdering;
    ordering.firstLegalMovesByDepth[depth] = (ordering.firstLegalMovesByDepth[depth] || 0) + 1;
    ordering.firstLegalMoveIndexTotalByDepth[depth] =
        (ordering.firstLegalMoveIndexTotalByDepth[depth] || 0) + moveIndex;
};

const recordFirstLegalCutoff = (depth) => {
    const cutoffs = perfStats.moveOrdering.firstLegalCutoffsByDepth;
    cutoffs[depth] = (cutoffs[depth] || 0) + 1;
};

// Worker message handling
if (typeof self !== 'undefined') {
    self.onmessage = function(e) {
    const { type, payload } = e.data;
    
    switch (type) {            
        case 'SEARCH': {
            const { board: searchBoard, turn: searchTurn, depth: searchDepth, gameId, openingBookEnabled: searchOpeningBookEnabled = true, ply: searchPly = 0, enableTimeLimit: searchEnableTimeLimit = false, exactRootScores: searchExactRootScores = false, profile: searchProfile, metrics: searchMetrics = false, nonRootPvs: searchNonRootPvs = false, kingSafetyFastPath: searchKingSafetyFastPath = true, verifyKingSafetyFastPath: searchVerifyKingSafetyFastPath = false, collectMoveSequence: searchCollectMoveSequence } = payload;
            SEARCH_PROFILE = !!searchProfile;
            SEARCH_COLLECT_METRICS = !!searchMetrics;
            SEARCH_ENABLE_NON_ROOT_PVS = !!searchNonRootPvs;
            SEARCH_ENABLE_KING_SAFETY_FAST_PATH = !!searchKingSafetyFastPath;
            SEARCH_VERIFY_KING_SAFETY_FAST_PATH = !!searchVerifyKingSafetyFastPath;
            // Set opening book enabled status
            openingBook.setEnabled(searchOpeningBookEnabled);
            // 记录搜索开始时间
            const startTime = performance.now();
            // 执行搜索
            const bestSearchMove = getBestMove(searchBoard, searchTurn, searchDepth, searchPly, searchEnableTimeLimit, searchExactRootScores, searchCollectMoveSequence);
            // 记录搜索结束时间并计算思考时间
            const endTime = performance.now();
            const thinkingTime = endTime - startTime;
            
            // 检查是否来自开局库
            const bookMoveSearch = openingBook.getBookMove(searchBoard, searchPly);
            const fromBookSearch = !!bookMoveSearch && JSON.stringify(bookMoveSearch) === JSON.stringify(bestSearchMove.bestMove);
            
            // 添加性能统计日志
            logPerfStats(searchTurn);
            
            // 添加思考时间日志
            const formatMove = (move) => move?.from && move?.to
                ? `(${move.from.r},${move.from.c})->(${move.to.r},${move.to.c})`
                : 'none';
            console.log(`Search complete: game=${gameId}, time=${Math.round(thinkingTime)}ms, best=${formatMove(bestSearchMove.bestMove)} score=${bestSearchMove.bestMoveScore}, second=${formatMove(bestSearchMove.secondBestMove)}, book=${fromBookSearch}`);
            // 发送搜索结果和思考时间
            self.postMessage({ 
                type: 'SEARCH_COMPLETE', 
                payload: { 
                    bestMove: bestSearchMove.bestMove, 
                    secondBestMove: bestSearchMove.secondBestMove, 
                    gameId, 
                    fromBook: fromBookSearch, 
                    thinkingTime: Math.round(thinkingTime), // 四舍五入到毫秒
                    moveSequence: bestSearchMove.moveSequence,
                    secondMoveSequence: bestSearchMove.secondMoveSequence,
                    bestMoveScore: bestSearchMove.bestMoveScore,
                    secondBestMoveScore: bestSearchMove.secondBestMoveScore,
                    allMovesWithScores: bestSearchMove.allMovesWithScores || [],
                    completedDepth: bestSearchMove.completedDepth,
                    perf: snapshotPerfStats()
                } 
            });
            break;
        }
        case 'getValidMoves': {
            const { board: vmBoard, pos: vmPos } = payload;
            syncGeneralPosCache(vmBoard);
            const validMoves = getValidMoves(vmBoard, vmPos);
            self.postMessage({
                type: 'validMoves',
                moves: validMoves
            });
            break;
        }
            
        case 'getPieceRelations': {
            const { board: prBoard, pos: prPos } = payload;
            const piece = prBoard[prPos.r][prPos.c];
            
            // 调用evaluateBoard获取完整的棋子信息和boardInfo
            const phase = getGamePhase();
            const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
            const boardEvaluation = evaluateBoard(prBoard, null, gameStage);
            const piecesInfo = boardEvaluation.piecesInfo;
            const boardInfo = boardEvaluation.boardInfo;

            if (boardInfo.useRelationMasks) {
                hydrateRelationsFromMasks(piecesInfo, boardInfo);
            }

            // boardInfo 格内可能是 piecesInfo 引用，统一映射为 {r,c} 供 UI 使用
            const rawControllers = boardInfo.controllerGrid
                ? (boardInfo.controllerGrid[prPos.r][prPos.c] || [])
                : (boardInfo[prPos.r] && boardInfo[prPos.r][prPos.c]) || [];
            const controllers = rawControllers.map((ctrl) => ({ r: ctrl.r, c: ctrl.c }));
            
            let relations = {
                threat: [], 
                threatenedBy: [], 
                guard: [], 
                guardedBy: [], 
                control: [],
                controllers
            };
            
            // 如果点击的是棋子，返回该棋子的关系信息
            if (piece) {
                // Find the current piece info
                const currentPieceInfo = piecesInfo.find(p => p.r === prPos.r && p.c === prPos.c);
                
                if (currentPieceInfo) {
                    // Extract relations
                    const threat = currentPieceInfo.threat.map(threatPiece => ({ r: threatPiece.r, c: threatPiece.c }));
                    const threatenedBy = currentPieceInfo.threatenedBy.map(threatenedByPiece => ({ r: threatenedByPiece.r, c: threatenedByPiece.c }));
                    const guard = currentPieceInfo.guard.map(guardPiece => ({ r: guardPiece.r, c: guardPiece.c }));
                    const guardedBy = currentPieceInfo.guardedBy.map(guardedByPiece => ({ r: guardedByPiece.r, c: guardedByPiece.c }));
                    const control = (currentPieceInfo.control || []).map(controlPos => ({ r: controlPos.r, c: controlPos.c }));
                    
                    relations = {
                        threat, 
                        threatenedBy, 
                        guard, 
                        guardedBy, 
                        control,
                        controllers
                    };
                }
            }
            
            self.postMessage({
                type: 'pieceRelations',
                relations: relations
            });
            break;
        }
            
        case 'checkGameState': {
            const { board: cgsBoard, turn: cgsTurn, requestId } = payload;
            const gameState = checkGameState(cgsBoard, cgsTurn);
            self.postMessage({
                type: 'gameState',
                state: gameState,
                requestId
            });
            break;
        }
            
        case 'evaluateBoard': {
            const { board: evalBoard, turn: evalTurn } = payload;
            // 打印接收的参数
            const phase = getGamePhase();
            const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
            const detailedEval = evaluateBoard(evalBoard, evalTurn, gameStage);
            self.postMessage({
                type: 'detailedEvaluation',
                evaluation: detailedEval
            });
            break;
        }

        case 'evaluatePiece': {
            const { board: pieceEvalBoard, pos: pieceEvalPos, turn } = payload;
            const piece = pieceEvalBoard[pieceEvalPos.r][pieceEvalPos.c];
            
            if (!piece) {
                self.postMessage({
                    type: 'pieceEvaluation',
                    evaluation: {
                        material: 0,
                        position: 0,
                        mobility: 0,
                        threat: 0,
                        safety: 0,
                        tactic: 0
                    }
                });
                return;
            }
            else {
                // 主动调用evaluateBoard获取完整的评估信息
                // 获取当前游戏阶段
                const phase = getGamePhase();
                const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';
            const boardEvaluation = evaluateBoard(pieceEvalBoard, turn, gameStage);
                
                // 从evaluateBoard的返回值中找到当前棋子的信息
                currentPieceInfo = boardEvaluation.piecesInfo.find(
                    p => p.r === pieceEvalPos.r && p.c === pieceEvalPos.c
                );
                
                if (currentPieceInfo) {
                    // 应用权重并返回单个棋子的评估值
                    const evaluation = {
                        material: currentPieceInfo.materialValue * VALUE_WEIGHTS.material,
                        position: currentPieceInfo.positionValue * VALUE_WEIGHTS.position,
                        mobility: currentPieceInfo.mobilityValue * VALUE_WEIGHTS.mobility,
                        threat: currentPieceInfo.threatValue * VALUE_WEIGHTS.threat,
                        safety: currentPieceInfo.safetyValue * VALUE_WEIGHTS.safety,
                        tactic: currentPieceInfo.tacticValue * VALUE_WEIGHTS.tactic
                    };
                    
                    self.postMessage({
                        type: 'pieceEvaluation',
                        evaluation: evaluation
                    });
                } else {
                    // 如果仍然找不到棋子信息，返回默认值
                    self.postMessage({
                        type: 'pieceEvaluation',
                        evaluation: {
                            material: 0,
                            position: 0,
                            mobility: 0,
                            threat: 0,
                            safety: 0,
                            tactic: 0
                        }
                    });
                }
                return;
            }
        }
            
        case 'isCheck': {
            const { board: cBoard, color: cColor, requestId } = payload;
            syncGeneralPosCache(cBoard);
            const inCheck = isCheck(cBoard, cColor);
            self.postMessage({
                type: 'check',
                isCheck: inCheck,
                requestId
            });
            break;
        }
            
        case 'isValidPlacement': {
            const { type: ipType, color: ipColor, r, c } = payload;
            const validPlacement = isValidPlacement(ipType, ipColor, r, c);
            self.postMessage({
                type: 'validPlacement',
                isValid: validPlacement
            });
            break;
        }
            
        case 'addOpeningLineFromString': {
            const { moves, weights } = payload;
            // Add the opening line to the opening book
            openingBook.addOpeningLineFromString([moves], weights);
            // Send confirmation
            self.postMessage({ 
                type: 'openingLineAdded', 
                success: true 
            });
            break;
        }
            
        case 'movesToNotation': {
            const { boardHistory, moveHistory } = payload;
            const notation = openingBook.movesToNotation(boardHistory, moveHistory);
            self.postMessage({ 
                type: 'notation', 
                notation: notation 
            });
            break;
        }
            
        case 'notationToMoves': {
            const { notation: notationString, initialBoard } = payload;
            const movesFromNotation = openingBook.notationToMoves(notationString, initialBoard);
            self.postMessage({ 
                type: 'moves', 
                moves: movesFromNotation 
            });
            break;
        }
            
        case 'setValueWeights': {
            VALUE_WEIGHTS = { ...VALUE_WEIGHTS, ...payload };
            console.log('Updated VALUE_WEIGHTS:', VALUE_WEIGHTS);
            break;
        }
    }
};

    // Override console.log to send messages back to main thread
    const originalConsoleLog = console.log;
    console.log = function(...args) {
        // Send to main thread
        self.postMessage({
            type: 'log',
            data: args.join(' ')
        });
        
        // Also log to worker console
        originalConsoleLog.apply(console, args);
    };
}

// 空着剪枝：有进攻子力时才允许（避免将/士/象残局逼着误剪）
const canDoNullMove = (board, color) => {
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = board[r][c];
            if (!p || p.color !== color) continue;
            if (p.type === 'chariot' || p.type === 'horse' || p.type === 'cannon' || p.type === 'soldier') {
                return true;
            }
        }
    }
    return false;
};

// 搜索用 TT key：增量模式为 number，旧模式为 `${hash}:${side}` 字符串
const makeSearchTTKey = (board, currentPlayer, boardHash) => {
    return zobristHasher.ttKeyFromHash(boardHash, currentPlayer);
};

// 走子后的子节点局面哈希（仅增量模式有意义；须在 make 前保存 movingPiece）
const childBoardHash = (boardHash, move, movingPiece, captured) => {
    perfStats.incrementalHashUpdates++;
    if (isEncodedMove(move)) {
        let newHash = boardHash;
        const movingIdx = zobristHasher.pieceIndex(movingPiece);
        const from = move >>> 7;
        const to = move & MOVE_TO_MASK;
        const hashBySq = zobristHasher.hashBySq;
        if (movingIdx !== undefined) {
            newHash ^= hashBySq[from][movingIdx];
            newHash ^= hashBySq[to][movingIdx];
        }
        if (captured) {
            const capturedIdx = zobristHasher.pieceIndex(captured);
            if (capturedIdx !== undefined) {
                newHash ^= hashBySq[to][capturedIdx];
            }
        }
        return newHash;
    }
    return zobristHasher.updateHash(boardHash, move, movingPiece, captured);
};

// 对弈 numeric 叶：关系 + 威胁/SEE + 安全 + 汇总（要求 activeSearchPieceState 已绑定 board）
const evaluatePlayLeafNumeric = (board, searchInitiator, gameStage) => {
    const __t0 = SEARCH_PROFILE ? performance.now() : 0;
    const pieceState = activePieceStateFor(board);
    const piecesInfo = scratchLeafPiecesInfo;
    const records = pieceState.records;
    const materialValues = pieceState.materialValues;
    const squareCodes = pieceState.squareCodes;
    let count = 0;
    for (let i = 0; i < records.length; i++) {
        const record = records[i];
        if (!record.alive) continue;
        const info = scratchLeafPieceSlots[count];
        const pieceCode = pieceState.pieceCodes[i];
        info.piece = null;
        info.pieceCode = pieceCode;
        info.r = record.r;
        info.c = record.c;
        info.sq = record.sq;
        info.pieceIndex = count;
        info.materialValue = materialValues[pieceCode & 7];
        info.positionValue = 0;
        piecesInfo[count++] = info;
    }
    piecesInfo.length = count;

    calculatePackedSearchLeafRelations(piecesInfo, squareCodes);

    perfStats.calculateThreatValuesCount[searchInitiator]++;
    const checkBonus = EVALUATION_PARAMETERS.check.bonus;
    const attackMask = scratchAttackMask;
    const guardMask = scratchGuardMask;
    for (let ti = 0; ti < count; ti++) {
        const threatenedPiece = piecesInfo[ti];
        const sq = threatenedPiece.sq;
        const attackers = attackMask[sq] >>> 0;
        if (attackers === 0) continue;

        const firstBit = attackers & -attackers;
        const firstAttacker = piecesInfo[31 - Math.clz32(firstBit)];
        if ((threatenedPiece.pieceCode & 7) === 1) {
            firstAttacker.threatValue += checkBonus;
        } else if (guardMask[sq] === 0) {
            firstAttacker.threatValue += threatenedPiece.materialValue;
        } else if (attackers === firstBit) {
            const sseScore = threatenedPiece.materialValue - firstAttacker.materialValue;
            if (sseScore > 0) firstAttacker.threatValue += sseScore * 0.5;
        } else {
            const sseScore = calculateStaticExchangeScoreFromMasks(
                threatenedPiece, piecesInfo, attackMask, guardMask
            );
            if (sseScore > 0) firstAttacker.threatValue += sseScore * 0.5;
        }
    }

    for (let gi = 0; gi < count; gi++) {
        const general = piecesInfo[gi];
        if ((general.pieceCode & 7) !== 1) continue;
        const isRed = general.pieceCode < 8;
        const enemyBits = isRed ? scratchBlackAttack : scratchRedAttack;
        const destinations = SEARCH_GENERAL_DEST[isRed ? 0 : 1][general.sq];
        for (let i = 0; i < destinations.length; i++) {
            const sq = destinations[i];
            if (squareCodes[sq] === 0 && hasAttackBit(enemyBits, sq)) {
                general.safetyValue -= 50;
            }
        }
    }

    let redThreat = 0;
    let redSafety = 0;
    let redMobility = 0;
    let blackThreat = 0;
    let blackSafety = 0;
    let blackMobility = 0;
    for (let i = 0; i < count; i++) {
        const info = piecesInfo[i];
        if (info.pieceCode < 8) {
            redThreat += info.threatValue;
            redSafety += info.safetyValue;
            redMobility += info.mobilityValue;
        } else {
            blackThreat += info.threatValue;
            blackSafety += info.safetyValue;
            blackMobility += info.mobilityValue;
        }
    }

    const redTotal =
        pieceState.redMaterial * VALUE_WEIGHTS.material +
        pieceState.redPosition * VALUE_WEIGHTS.position +
        redThreat * VALUE_WEIGHTS.threat +
        redSafety * VALUE_WEIGHTS.safety +
        redMobility * VALUE_WEIGHTS.mobility;
    const blackTotal =
        pieceState.blackMaterial * VALUE_WEIGHTS.material +
        pieceState.blackPosition * VALUE_WEIGHTS.position +
        blackThreat * VALUE_WEIGHTS.threat +
        blackSafety * VALUE_WEIGHTS.safety +
        blackMobility * VALUE_WEIGHTS.mobility;

    if (SEARCH_PROFILE) {
        perfStats.fastLeafEvalCount++;
        perfStats.fastLeafEvalMs += performance.now() - __t0;
    } else {
        perfStats.fastLeafEvalCount++;
    }
    return searchInitiator === 'red' ? redTotal - blackTotal : blackTotal - redTotal;
};

// 搜索用净分：完整形势评估（关系/威胁/安全/机动），仅跳过终局着法枚举；带 Zobrist 缓存
const staticSearchEval = (board, searchInitiator, gameStage, boardHash = 0) => {
    const cacheKey = zobristHasher.evalCacheKeyFromHash(boardHash, searchInitiator, gameStage);
    if (evalCache.has(cacheKey)) {
        if (SEARCH_PROFILE) perfStats.staticEvalCacheHits++;
        return evalCache.get(cacheKey);
    }
    if (SEARCH_PROFILE) perfStats.staticEvalCacheMisses++;
    let net;
    if (!SEARCH_COLLECT_MOVE_SEQUENCE) {
        net = evaluatePlayLeafNumeric(board, searchInitiator, gameStage);
    } else {
        const evalResult = evaluateBoard(board, searchInitiator, gameStage, { forSearchLeaf: true });
        const opponent = searchInitiator === 'red' ? 'black' : 'red';
        net = evalResult[searchInitiator].total - evalResult[opponent].total;
    }
    if (evalCache.size >= EVAL_CACHE_MAX) {
        // 简单淘汰最早写入的一批，避免 Map 无限涨
        let drop = 0;
        for (const k of evalCache.keys()) {
            evalCache.delete(k);
            if (++drop >= 4096) break;
        }
    }
    evalCache.set(cacheKey, net);
    return net;
};

// 生成当前方吃子着（供静默搜索）
const generateCapturesForSearch = (board, currentPlayer) => {
    const __t0 = SEARCH_PROFILE ? performance.now() : 0;
    if (SEARCH_PROFILE) perfStats.captureGenCount++;
    const captures = [];
    const pieceState = activePieceStateFor(board);
    if (pieceState) {
        const records = pieceState.records;
        const squareToSlot = pieceState.squareToSlot;
        const squareCodes = pieceState.squareCodes;
        const pieceCodes = pieceState.pieceCodes;
        for (let sq = 0; sq < REL_SQUARES; sq++) {
            const slot = squareToSlot[sq];
            if (slot < 0) continue;
            const record = records[slot];
            if (!record.alive || record.piece.color !== currentPlayer) continue;
            perfStats.pseudoMovesGenerated += appendSearchPseudoMovesForPiece(
                captures, sq, pieceCodes[slot], squareCodes, true
            );
        }
        if (SEARCH_PROFILE) perfStats.captureGenMs += performance.now() - __t0;
        return captures;
    }
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const piece = board[r][c];
            if (!piece || piece.color !== currentPlayer) continue;
            const from = { r, c };
            const pseudo = getPieceMoves(board, from, piece);
            perfStats.pseudoMovesGenerated += pseudo.length;
            for (let i = 0; i < pseudo.length; i++) {
                const to = pseudo[i];
                if (board[to.r][to.c]) captures.push(encodeMoveFromCoords(r, c, to.r, to.c));
            }
        }
    }
    if (SEARCH_PROFILE) perfStats.captureGenMs += performance.now() - __t0;
    return captures;
};

// 静默搜索：stand-pat 用完整形势评估；仅对吃子延伸（QS≤3）
// Play search has no PV to retain, so keep its recursive hot path primitive-only.
// Analysis continues to use the object-returning functions below.
const sortCapturesPlay = (captures, board, gameStage) => {
    const pieceState = activePieceStateFor(board);
    const squareToSlot = pieceState && pieceState.squareToSlot;
    const pieceCodes = pieceState && pieceState.pieceCodes;
    const materialValues = pieceState ? pieceState.materialValues : searchMaterialTable(gameStage);

    for (let index = 0; index < captures.length; index++) {
        const move = captures[index];
        const fromSq = move >>> 7;
        const toSq = move & MOVE_TO_MASK;
        let score;
        if (pieceState) {
            score = materialValues[pieceCodes[squareToSlot[toSq]] & 7] * 16 -
                materialValues[pieceCodes[squareToSlot[fromSq]] & 7];
        } else {
            score =
                getMaterialValue(board[moveToR(move)][moveToC(move)], gameStage) * 16 -
                getMaterialValue(board[moveFromR(move)][moveFromC(move)], gameStage);
        }
        captureSortScoreScratch[index] = score;
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

const quiescencePlay = (
    b, alpha, beta, maximizing, currentPlayer,
    searchInitiator, gameStage, qsDepth, boardHash = 0
) => {
    if (SEARCH_PROFILE) perfStats.quiescenceCalls++;
    const standPat = staticSearchEval(b, searchInitiator, gameStage, boardHash);

    if (qsDepth <= 0) return standPat;

    if (maximizing) {
        if (standPat >= beta) return standPat;
        if (standPat > alpha) alpha = standPat;
    } else {
        if (standPat <= alpha) return standPat;
        if (standPat < beta) beta = standPat;
    }

    const captures = generateCapturesForSearch(b, currentPlayer);
    if (SEARCH_PROFILE) perfStats.quiescenceCaptureMoves += captures.length;
    if (captures.length === 0) return standPat;

    sortCapturesPlay(captures, b, gameStage);

    let bestEval = standPat;
    for (let i = 0; i < captures.length; i++) {
        const move = captures[i];
        const movingPiece = b[moveFromR(move)][moveFromC(move)];
        const captured = makeSearchMove(b, move);
        if (leavesOwnKingUnsafe(b, currentPlayer)) {
            unmakeSearchMove(b, move, captured);
            perfStats.illegalMovesSkipped++;
            continue;
        }
        const nextHash = childBoardHash(boardHash, move, movingPiece, captured);
        perfStats.legalMovesSearched++;
        const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';
        const value = quiescencePlay(
            b, alpha, beta, nextPlayer === searchInitiator, nextPlayer,
            searchInitiator, gameStage, qsDepth - 1, nextHash
        );
        unmakeSearchMove(b, move, captured);

        if (maximizing) {
            if (value > bestEval) bestEval = value;
            if (value > alpha) alpha = value;
        } else {
            if (value < bestEval) bestEval = value;
            if (value < beta) beta = value;
        }
        if (beta <= alpha) break;
    }
    return bestEval;
};

const alphaBetaPlay = (
    b, d, alpha, beta, maximizing, currentPlayer,
    searchDepth = 0, searchInitiator = currentPlayer, gameStage = 'mid', boardHash = 0
) => {
    const originalAlpha = alpha;
    const originalBeta = beta;

    perfStats.alphaBetaCalls++;
    if (!perfStats.nodesSearched[d]) perfStats.nodesSearched[d] = 0;
    perfStats.nodesSearched[d]++;

    if (d === 0) {
        return quiescencePlay(
            b, alpha, beta, maximizing, currentPlayer,
            searchInitiator, gameStage, SEARCH_QUIESCENCE_DEPTH, boardHash
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

    const searchInfo = prepareSearchInfo(b, currentPlayer);
    const abPiecesInfo = searchInfo.piecesInfo;
    const abBoardInfo = searchInfo.boardInfo;
    const inCheck = searchInfo.inCheck ||
        (currentPlayer === 'red' && abBoardInfo.redIsInCheck) ||
        (currentPlayer === 'black' && abBoardInfo.blackIsInCheck);
    const terminalScore = () => {
        const isInitiatorWinner = currentPlayer !== searchInitiator;
        const baseScore = isInitiatorWinner ? 100000 : -100000;
        return baseScore + (isInitiatorWinner ? d : (searchDepth - d));
    };

    if (!searchInfo.legalMoveList || searchInfo.legalMoveList.length === 0) {
        const gameState = abBoardInfo.gameState;
        if (gameState && (gameState.status === 'checkmate' || gameState.status === 'stalemate')) {
            const isInitiatorWinner = gameState.winner === searchInitiator;
            const baseScore = isInitiatorWinner ? 100000 : -100000;
            return baseScore + (isInitiatorWinner ? d : (searchDepth - d));
        }
        return terminalScore();
    }

    let moves = searchInfo.legalMoveList;
    if (!perfStats.movesGenerated[d]) perfStats.movesGenerated[d] = 0;
    perfStats.movesGenerated[d] += moves.length;

    const killersAtDepth = killerMoves[d] || [null, null];
    moves = sortMovesPlay(
        moves, b, currentPlayer, abPiecesInfo, gameStage, abBoardInfo,
        ttMove, killersAtDepth, inCheck
    );
    if (SEARCH_COLLECT_METRICS && moves.length) {
        recordTopMoveSource(d, b, moves[0], ttMove, killersAtDepth);
    }

    let bestEval = maximizing ? -Infinity : Infinity;
    let bestMove = null;
    let legalMovesFound = 0;

    for (let moveIndex = 0; moveIndex < moves.length; moveIndex++) {
        const move = moves[moveIndex];
        const isCapture = !!b[moveToR(move)][moveToC(move)];
        const movingPiece = b[moveFromR(move)][moveFromC(move)];
        const captured = makeSearchMove(b, move);
        if (leavesOwnKingUnsafe(b, currentPlayer, move, inCheck)) {
            unmakeSearchMove(b, move, captured);
            perfStats.illegalMovesSkipped++;
            continue;
        }
        const nextHash = childBoardHash(boardHash, move, movingPiece, captured);
        legalMovesFound++;
        if (SEARCH_COLLECT_METRICS && legalMovesFound === 1) {
            recordFirstLegalMove(d, moveIndex);
        }
        perfStats.legalMovesSearched++;
        const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';
        const nextMaximizing = nextPlayer === searchInitiator;
        const canProbe = SEARCH_ENABLE_NON_ROOT_PVS &&
            legalMovesFound > 1 &&
            Number.isFinite(maximizing ? alpha : beta);
        let value;
        if (canProbe) {
            if (SEARCH_COLLECT_METRICS) {
                perfStats.pvsProbes++;
            }
            const probeStartNodes = SEARCH_COLLECT_METRICS ? perfStats.alphaBetaCalls : 0;
            value = maximizing
                ? alphaBetaPlay(
                    b, d - 1, alpha, alpha + SEARCH_NULL_WINDOW_EPS, nextMaximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, nextHash
                )
                : alphaBetaPlay(
                    b, d - 1, beta - SEARCH_NULL_WINDOW_EPS, beta, nextMaximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, nextHash
                );
            if (SEARCH_COLLECT_METRICS) {
                perfStats.pvsProbeNodes += perfStats.alphaBetaCalls - probeStartNodes;
            }

            const needsResearch = maximizing
                ? value > alpha && value < beta
                : value < beta && value > alpha;
            if (needsResearch) {
                if (SEARCH_COLLECT_METRICS) {
                    perfStats.pvsResearches++;
                }
                const researchStartNodes = SEARCH_COLLECT_METRICS ? perfStats.alphaBetaCalls : 0;
                value = alphaBetaPlay(
                    b, d - 1, alpha, beta, nextMaximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, nextHash
                );
                if (SEARCH_COLLECT_METRICS) {
                    perfStats.pvsResearchNodes += perfStats.alphaBetaCalls - researchStartNodes;
                }
            }
        } else {
            value = alphaBetaPlay(
                b, d - 1, alpha, beta, nextMaximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, nextHash
            );
        }
        unmakeSearchMove(b, move, captured);

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
            if (!perfStats.cutoffs[d]) perfStats.cutoffs[d] = 0;
            perfStats.cutoffs[d]++;
            if (SEARCH_COLLECT_METRICS && legalMovesFound === 1) {
                recordFirstLegalCutoff(d);
            }
            if (!isCapture) {
                storeKillerMove(d, move);
                addHistoryScore(move, d);
            }
            break;
        }
    }

    if (legalMovesFound === 0) return terminalScore();

    let flag;
    if (bestEval <= originalAlpha) flag = 'upperbound';
    else if (bestEval >= originalBeta) flag = 'lowerbound';
    else flag = 'exact';
    transpositionTable.store(ttKey, d, bestEval, flag, bestMove, null);
    return bestEval;
};

const quiescence = (
    b, alpha, beta, maximizing, currentPlayer,
    searchInitiator, gameStage, qsDepth, boardHash = 0
) => {
    if (SEARCH_PROFILE) perfStats.quiescenceCalls++;
    const standPat = staticSearchEval(b, searchInitiator, gameStage, boardHash);

    if (qsDepth <= 0) {
        return { value: standPat, moveSequence: [] };
    }

    if (maximizing) {
        if (standPat >= beta) {
            return { value: standPat, moveSequence: [] };
        }
        if (standPat > alpha) {
            alpha = standPat;
        }
    } else {
        if (standPat <= alpha) {
            return { value: standPat, moveSequence: [] };
        }
        if (standPat < beta) {
            beta = standPat;
        }
    }

    let captures = generateCapturesForSearch(b, currentPlayer);
    if (SEARCH_PROFILE) perfStats.quiescenceCaptureMoves += captures.length;
    if (captures.length === 0) {
        return { value: standPat, moveSequence: [] };
    }

    // MVV-LVA：先试吃大子
    captures.sort((a, bMove) => {
        const scoreA =
            getMaterialValue(b[moveToR(a)][moveToC(a)], gameStage) * 16 -
            getMaterialValue(b[moveFromR(a)][moveFromC(a)], gameStage);
        const scoreB =
            getMaterialValue(b[moveToR(bMove)][moveToC(bMove)], gameStage) * 16 -
            getMaterialValue(b[moveFromR(bMove)][moveFromC(bMove)], gameStage);
        return scoreB - scoreA;
    });

    let bestEval = standPat;
    let bestMoveSequence = [];

    for (let i = 0; i < captures.length; i++) {
        const move = captures[i];
        const movingPiece = b[moveFromR(move)][moveFromC(move)];
        const captured = makeSearchMove(b, move);
        if (leavesOwnKingUnsafe(b, currentPlayer)) {
            unmakeSearchMove(b, move, captured);
            perfStats.illegalMovesSkipped++;
            continue;
        }
        const nextHash = childBoardHash(boardHash, move, movingPiece, captured);
        perfStats.legalMovesSearched++;
        const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';
        const nextMaximizing = nextPlayer === searchInitiator;
        const result = quiescence(
            b, alpha, beta, nextMaximizing, nextPlayer,
            searchInitiator, gameStage, qsDepth - 1, nextHash
        );
        unmakeSearchMove(b, move, captured);

        if (maximizing) {
            if (result.value > bestEval) {
                bestEval = result.value;
                if (SEARCH_COLLECT_MOVE_SEQUENCE) {
                    bestMoveSequence = [moveToObject(move), ...(result.moveSequence || [])];
                }
            }
            if (result.value > alpha) {
                alpha = result.value;
            }
        } else {
            if (result.value < bestEval) {
                bestEval = result.value;
                if (SEARCH_COLLECT_MOVE_SEQUENCE) {
                    bestMoveSequence = [moveToObject(move), ...(result.moveSequence || [])];
                }
            }
            if (result.value < beta) {
                beta = result.value;
            }
        }
        if (beta <= alpha) {
            break;
        }
    }

    return { value: bestEval, moveSequence: SEARCH_COLLECT_MOVE_SEQUENCE ? bestMoveSequence : [] };
};

// alphaBeta：评估始终从 searchInitiator 角度；TT + killer/history + 空着剪枝 + LMR + QS
// boardHash：增量 Zobrist 局面哈希（不含行棋方）；旧模式下可传 0
const alphaBeta = (
    b, d, alpha, beta, maximizing, currentPlayer,
    searchDepth = 0, searchInitiator = currentPlayer, gameStage = 'mid',
    allowNull = true, boardHash = 0
) => {
    const originalAlpha = alpha;
    const originalBeta = beta;

    perfStats.alphaBetaCalls++;
    if (!perfStats.nodesSearched[d]) perfStats.nodesSearched[d] = 0;
    perfStats.nodesSearched[d]++;

    // 叶节点：完整形势评估 + 吃子静默搜索
    if (d === 0) {
        return quiescence(
            b, alpha, beta, maximizing, currentPlayer,
            searchInitiator, gameStage, SEARCH_QUIESCENCE_DEPTH, boardHash
        );
    }

    // 置换表探测（key 含行棋方，避免同形不同走方冲突）
    const ttKey = makeSearchTTKey(b, currentPlayer, boardHash);
    const ttEntry = transpositionTable.retrieve(ttKey);
    let ttMove = null;
    if (ttEntry) {
        ttMove = ttEntry.bestMove || null;
        if (ttEntry.depth >= d) {
            if (ttEntry.flag === 'exact') {
                return {
                    value: ttEntry.value,
                    moveSequence: SEARCH_COLLECT_MOVE_SEQUENCE
                        ? (ttEntry.moveSequence || (ttMove ? [moveToObject(ttMove)] : []))
                        : []
                };
            }
            if (ttEntry.flag === 'lowerbound' && ttEntry.value >= beta) {
                return { value: ttEntry.value, moveSequence: [] };
            }
            if (ttEntry.flag === 'upperbound' && ttEntry.value <= alpha) {
                return { value: ttEntry.value, moveSequence: [] };
            }
        }
    }

    const searchInfo = prepareSearchInfo(b, currentPlayer);
    const abPiecesInfo = searchInfo.piecesInfo;
    const abBoardInfo = searchInfo.boardInfo;
    const currentPlayerColor = currentPlayer;
    const inCheck = searchInfo.inCheck ||
                    (currentPlayerColor === 'red' && abBoardInfo.redIsInCheck) ||
                    (currentPlayerColor === 'black' && abBoardInfo.blackIsInCheck);

    const terminalScore = (mateInCheck) => {
        const isInitiatorWinner = currentPlayerColor !== searchInitiator;
        const baseScore = isInitiatorWinner ? 100000 : -100000;
        return {
            value: baseScore + (isInitiatorWinner ? d : (searchDepth - d)),
            moveSequence: [],
            terminal: mateInCheck ? 'checkmate' : 'stalemate'
        };
    };

    // 无伪合法着：直接终局（极少见；通常至少有将的走动）
    if (!searchInfo.legalMoveList || searchInfo.legalMoveList.length === 0) {
        const gameState = abBoardInfo.gameState;
        if (gameState && (gameState.status === 'checkmate' || gameState.status === 'stalemate')) {
            const isInitiatorWinner = gameState.winner === searchInitiator;
            const baseScore = isInitiatorWinner ? 100000 : -100000;
            const stepsFromRoot = searchDepth - d;
            return { value: baseScore + (isInitiatorWinner ? d : stepsFromRoot), moveSequence: [] };
        }
        return terminalScore(inCheck);
    }

    // 空着剪枝：仅 maximizing；完整评估下保守启用
    if (
        false &&
        allowNull &&
        maximizing &&
        d >= 3 &&
        !inCheck &&
        canDoNullMove(b, currentPlayerColor)
    ) {
        const nullR = d >= 6 ? 3 : 2;
        const nullDepth = d - 1 - nullR;
        if (nullDepth >= 0) {
            const nullPlayer = currentPlayerColor === 'red' ? 'black' : 'red';
            const nullMaximizing = nullPlayer === searchInitiator;
            // 空着不改变局面哈希，仅行棋方变化（TT key 含 side）
            const nullResult = alphaBeta(
                b, nullDepth, beta - 1e-6, beta, nullMaximizing, nullPlayer,
                searchDepth, searchInitiator, gameStage, false, boardHash
            );
            if (nullResult.value >= beta) {
                return { value: nullResult.value, moveSequence: [] };
            }
        }
    }

    let moves = searchInfo.legalMoveList;

    if (!perfStats.movesGenerated[d]) perfStats.movesGenerated[d] = 0;
    perfStats.movesGenerated[d] += moves.length;

    const killersAtDepth = (killerMoves[d] || [null, null]);
    moves = sortMovesFast(moves, b, currentPlayerColor, abPiecesInfo, gameStage, abBoardInfo, {
        ttMove,
        killers: killersAtDepth
    });
    if (SEARCH_COLLECT_METRICS && moves.length) {
        recordTopMoveSource(d, b, moves[0], ttMove, killersAtDepth);
    }

    const storeTT = (value, bestMove, moveSequence) => {
        let flag;
        if (value <= originalAlpha) flag = 'upperbound';
        else if (value >= originalBeta) flag = 'lowerbound';
        else flag = 'exact';
        transpositionTable.store(ttKey, d, value, flag, bestMove, SEARCH_COLLECT_MOVE_SEQUENCE ? moveSequence : null);
    };

    let bestEval = maximizing ? -Infinity : Infinity;
    let bestMove = null;
    let bestMoveSequence = [];
    let legalMovesFound = 0;

    for (let moveIndex = 0; moveIndex < moves.length; moveIndex++) {
        const move = moves[moveIndex];
        const isCapture = !!b[moveToR(move)][moveToC(move)];
        const isTTMove = ttMove && isSameMove(move, ttMove);
        const isKiller =
            isSameMove(move, killersAtDepth[0]) ||
            isSameMove(move, killersAtDepth[1]);

        // LMR：靠后的安静着法降深 1（完整评估下保守）
        // moveIndex 含伪合法序；非法着跳过后略偏保守（少降深），不影响正确性
        let reduction = 0;
        if (
            false &&
            d >= 4 &&
            moveIndex >= 4 &&
            !inCheck &&
            !isCapture &&
            !isTTMove &&
            !isKiller
        ) {
            reduction = 1;
        }

        const movingPiece = b[moveFromR(move)][moveFromC(move)];
        const captured = makeSearchMove(b, move);
        if (leavesOwnKingUnsafe(b, currentPlayerColor, move, inCheck)) {
            unmakeSearchMove(b, move, captured);
            perfStats.illegalMovesSkipped++;
            continue;
        }
        const nextHash = childBoardHash(boardHash, move, movingPiece, captured);
        legalMovesFound++;
        if (SEARCH_COLLECT_METRICS && legalMovesFound === 1) {
            recordFirstLegalMove(d, moveIndex);
        }
        perfStats.legalMovesSearched++;

        const nextPlayer = currentPlayer === 'red' ? 'black' : 'red';
        const nextMaximizing = nextPlayer === searchInitiator;

        let result;
        if (reduction > 0) {
            const reducedDepth = Math.max(0, d - 1 - reduction);
            result = alphaBeta(
                b, reducedDepth, alpha, beta, nextMaximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, true, nextHash
            );
            const needResearch = maximizing
                ? result.value > alpha
                : result.value < beta;
            if (needResearch) {
                result = alphaBeta(
                    b, d - 1, alpha, beta, nextMaximizing, nextPlayer,
                    searchDepth, searchInitiator, gameStage, true, nextHash
                );
            }
        } else {
            result = alphaBeta(
                b, d - 1, alpha, beta, nextMaximizing, nextPlayer,
                searchDepth, searchInitiator, gameStage, true, nextHash
            );
        }

        unmakeSearchMove(b, move, captured);

        if (maximizing) {
            if (result.value > bestEval) {
                bestEval = result.value;
                bestMove = move;
                if (SEARCH_COLLECT_MOVE_SEQUENCE) {
                    bestMoveSequence = [moveToObject(move), ...result.moveSequence];
                }
            }
            alpha = Math.max(alpha, result.value);
        } else {
            if (result.value < bestEval) {
                bestEval = result.value;
                bestMove = move;
                if (SEARCH_COLLECT_MOVE_SEQUENCE) {
                    bestMoveSequence = [moveToObject(move), ...result.moveSequence];
                }
            }
            beta = Math.min(beta, result.value);
        }

        if (beta <= alpha) {
            if (!perfStats.cutoffs[d]) perfStats.cutoffs[d] = 0;
            perfStats.cutoffs[d]++;
            if (SEARCH_COLLECT_METRICS && legalMovesFound === 1) {
                recordFirstLegalCutoff(d);
            }
            if (!isCapture) {
                storeKillerMove(d, move);
                addHistoryScore(move, d);
            }
            break;
        }
    }

    // 延迟合法性：伪合法非空但无一合法 → 将死/困毙
    if (legalMovesFound === 0) {
        return terminalScore(inCheck);
    }

    storeTT(bestEval, bestMove, bestMoveSequence);
    return { value: bestEval, moveSequence: SEARCH_COLLECT_MOVE_SEQUENCE ? bestMoveSequence : [] };
};

// exactRootScores: true=Analysis 全根精确分；false=对弈标准 PVS（fail-low 不回搜）
const getBestMoveInternal = (board, turn, depth = 8, ply = 0, enableTimeLimit = false, exactRootScores = false, collectMoveSequenceOverride = null) => {
  const timeLimit = 5000;

  // First try to get move from opening book
  const bookMove = openingBook.getBookMove(board, ply);
  
  if (bookMove) {
    // Check if bookMove is valid for current board
    if (bookMove.from && bookMove.to && 
        typeof bookMove.from.r === 'number' && typeof bookMove.from.c === 'number' &&
        typeof bookMove.to.r === 'number' && typeof bookMove.to.c === 'number') {
      
      const movingPiece = board[bookMove.from.r][bookMove.from.c];
      
      if (movingPiece && movingPiece.color === turn) {
        // Verify move is valid
        const validDestinations = getValidMoves(board, bookMove.from);
        const isValid = validDestinations.some(dest => dest.r === bookMove.to.r && dest.c === bookMove.to.c);
        
        if (isValid) {
          return { bestMove: bookMove, secondBestMove: null, moveSequence: [], secondMoveSequence: [], bestMoveScore: 0, secondBestMoveScore: 0, allMovesWithScores: [] };
        }
      }
    }
  }

  // 根节点：迭代加深 + PVS；TT/killer/history 跨深度保留（仅开局清空一次）
  resetPerfStats();
  const startTime = Date.now();
  transpositionTable.resetStats();
  transpositionTable.clear();
  clearEvalCache();
  const maxDepth = Math.max(1, depth | 0);
  resetSearchHeuristics(maxDepth);
  syncGeneralPosCache(board);
  SEARCH_COLLECT_MOVE_SEQUENCE = typeof collectMoveSequenceOverride === 'boolean'
    ? collectMoveSequenceOverride
    : !!exactRootScores;

  const phase = getGamePhase();
  const gameStage = phase === 'opening' ? 'early' : phase === 'middlegame' ? 'mid' : 'late';

  const rootEvalResult = evaluateBoard(board, turn, gameStage, {
    palaceControlOnly: !exactRootScores
  });
  const rootPiecesInfo = rootEvalResult.piecesInfo;
  const rootBoardInfo = rootEvalResult.boardInfo;

  // 收集根节点走法（只做一次）；未被将时过滤送吃
  let rootMoves = [];
  //const rootInCheck = (turn === 'red' && rootBoardInfo.redIsInCheck) ||
  //                    (turn === 'black' && rootBoardInfo.blackIsInCheck);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]?.color === turn) {
        const piece = board[r][c];
        const validDestinations = getValidMoves(board, { r, c });
        validDestinations.forEach(to => {
          //const isAcceptable = rootInCheck || isPositionAcceptable(board, { r, c }, to, turn, rootBoardInfo, rootPiecesInfo, piece, gameStage);
          //if (isAcceptable) {
            rootMoves.push({ from: { r, c }, to, score: 0, moveSequence: [] });
          //}
        });
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

  const sortRootMovesByScore = (moves) => {
    moves.sort((a, b) => {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) < 1e-6) {
        if (a.score > 0) {
          return (a.moveSequence?.length || 0) - (b.moveSequence?.length || 0);
        }
        if (a.score < 0) {
          return (b.moveSequence?.length || 0) - (a.moveSequence?.length || 0);
        }
        return 0;
      }
      return scoreDiff;
    });
  };

  const promoteRootMove = (moves, preferred) => {
    if (!preferred) return;
    const idx = moves.findIndex((m) => isSameMove(m, preferred));
    if (idx > 0) {
      const [hit] = moves.splice(idx, 1);
      moves.unshift(hit);
    }
  };

  const workBoard = board.map((row) => [...row]);
  activeSearchPieceState = createSearchPieceState(workBoard, gameStage);
  const NULL_WINDOW_EPS = 1e-6;
  const nextTurn = turn === 'red' ? 'black' : 'red';
  // 根局面哈希只算一次；增量模式整棵搜索树由此派生
  const rootHash = zobristHasher.hash(board);
  perfStats.fullHashCount++;
  const rootTTKey = zobristHasher.ttKeyFromHash(rootHash, turn);

  let completedDepth = 0;

  for (let currentDepth = 1; currentDepth <= maxDepth; currentDepth++) {
    if (enableTimeLimit && completedDepth > 0 && Date.now() - startTime > timeLimit) {
      console.log(`ID stopped before depth ${currentDepth} due to time limit (last completed=${completedDepth})`);
      break;
    }

    // 浅层最佳着 + TT 着排到最前，供本层 PVS 第一着全窗使用
    const ttEntry = transpositionTable.retrieve(rootTTKey);
    const ttMove = ttEntry && ttEntry.bestMove ? ttEntry.bestMove : null;
    const prevBest = rootMoves[0];
    sortMovesFast(rootMoves, board, turn, rootPiecesInfo, gameStage, rootBoardInfo, {
      ttMove,
      killers: killerMoves[Math.max(0, currentDepth - 1)] || [null, null]
    });
    // 上一层最佳着放第一（最后 promote），保证本层 PVS 首着全窗命中热路径
    promoteRootMove(rootMoves, ttMove);
    promoteRootMove(rootMoves, prevBest);

    const useExactRoot = exactRootScores && currentDepth === maxDepth;
    const usePlaySearch = !exactRootScores;
    let rootAlpha = -Infinity;

    for (let i = 0; i < rootMoves.length; i++) {
      const item = rootMoves[i];
      const movingPiece = workBoard[item.from.r][item.from.c];
      const captured = makeMove(workBoard, item.from, item.to);
      const childHash = childBoardHash(rootHash, item, movingPiece, captured);

      let alphaBetaResult;
      let score;
      let scoreIsExact = true;
      if (i === 0 || rootAlpha === -Infinity) {
        if (usePlaySearch) {
          score = alphaBetaPlay(
            workBoard, currentDepth - 1, -Infinity, Infinity,
            false, nextTurn, currentDepth, turn, gameStage, childHash
          );
        } else {
          alphaBetaResult = alphaBeta(
            workBoard, currentDepth - 1, -Infinity, Infinity,
            false, nextTurn, currentDepth, turn, gameStage, true, childHash
          );
          score = alphaBetaResult.value;
        }
      } else {
        let probe;
        if (usePlaySearch) {
          probe = alphaBetaPlay(
            workBoard, currentDepth - 1,
            rootAlpha, rootAlpha + NULL_WINDOW_EPS,
            false, nextTurn, currentDepth, turn, gameStage, childHash
          );
        } else {
          alphaBetaResult = alphaBeta(
            workBoard, currentDepth - 1,
            rootAlpha, rootAlpha + NULL_WINDOW_EPS,
            false, nextTurn, currentDepth, turn, gameStage, true, childHash
          );
          probe = alphaBetaResult.value;
        }
        if (probe > rootAlpha) {
          if (usePlaySearch) {
            score = alphaBetaPlay(
              workBoard, currentDepth - 1, rootAlpha, Infinity,
              false, nextTurn, currentDepth, turn, gameStage, childHash
            );
          } else {
            alphaBetaResult = alphaBeta(
              workBoard, currentDepth - 1, rootAlpha, Infinity,
              false, nextTurn, currentDepth, turn, gameStage, true, childHash
            );
            score = alphaBetaResult.value;
          }
        } else if (useExactRoot) {
          alphaBetaResult = alphaBeta(
            workBoard, currentDepth - 1, -Infinity, Infinity,
            false, nextTurn, currentDepth, turn, gameStage, true, childHash
          );
          score = alphaBetaResult.value;
        } else {
          // fail-low：探测分只是上界，不能当精确分写入（否则 ID 下层排序被污染，易反复走炮）
          score = probe;
          scoreIsExact = false;
        }
      }

      unmakeMove(workBoard, item.from, item.to, captured);

      if (scoreIsExact) {
        item.score = score;
        item.moveSequence = SEARCH_COLLECT_MOVE_SEQUENCE
          ? [{ from: item.from, to: item.to }, ...(alphaBetaResult.moveSequence || [])]
          : [];
        if (item.score > rootAlpha) {
          rootAlpha = item.score;
        }
      } else if (item.score > rootAlpha) {
        // 保留上一层分数；若仍高于当前 α（异常），略降以免挤掉真最优
        item.score = rootAlpha - 1e-3;
      }
    }

    sortRootMovesByScore(rootMoves);
    completedDepth = currentDepth;

    // 把本层最佳着写入 TT，供更深一层根排序
    transpositionTable.store(
      rootTTKey,
      currentDepth,
      rootMoves[0].score,
      'exact',
      rootMoves[0],
      SEARCH_COLLECT_MOVE_SEQUENCE ? (rootMoves[0].moveSequence || []) : null
    );

  }

  const bestMove = rootMoves[0] || null;
  const secondBestMove = rootMoves.length > 1 ? rootMoves[1] : null;
  const bestMoveSequence = bestMove ? (bestMove.moveSequence || []) : [];
  const secondMoveSequence = secondBestMove ? (secondBestMove.moveSequence || []) : [];
  const bestMoveScore = bestMove ? bestMove.score : 0;
  const secondBestMoveScore = secondBestMove ? secondBestMove.score : 0;

  const allMovesWithScores = rootMoves.map((moveInfo) => ({
    move: {
      from: moveInfo.from,
      to: moveInfo.to
    },
    score: moveInfo.score,
    moveSequence: moveInfo.moveSequence || []
  }));

  const result = {
    bestMove,
    secondBestMove,
    moveSequence: bestMoveSequence,
    secondMoveSequence,
    bestMoveScore,
    secondBestMoveScore,
    allMovesWithScores,
    completedDepth
  };
  activeSearchPieceState = null;
  return result;
};

// Play keeps root fail-low probes as bounds; analysis re-searches every final
// root move and retains PV data. Keeping their entry points separate prevents
// future play-path work from silently changing analysis semantics.
const getBestMoveForPlay = (board, turn, depth, ply, enableTimeLimit) =>
  getBestMoveInternal(board, turn, depth, ply, enableTimeLimit, false, false);

const getBestMoveForAnalysis = (board, turn, depth, ply, enableTimeLimit) =>
  getBestMoveInternal(board, turn, depth, ply, enableTimeLimit, true, true);

const getBestMove = (board, turn, depth = 8, ply = 0, enableTimeLimit = false, exactRootScores = false) =>
  exactRootScores
    ? getBestMoveForAnalysis(board, turn, depth, ply, enableTimeLimit)
    : getBestMoveForPlay(board, turn, depth, ply, enableTimeLimit);

// --- WORKER LISTENER (统一消息处理) ---
