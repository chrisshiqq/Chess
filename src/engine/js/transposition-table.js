import { collectSearchMetrics, searchProfile } from './search-context.js';

// 定长槽位 TT：8 字节 AoS + generation O(1) clear。
// 长度取 2^22：d8 约 110 万独特局面时负载~0.27，显著低于 2^21 下的冲突覆盖率。
export const TT_DEFAULT_SIZE = 1 << 22; // 4194304
export const TT_SMALL_SIZE = 1 << 21; // 2097152
export const TT_FLAG_EXACT = 0;
export const TT_FLAG_LOWER = 1;
export const TT_FLAG_UPPER = 2;
// word0: key16:0-15 | gen:16-23 | flag:24-25 | keyHigh:26 | depth:27-31
// word1: value18:0-17 | move:18-31
// 索引已用 key 低 22 位；key16 只存高 16 位，校验强度与原先满 32 位 key 相同。
const TT_W0_KEY_MASK = 0xFFFF;
const TT_W0_GEN_SHIFT = 16;
const TT_W0_GEN_CLEAR = 0xFF00FFFF;
export const TT_W0_FLAG_SHIFT = 24;
const TT_W0_KEYHIGH = 0x04000000;
export const TT_W0_DEPTH_SHIFT = 27;
const TT_W1_VALUE_MASK = 0x3FFFF;
export const TT_W1_MOVE_SHIFT = 18;
const TT_W1_MOVE_MASK = 0x3FFF;
const TT_VALUE_MIN = -131072;
const TT_VALUE_MAX = 131071;
const TT_DEPTH_MAX = 31;
const TT_GEN_MASK8 = 0xFF;

export class TranspositionTable {
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
        this.data = new Uint32Array(n << 1);

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

    resize(size) {
        let n = size | 0;
        if (n < 1024) n = 1024;
        n = 1 << (32 - Math.clz32(n - 1));
        if (n === this.size) return false;
        this.size = n;
        this.mask = n - 1;
        this.generation = 1;
        this.retainedGenerations = 0;
        this.reuseScope = null;
        this.lastSearchPly = null;
        this.occupiedApprox = 0;
        this.data = new Uint32Array(n << 1);
        return true;
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
        const flagCode = flag;
        const move = bestMove || 0;

        if (live && (word0 & TT_W0_KEY_MASK) === key16 &&
            !!(word0 & TT_W0_KEYHIGH) === keyHigh) {
            if (collectSearchMetrics) this.stats.updatedStores++;
            const slotDepth = word0 >>> TT_W0_DEPTH_SHIFT;
            // 更深 exact 不被更浅 bound 覆盖
            if (slotDepth > depth &&
                ((word0 >>> TT_W0_FLAG_SHIFT) & 3) === 0 && flagCode !== 0) {
                if (collectSearchMetrics) this.stats.retainedUpdates++;
                // The matching historical entry is useful in this search; refresh
                // its generation so it cannot expire while the current search runs.
                this.data[base] = (word0 & TT_W0_GEN_CLEAR) | (gen << TT_W0_GEN_SHIFT);
                return;
            }
            this._writeSlot(base, key16, gen, flagCode, keyHigh, depth, value, move);
            if (collectSearchMetrics) this.stats.stores++;
            return;
        }

        if (live) {
            const historicalSlot = slotGen !== gen;
            const slotDepth = word0 >>> TT_W0_DEPTH_SHIFT;
            // Current-search entries remain depth preferred. A different-key
            // historical entry must never block the current generation.
            if (!historicalSlot && slotDepth > depth) {
                if (collectSearchMetrics) {
                    this.stats.retainedUpdates++;
                    this.stats.depthPreferredEvictions++;
                }
                return;
            }
            if (collectSearchMetrics) {
                this.stats.lruEvictions++;
                if (historicalSlot) this.stats.historicalReplacements++;
            }
        } else if (collectSearchMetrics) {
            this.occupiedApprox++;
        }

        this._writeSlot(base, key16, gen, flagCode, keyHigh, depth, value, move);
        if (collectSearchMetrics) this.stats.stores++;
    }

    // 返回 packed 槽位基址；miss 为 -1。保持纯数值返回，避免热路径写共享对象。
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
            if (collectSearchMetrics) this.stats.misses++;
            return -1;
        }
        if (collectSearchMetrics) {
            this.stats.hits++;
            if (age > 0) this.stats.historicalHits++;
        }
        const flagCode = (word0 >>> TT_W0_FLAG_SHIFT) & 3;
        if (searchProfile) {
            if (flagCode === 0) this.stats.exactHits++;
            else if (flagCode === 1) this.stats.lowerboundHits++;
            else this.stats.upperboundHits++;
        }
        return base;
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
        if (collectSearchMetrics) {
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

