import { COLS, REL_SQUARES, ROWS, SQ_COL, SQ_ROW } from './board.js';

export const createLeafCheckpoint = () => ({
    watches: new Uint32Array(REL_SQUARES),
    attacks: new Uint32Array(32),
    guards: new Uint32Array(32),
    palace: new Uint32Array(32),
    mobility: new Uint8Array(32),
    targets: new Uint8Array(32),
    targetCount: 0,
    mobilityTable: new Uint32Array(128),
    redPalaceTable: new Uint32Array(128),
    blackPalaceTable: new Uint32Array(128)
});

// watches[sq] lists every checkpoint piece whose contribution could change
// if sq changes occupant, including a capture that leaves the square occupied.
export function indexLeafCheckpoint(frame, state, destinations, metrics) {
    frame.watches.fill(0);
    frame.targetCount = 0;
    const alive = state.redAliveMask | state.blackAliveMask;
    for (let slot = 0; slot < state.slotCount; slot++) {
        if (frame.attacks[slot] || frame.guards[slot]) frame.targets[frame.targetCount++] = slot;
        const bit = 1 << slot;
        if (!(alive & bit)) continue;
        const sq = state.slotToSquare[slot];
        const code = state.slotCodes[slot];
        const type = code & 7;
        frame.watches[sq] |= bit;
        if (type === 2 || type === 6) {
            const row = SQ_ROW[sq], col = SQ_COL[sq];
            for (let r = 0; r < ROWS; r++) frame.watches[r * COLS + col] |= bit;
            for (let c = 0; c < COLS; c++) frame.watches[row * COLS + c] |= bit;
        } else {
            const moves = type === 3 ? destinations[type][sq] : destinations[type][code < 8 ? 0 : 1][sq];
            for (let i = 0; i < moves.length; i++) {
                const dest = moves[i];
                frame.watches[dest.r * COLS + dest.c] |= bit;
                if (type === 3 || type === 4) frame.watches[dest.br * COLS + dest.bc] |= bit;
            }
        }
    }

    // Four slots per group, sixteen subsets. Each ten-bit sum fits even
    // with 32 sliders contributing their maximum of 17 empty destinations.
    for (let group = 0; group < 8; group++) {
        const base = group * 16;
        for (let mask = 1; mask < 16; mask++) {
            const bit = mask & -mask;
            const slot = group * 4 + 31 - Math.clz32(bit);
            const prev = base + (mask ^ bit), index = base + mask;
            const code = state.slotCodes[slot], type = code & 7;
            const mobility = frame.mobility[slot];
            const credit = metrics && (type === 1 || type === 4 || type === 5) ? mobility : 0;
            frame.mobilityTable[index] = frame.mobilityTable[prev] +
                (code < 8 ? mobility : mobility << 10) + (credit << 20);
            frame.redPalaceTable[index] = frame.redPalaceTable[prev] | (code < 8 ? frame.palace[slot] : 0);
            frame.blackPalaceTable[index] = frame.blackPalaceTable[prev] | (code >= 8 ? frame.palace[slot] : 0);
        }
    }
}
