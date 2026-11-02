/* eslint-disable no-restricted-globals */

// UI 路径：点棋、评估面板、合法着、终局。不进入搜索热路径。

import { COLS, REL_SQUARES, ROWS, SQ_COL, SQ_ROW } from './board.js';
import { searchProfile } from './search-context.js';
import {
    ADVISOR_DEST,
    ELEPHANT_DEST,
    GENERAL_DEST,
    HORSE_DEST,
    ORTH_DIRS,
    SEARCH_POSITION_VALUES,
    SIDE_RED,
    SOLDIER_DEST,
    VALUE_WEIGHTS,
    activePieceStateFor,
    activeSearchPieceState,
    calculateStaticExchangeScoreFromMasks,
    collectCheckersFromState,
    collectPinnedGuardSlots,
    colorToSide,
    createRelationBoardInfo,
    getValidMovesFromSq,
    isKingInCheckFromState,
    perfStats,
    pinnedCanGuardSquare,
    runWithPieceState,
    scratchLegalCheckInfo,
    searchMaterialTable,
    sideToColor
} from './search.js';

const CHECK_BONUS = 50;
const MOBILITY_BASE = 1;
const lowestSetBitIndex = (mask) => 31 - Math.clz32(mask & -mask);
const setAttackBit = (bits, sq) => {
    bits[sq >>> 5] |= (1 << (sq & 31));
};
const hasAttackBit = (bits, sq) => (bits[sq >>> 5] & (1 << (sq & 31))) !== 0;

const makeEmptyControllerGrid = () =>
    Array(10).fill(null).map(() => Array(9).fill(null).map(() => []));

const scratchPieceAtSq = new Array(REL_SQUARES);
const clearPieceAtSq = () => {
    for (let i = 0; i < REL_SQUARES; i++) scratchPieceAtSq[i] = null;
};

const scratchRelCtx = {
    pieceIndex: 0,
    attackMask: null,
    guardMask: null,
    controlMask: null,
    redAttack: null,
    blackAttack: null
};

const collectUiPiecesInfo = (gameStage) => {
    const piecesInfo = [];
    const pieceState = activeSearchPieceState;
    const materialValues = searchMaterialTable(gameStage);
    const slotCount = pieceState ? pieceState.slotCount : 0;
    for (let slot = 0; slot < slotCount; slot++) {
        const code = pieceState.pieceCodes[slot];
        if (!code) continue;
        const sq = pieceState.pieceSquares[slot];
        piecesInfo.push({
            pieceCode: code,
            r: SQ_ROW[sq],
            c: SQ_COL[sq],
            sq,
            pieceIndex: piecesInfo.length,
            materialValue: materialValues[code & 7],
            positionValue: SEARCH_POSITION_VALUES[code][sq],
            threatValue: 0,
            safetyValue: 0,
            mobilityValue: 0,
            threat: [],
            threatenedBy: [],
            guard: [],
            guardedBy: [],
            control: []
        });
    }
    return piecesInfo;
};

const applyRelationSquare = (squareCodes, info, pieceAtSq, tr, tc, bit, relCtx, isRed) => {
    if (tr < 0 || tr >= ROWS || tc < 0 || tc >= COLS) return 0;
    const targetCode = squareCodes[tr * 9 + tc];
    if (!targetCode) {
        const sq = tr * 9 + tc;
        relCtx.controlMask[sq] |= bit;
        if (isRed) setAttackBit(relCtx.redAttack, sq);
        else setAttackBit(relCtx.blackAttack, sq);
        return MOBILITY_BASE;
    }
    if ((targetCode < 8) !== isRed) {
        if (pieceAtSq[tr * 9 + tc]) {
            relCtx.attackMask[tr * 9 + tc] |= bit;
        }
        return 0;
    }
    if ((targetCode & 7) !== 1) {
        const targetInfo = pieceAtSq[tr * 9 + tc];
        if (targetInfo && targetInfo !== info) {
            relCtx.guardMask[tr * 9 + tc] |= bit;
        }
    }
    return 0;
};

const fillNonCannonRelations = (squareCodes, info, pieceAtSq, relCtx) => {
    const { r, c, pieceCode } = info;
    const isRed = pieceCode < 8;
    const bit = 1 << relCtx.pieceIndex;
    const colorIdx = isRed ? 0 : 1;
    const fromSq = r * 9 + c;
    let mobilityValue = 0;

    switch (pieceCode & 7) {
        case 1: {
            const dests = GENERAL_DEST[colorIdx][fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                mobilityValue += applyRelationSquare(
                    squareCodes, info, pieceAtSq, d.r, d.c, bit, relCtx, isRed
                );
            }
            break;
        }
        case 5: {
            const dests = ADVISOR_DEST[colorIdx][fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                mobilityValue += applyRelationSquare(
                    squareCodes, info, pieceAtSq, d.r, d.c, bit, relCtx, isRed
                );
            }
            break;
        }
        case 4: {
            const dests = ELEPHANT_DEST[colorIdx][fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                if (!squareCodes[d.br * 9 + d.bc]) {
                    mobilityValue += applyRelationSquare(
                        squareCodes, info, pieceAtSq, d.r, d.c, bit, relCtx, isRed
                    );
                }
            }
            break;
        }
        case 3: {
            const dests = HORSE_DEST[fromSq];
            for (let i = 0; i < dests.length; i++) {
                const d = dests[i];
                if (!squareCodes[d.br * 9 + d.bc]) {
                    mobilityValue += applyRelationSquare(
                        squareCodes, info, pieceAtSq, d.r, d.c, bit, relCtx, isRed
                    );
                }
            }
            break;
        }
        case 2:
            for (let i = 0; i < ORTH_DIRS.length; i++) {
                const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
                let nr = r + dr, nc = c + dc;
                while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
                    const targetCode = squareCodes[nr * 9 + nc];
                    if (!targetCode) {
                        const sq = nr * 9 + nc;
                        relCtx.controlMask[sq] |= bit;
                        if (isRed) setAttackBit(relCtx.redAttack, sq);
                        else setAttackBit(relCtx.blackAttack, sq);
                        mobilityValue += MOBILITY_BASE;
                    } else {
                        if ((targetCode < 8) !== isRed) {
                            if (pieceAtSq[nr * 9 + nc]) {
                                relCtx.attackMask[nr * 9 + nc] |= bit;
                            }
                        } else if ((targetCode & 7) !== 1) {
                            const targetInfo = pieceAtSq[nr * 9 + nc];
                            if (targetInfo && targetInfo !== info) {
                                relCtx.guardMask[nr * 9 + nc] |= bit;
                            }
                        }
                        break;
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
                mobilityValue += applyRelationSquare(
                    squareCodes, info, pieceAtSq, d.r, d.c, bit, relCtx, isRed
                );
            }
            break;
        }
        default:
            break;
    }
    info.mobilityValue = mobilityValue;
};

const fillCannonRelations = (squareCodes, info, pieceAtSq, relCtx) => {
    const { r, c, pieceCode } = info;
    const isRed = pieceCode < 8;
    const bit = 1 << relCtx.pieceIndex;
    let mobilityValue = 0;

    for (let i = 0; i < ORTH_DIRS.length; i++) {
        const dr = ORTH_DIRS[i][0], dc = ORTH_DIRS[i][1];
        let nr = r + dr, nc = c + dc;
        let screenFoundCount = 0;
        while (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && screenFoundCount < 2) {
            const pCode = squareCodes[nr * 9 + nc];
            if (pCode) {
                screenFoundCount++;
                if (screenFoundCount === 2) {
                    const targetInfo = pieceAtSq[nr * 9 + nc];
                    if (targetInfo && targetInfo !== info) {
                        if ((pCode < 8) !== isRed) {
                            relCtx.attackMask[nr * 9 + nc] |= bit;
                        } else if ((pCode & 7) !== 1) {
                            relCtx.guardMask[nr * 9 + nc] |= bit;
                        }
                    }
                    break;
                }
            } else if (screenFoundCount === 0) {
                mobilityValue += 1;
            } else if (screenFoundCount === 1) {
                const sq = nr * 9 + nc;
                relCtx.controlMask[sq] |= bit;
                if (isRed) setAttackBit(relCtx.redAttack, sq);
                else setAttackBit(relCtx.blackAttack, sq);
            }
            nr += dr;
            nc += dc;
        }
    }
    info.mobilityValue = mobilityValue;
};

const applyPinnedGuardFilterToRelations = (board, piecesInfo, boardInfo) => {
    runWithPieceState(board, () => {
        const state = activeSearchPieceState;
        const pinnedSlots = collectPinnedGuardSlots(state);
        if (pinnedSlots === 0) return;
        const squareToSlot = state.squareToSlot;
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
    });
};

const calculatePieceRelations = (board, piecesInfo, boardInfo) => {
    const pieceState = activeSearchPieceState;
    if (!pieceState) {
        return runWithPieceState(board, () => calculatePieceRelations(board, piecesInfo, boardInfo));
    }
    const squareCodes = pieceState.squareCodes;

    clearPieceAtSq();
    for (let i = 0; i < piecesInfo.length; i++) {
        const info = piecesInfo[i];
        if (info.pieceIndex == null) info.pieceIndex = i;
        scratchPieceAtSq[info.r * 9 + info.c] = info;
    }

    const relCtx = scratchRelCtx;
    relCtx.attackMask = boardInfo.attackMask;
    relCtx.guardMask = boardInfo.guardMask;
    relCtx.controlMask = boardInfo.controlMask;
    relCtx.redAttack = boardInfo.redAttack;
    relCtx.blackAttack = boardInfo.blackAttack;

    for (let i = 0; i < piecesInfo.length; i++) {
        const info = piecesInfo[i];
        relCtx.pieceIndex = info.pieceIndex;
        if ((info.pieceCode & 7) === 6) {
            fillCannonRelations(squareCodes, info, scratchPieceAtSq, relCtx);
        } else {
            fillNonCannonRelations(squareCodes, info, scratchPieceAtSq, relCtx);
        }
    }

    let redIsInCheck = false;
    let blackIsInCheck = false;
    let redGeneralInfo = null;
    let blackGeneralInfo = null;
    for (const info of piecesInfo) {
        if ((info.pieceCode & 7) === 1) {
            if (info.pieceCode < 8) redGeneralInfo = info;
            else blackGeneralInfo = info;
        }
    }

    if (redGeneralInfo && boardInfo.attackMask[redGeneralInfo.r * 9 + redGeneralInfo.c] !== 0) {
        redIsInCheck = true;
    }
    if (blackGeneralInfo && boardInfo.attackMask[blackGeneralInfo.r * 9 + blackGeneralInfo.c] !== 0) {
        blackIsInCheck = true;
    }

    if (redGeneralInfo && blackGeneralInfo && redGeneralInfo.c === blackGeneralInfo.c) {
        let hasPieceBetween = false;
        const startR = Math.min(redGeneralInfo.r, blackGeneralInfo.r) + 1;
        const endR = Math.max(redGeneralInfo.r, blackGeneralInfo.r) - 1;
        for (let r = startR; r <= endR; r++) {
            if (squareCodes[r * 9 + redGeneralInfo.c]) {
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

const calculateTacticalValues = (piecesInfo, currentPlayer, boardInfo = null, board = null) => {
    const squareCodes = board && activeSearchPieceState ? activeSearchPieceState.squareCodes : null;
    const collectUi = !!boardInfo;
    if (collectUi) {
        boardInfo.checks = [];
        boardInfo.threatenedPieces = [];
        boardInfo.canCapture = [];
    }

    const checkBonus = CHECK_BONUS;
    const canCaptureSeen = collectUi ? new Set() : null;
    const attackMask = boardInfo.attackMask;
    const guardMask = boardInfo.guardMask;

    for (let ti = 0; ti < piecesInfo.length; ti++) {
        const threatenedPiece = piecesInfo[ti];
        const sq = threatenedPiece.r * 9 + threatenedPiece.c;
        const am = attackMask[sq];
        if (am === 0) continue;
        const firstAttacker = piecesInfo[lowestSetBitIndex(am)];
        const hasGuard = guardMask[sq] !== 0;

        if ((threatenedPiece.pieceCode & 7) === 1) {
            if (collectUi) {
                let m = am >>> 0;
                while (m !== 0) {
                    const bit = m & -m;
                    boardInfo.checks.push({
                        attacker: piecesInfo[31 - Math.clz32(bit)],
                        target: threatenedPiece,
                        isCheck: true
                    });
                    m ^= bit;
                }
            }
            firstAttacker.threatValue += checkBonus;
            continue;
        }

        if (!hasGuard) {
            firstAttacker.threatValue += threatenedPiece.materialValue;
            if (collectUi) {
                if ((firstAttacker.pieceCode < 8) === (currentPlayer === SIDE_RED)) {
                    let m = am >>> 0;
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
                    boardInfo.threatenedPieces.push(threatenedPiece);
                }
            }
        } else {
            const sseScore = calculateStaticExchangeScoreFromMasks(
                threatenedPiece, piecesInfo, attackMask, guardMask
            );
            if (sseScore > 0) {
                firstAttacker.threatValue += sseScore >> 1;
            }
        }
    }

    if (!board || !squareCodes) return;
    for (let i = 0; i < piecesInfo.length; i++) {
        const general = piecesInfo[i];
        if ((general.pieceCode & 7) !== 1) continue;
        const isRed = general.pieceCode < 8;
        const enemyBits = isRed ? boardInfo.blackAttack : boardInfo.redAttack;
        const { r, c } = general;
        for (let d = 0; d < ORTH_DIRS.length; d++) {
            const nr = r + ORTH_DIRS[d][0];
            const nc = c + ORTH_DIRS[d][1];
            if (nc < 3 || nc > 5) continue;
            if (isRed ? (nr < 0 || nr > 2) : (nr < 7 || nr > 9)) continue;
            if (!squareCodes[nr * 9 + nc] && hasAttackBit(enemyBits, nr * 9 + nc)) {
                general.safetyValue -= 50;
            }
        }
    }
};

const calculateDerivedValues = (board, piecesInfo, currentPlayer = null, boardInfo = null) => {
    for (const info of piecesInfo) {
        info.threatValue = 0;
        info.safetyValue = 0;
    }

    calculatePieceRelations(board, piecesInfo, boardInfo);
    calculateTacticalValues(piecesInfo, currentPlayer, boardInfo, board);

    if (currentPlayer != null) {
        const inCheck = currentPlayer === SIDE_RED ? !!boardInfo.redIsInCheck : !!boardInfo.blackIsInCheck;
        let checkInfo = null;
        if (inCheck) {
            const state = activeSearchPieceState;
            if (state) {
                collectCheckersFromState(state, currentPlayer, scratchLegalCheckInfo);
                checkInfo = scratchLegalCheckInfo;
            }
        }
        let hasMoves = false;
        for (const info of piecesInfo) {
            if ((info.pieceCode < 8) === (currentPlayer === SIDE_RED)) {
                const moves = getValidMoves(board, { r: info.r, c: info.c }, inCheck, checkInfo);
                if (moves.length > 0) {
                    hasMoves = true;
                    break;
                }
            }
        }

        let gameState = { status: 'playing' };
        if (!hasMoves) {
            const opponent = sideToColor(currentPlayer ^ 1);
            gameState = inCheck
                ? { status: 'checkmate', winner: opponent }
                : { status: 'stalemate', winner: opponent };
        }
        boardInfo.gameState = gameState;
    }
};

/** @param {string | null} [currentPlayer] */
export const evaluateBoard = (board, currentPlayer = null, gameStage = 'mid') =>
    runWithPieceState(board, () => {
        const __t0 = searchProfile ? performance.now() : 0;
        const outputPhase = gameStage;
        const piecesInfo = collectUiPiecesInfo(gameStage);

        let redMaterial = 0, redPosition = 0;
        let blackMaterial = 0, blackPosition = 0;
        for (const info of piecesInfo) {
            if (info.pieceCode < 8) {
                redMaterial += info.materialValue;
                redPosition += info.positionValue;
            } else {
                blackMaterial += info.materialValue;
                blackPosition += info.positionValue;
            }
        }

        const boardInfo = createRelationBoardInfo();
        calculateDerivedValues(
            board, piecesInfo, currentPlayer == null ? null : colorToSide(currentPlayer), boardInfo
        );

        let redThreat = 0, redSafety = 0, redMobility = 0;
        let blackThreat = 0, blackSafety = 0, blackMobility = 0;
        for (const info of piecesInfo) {
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

        const __evalResult = {
            red: {
                total: redTotal,
                material: redMaterial * VALUE_WEIGHTS.material,
                position: redPosition * VALUE_WEIGHTS.position,
                threat: redThreat * VALUE_WEIGHTS.threat,
                safety: redSafety * VALUE_WEIGHTS.safety,
                mobility: redMobility * VALUE_WEIGHTS.mobility,
                phase: outputPhase
            },
            black: {
                total: blackTotal,
                material: blackMaterial * VALUE_WEIGHTS.material,
                position: blackPosition * VALUE_WEIGHTS.position,
                threat: blackThreat * VALUE_WEIGHTS.threat,
                safety: blackSafety * VALUE_WEIGHTS.safety,
                mobility: blackMobility * VALUE_WEIGHTS.mobility,
                phase: outputPhase
            },
            piecesInfo,
            gameStage,
            boardInfo
        };
        if (searchProfile) {
            perfStats.evaluateBoardMs += performance.now() - __t0;
        }
        return __evalResult;
    });

/** @param {string | null} [currentPlayer] */
export const evaluatePiece = (board, currentPlayer = null, gameStage = 'mid') =>
    runWithPieceState(board, () => {
        const piecesInfo = collectUiPiecesInfo(gameStage);
        const boardInfo = createRelationBoardInfo();
        calculatePieceRelations(board, piecesInfo, boardInfo);
        calculateTacticalValues(
            piecesInfo, currentPlayer == null ? null : colorToSide(currentPlayer), boardInfo, board
        );
        return {
            piecesInfo,
            gameStage,
            boardInfo
        };
    });

export const hydrateRelationsFromMasks = (piecesInfo, boardInfo) => {
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
            if (target && target !== attacker && (target.pieceCode < 8) !== (attacker.pieceCode < 8)) {
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
            if (target && target !== guarder && (target.pieceCode < 8) === (guarder.pieceCode < 8)) {
                guarder.guard.push(target);
                target.guardedBy.push(guarder);
            }
            gm ^= bit;
        }
    }

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

export const isCheck = (board, color, piecesInfo = null, boardInfo = null) => {
    const side = colorToSide(color);
    if (boardInfo) {
        return side === SIDE_RED ? boardInfo.redIsInCheck : boardInfo.blackIsInCheck;
    }
    if (piecesInfo && piecesInfo.length > 0) {
        return side === SIDE_RED ? piecesInfo[0].redIsInCheck : piecesInfo[0].blackIsInCheck;
    }
    const state = activePieceStateFor(board);
    if (state) return isKingInCheckFromState(state, side);
    return runWithPieceState(board, () => {
        const created = activeSearchPieceState;
        return created ? isKingInCheckFromState(created, side) : true;
    });
};

export const getValidMoves = (board, pos, wasInCheck = null, checkInfo = null) =>
    runWithPieceState(board, () =>
        getValidMovesFromSq(pos.r * 9 + pos.c, wasInCheck, checkInfo)
    );

export const checkGameState = (board, turn, piecesInfo = null, boardInfo = null) => {
    if (boardInfo && boardInfo.gameState) {
        return boardInfo.gameState;
    }

    let hasMoves = false;
    let inCheck = false;
    const side = colorToSide(turn);
    runWithPieceState(board, () => {
        const state = activeSearchPieceState;
        inCheck = isKingInCheckFromState(state, side);
        let checkInfo = null;
        if (inCheck) {
            collectCheckersFromState(state, side, scratchLegalCheckInfo);
            checkInfo = scratchLegalCheckInfo;
        }
        const wantRed = side === SIDE_RED;
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const code = state.squareCodes[r * 9 + c];
                if (!code || (code < 8) !== wantRed) continue;
                if (getValidMovesFromSq(r * 9 + c, inCheck, checkInfo).length > 0) {
                    hasMoves = true;
                    return;
                }
            }
        }
    });

    if (hasMoves) return { status: 'playing' };
    const opponent = sideToColor(side ^ 1);
    if (inCheck) {
        return { status: 'checkmate', winner: opponent };
    }
    return { status: 'stalemate', winner: opponent };
};
