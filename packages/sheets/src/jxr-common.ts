/*
 * JPEG XR (ITU-T T.832, Microsoft's HD Photo, `.wdp` / `.jxr`): what the encoder and the decoder share. Bit reading and
 * writing, the adaptive variable-length code tables, the scan orders, and the adaptive state a coder keeps while it goes
 * through the macroblocks of a picture.
 *
 * The code tables, the way a table is picked while coding, and the state updates are the ones the standard has, written
 * out here from the standard's rules (a decoder and an encoder must agree on them to the bit).
 * They were checked against the reference implementation (jxrlib, BSD licence) by coding pictures both ways: see `test/jxr.test.ts`.
 */

/** The error thrown for a stream that is damaged or uses a part of the format this does not read. */
export class JxrError extends Error {}

// ---------------------------------------------------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------------------------------------------------

/** Writes bits, most significant first. */
export class BitWriter {
  private buf = new Uint8Array(1 << 12);
  private length = 0;
  private acc = 0;
  private count = 0;

  /** Writes the low `n` bits of `v` (n from 0 to 32). */
  put(v: number, n: number): void {
    if (n > 16) {
      this.put(Math.floor((v >>> 0) / 65536) & ((1 << (n - 16)) - 1), n - 16);
      this.put(v & 0xffff, 16);
      return;
    }
    if (n === 0) return;
    this.acc = (this.acc << n) | (v & ((1 << n) - 1));
    this.count += n;
    while (this.count >= 8) {
      this.count -= 8;
      this.push((this.acc >> this.count) & 0xff);
    }
    this.acc &= (1 << this.count) - 1;
  }

  private push(byte: number): void {
    if (this.length === this.buf.length) {
      const bigger = new Uint8Array(this.buf.length * 2);
      bigger.set(this.buf);
      this.buf = bigger;
    }
    this.buf[this.length++] = byte;
  }

  /** Pads with zero bits to the next byte. */
  fillToByte(): void {
    if (this.count) this.put(0, 8 - this.count);
  }

  /** The bytes written (after `fillToByte`, all of them). */
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }

  /** How many whole bytes have been written. */
  get size(): number {
    return this.length;
  }
}

/** Reads bits, most significant first. Past the end it reads zeros (and says so in `overrun`). */
export class BitReader {
  pos: number; // in bits
  overrun = false;
  constructor(
    readonly data: Uint8Array,
    byteStart = 0,
    readonly byteEnd = data.length,
  ) {
    this.pos = byteStart * 8;
  }

  get(n: number): number {
    if (n > 16) {
      const hi = this.get(n - 16);
      return hi * 65536 + this.get(16);
    }
    let v = 0;
    let pos = this.pos;
    let left = n;
    while (left > 0) {
      const byteIndex = pos >> 3;
      const byte = byteIndex < this.byteEnd ? this.data[byteIndex]! : (this.overrun = true, 0);
      const have = 8 - (pos & 7);
      const take = Math.min(have, left);
      v = (v << take) | ((byte >> (have - take)) & ((1 << take) - 1));
      pos += take;
      left -= take;
    }
    this.pos = pos;
    return v;
  }

  bit(): number {
    return this.get(1);
  }

  /** Reads `n` bits and gives the value signed the way the flexbits do: n zero bits are 0, else n bits of magnitude and a sign bit. */
  getSigned(n: number): number {
    const v = this.get(n);
    if (v === 0) return 0;
    return this.get(1) ? -v : v;
  }

  flushToByte(): void {
    this.pos = (this.pos + 7) & ~7;
  }

  get bytePos(): number {
    return this.pos >> 3;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------------

export const CF_Y_ONLY = 0;
export const CF_YUV_420 = 1;
export const CF_YUV_422 = 2;
export const CF_YUV_444 = 3;
export const CF_CMYK = 4;
export const CF_NCOMPONENT = 6;
/** The colour format of the picture the file stands for (not the one it is coded in). */
export const SRC_RGB = 7;

export const SB_ALL = 0;
export const SB_NO_FLEXBITS = 1;
export const SB_NO_HIGHPASS = 2;
export const SB_DC_ONLY = 3;

export const OL_NONE = 0;
export const OL_ONE = 1;
export const OL_TWO = 2;

export const BD_8 = 1;
export const BD_16 = 2;

/** The number of adaptive code tables a coding context has: 5 for DC, 8 for the low pass, 8 for the high pass. */
export const NUM_VLC = 21;
export const CONTEXT_X = 8;
export const CT_DC = 5;
export const MAX_TOTAL = 32767;

/** Where each pixel of a 16 by 16 macroblock is kept while it is transformed: `IDX_CC[y * 16 + x]`. */
export const IDX_CC = (() => {
  const fy = [0, 2, 10, 8];
  const fx = [0, 1, 5, 4];
  const t = new Int32Array(256);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) t[y * 16 + x] = ((x >> 2) << 6) | ((y >> 2) << 4) | (fy[y & 3]! ^ fx[x & 3]!);
  return t;
})();

/** Where each 4 by 4 block of a macroblock is kept (its offset in the 256 coefficients), in the order the blocks are coded. */
export const BLK_OFFSET = [0, 64, 16, 80, 128, 192, 144, 208, 32, 96, 48, 112, 160, 224, 176, 240] as const;

/** `DCT_INDEX[0]`: where the 15 high pass coefficients of a block are, `[2]`: where the low pass coefficients are (inside the macroblock). */
export const DCT_INDEX: readonly (readonly number[])[] = [
  [0, 5, 1, 6, 10, 12, 8, 14, 2, 4, 3, 7, 9, 13, 11, 15],
  [0, 5, 1, 6, 10, 12, 8, 14, 2, 4, 3, 7, 9, 13, 11, 15],
  [0, 128, 64, 208, 32, 240, 48, 224, 16, 192, 80, 144, 112, 176, 96, 160],
];

const ZIGZAG_LOW = [0, 1, 4, 5, 2, 8, 6, 9, 3, 12, 10, 7, 13, 11, 14, 15];
const ZIGZAG_H = ZIGZAG_LOW;
const ZIGZAG_V = [0, 4, 8, 5, 1, 12, 9, 6, 2, 13, 3, 15, 7, 10, 14, 11];

/** For a run of zeros of known longest length: the bin of the code used for it, and the fixed length bits that follow. */
export const SIGNIFICANT_RUN_BIN = [-1, -1, -1, -1, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0] as const;
export const SIGNIFICANT_RUN_FIXED = [0, 0, 1, 1, 3, 0, 0, 1, 1, 2, 0, 0, 0, 0, 1] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Adaptive variable length codes
// ---------------------------------------------------------------------------------------------------------------------

interface CodeSet {
  /** For each table the code set may switch between: [code, length] for each symbol. */
  codes: number[][];
  delta: number[] | null;
}

const CODE_SETS: Record<number, CodeSet> = {
  4: { codes: [[1, 1, 1, 2, 0, 3, 1, 3]], delta: null },
  5: { codes: [[1, 1, 1, 2, 1, 3, 0, 4, 1, 4], [1, 1, 0, 3, 1, 3, 2, 3, 3, 3]], delta: [0, -1, 0, 1, 1] },
  6: {
    codes: [[1, 1, 0, 5, 1, 3, 1, 5, 1, 2, 1, 4], [1, 2, 0, 4, 2, 2, 1, 4, 3, 2, 1, 3], [0, 4, 1, 4, 1, 2, 2, 2, 3, 2, 1, 3], [0, 5, 1, 5, 1, 2, 1, 1, 1, 4, 1, 3]],
    delta: [-1, 1, 1, 1, 0, 1, -2, 0, 0, 2, 0, 0, -1, -1, 0, 1, -2, 0],
  },
  7: { codes: [[1, 2, 2, 2, 3, 2, 1, 3, 1, 4, 0, 5, 1, 5], [1, 1, 1, 2, 1, 3, 1, 4, 1, 5, 0, 6, 1, 6]], delta: [1, 0, -1, -1, -1, -1, -1] },
  8: { codes: [[2, 2, 1, 3, 1, 5, 1, 4, 3, 2, 2, 3, 0, 5, 3, 3], [1, 3, 2, 3, 1, 4, 3, 3, 4, 3, 5, 3, 0, 4, 3, 2]], delta: null },
  9: { codes: [[2, 3, 0, 5, 2, 4, 1, 5, 2, 5, 1, 1, 3, 3, 3, 5, 3, 4], [1, 1, 1, 3, 2, 3, 1, 4, 1, 6, 3, 3, 1, 5, 0, 7, 1, 7]], delta: [2, 2, 1, 1, -1, -2, -2, -2, -3] },
  12: {
    codes: [
      [1, 5, 1, 6, 0, 7, 1, 7, 4, 5, 2, 3, 5, 5, 1, 1, 6, 5, 1, 4, 7, 5, 3, 3],
      [2, 4, 2, 5, 0, 6, 1, 6, 3, 4, 2, 3, 3, 5, 3, 2, 3, 3, 4, 3, 1, 5, 5, 3],
      [3, 2, 1, 3, 0, 7, 1, 7, 1, 5, 2, 3, 2, 7, 3, 3, 4, 3, 5, 3, 3, 7, 1, 4],
      [1, 3, 3, 2, 0, 7, 1, 5, 2, 5, 2, 3, 1, 7, 3, 3, 3, 5, 4, 3, 1, 6, 5, 3],
      [2, 3, 1, 1, 1, 7, 1, 4, 2, 7, 3, 3, 0, 8, 2, 4, 3, 7, 3, 4, 1, 8, 1, 5],
    ],
    delta: [1, 1, 1, 1, 1, 0, 0, -1, 2, 1, 0, 0, 2, 2, -1, -1, -1, 0, -2, -1, 0, 0, -2, -1, -1, 1, 0, 2, 0, 0, 0, 0, -2, 0, 1, 1, 0, 1, 0, 1, -2, 0, -1, -1, -2, -1, -2, -2],
  },
};
const MAX_TABLES: Record<number, number> = { 4: 1, 5: 2, 6: 4, 7: 2, 8: 2, 9: 2, 12: 5 };
const SECOND_DISCRIMINANT: Record<number, boolean> = { 6: true, 12: true };
const THRESHOLD = 8;
const MEMORY = 8;

/** symbol by (length, code), per alphabet and table. */
const DECODE_MAPS = new Map<string, Map<number, number>>();
function decodeMap(n: number, t: number): Map<number, number> {
  const key = `${n}:${t}`;
  let m = DECODE_MAPS.get(key);
  if (!m) {
    m = new Map();
    const codes = CODE_SETS[n]!.codes[t]!;
    for (let s = 0; s < n; s++) m.set((codes[2 * s + 1]! << 16) | codes[2 * s]!, s);
    DECODE_MAPS.set(key, m);
  }
  return m;
}

/**
 * A variable length code for an alphabet of `n` symbols that switches between a few code tables as it goes: each symbol coded
 * moves a running count (the discriminant) by an amount the table gives, and at certain points the count says whether to move
 * to the neighbouring table.
 */
export class AdaptiveHuffman {
  tableIndex = 0;
  disc = 0;
  disc1 = 0;
  private lower = 0;
  private upper = 0;
  private started = false;
  /** the current table: [code, length] for each symbol, flat */
  codes: number[] = [];
  delta: number[] | null = null;
  delta1: number[] | null = null;
  private map!: Map<number, number>;

  constructor(readonly n: number) {
    if (!CODE_SETS[n]) throw new JxrError(`No code table for ${n} symbols`);
  }

  /** Back to the start: the next `adapt` picks the first table. */
  reset(): void {
    this.started = false;
  }

  /** Called when the tables may be switched (at the start, and every 16 macroblocks). */
  adapt(): void {
    const n = this.n;
    const set = CODE_SETS[n]!;
    const second = SECOND_DISCRIMINANT[n] === true;
    if (!this.started) {
      this.started = true;
      this.disc = this.disc1 = 0;
      this.tableIndex = second ? 1 : 0;
    }
    const dL = this.disc;
    const dH = second ? this.disc1 : this.disc;
    let change = false;
    if (dL < this.lower) {
      this.tableIndex--;
      change = true;
    } else if (dH > this.upper) {
      this.tableIndex++;
      change = true;
    }
    if (change) this.disc = this.disc1 = 0;
    const lim = THRESHOLD * MEMORY;
    this.disc = Math.max(-lim, Math.min(lim, this.disc));
    this.disc1 = Math.max(-lim, Math.min(lim, this.disc1));
    const t = this.tableIndex;
    const max = MAX_TABLES[n]!;
    if (t < 0 || t >= max) throw new JxrError("A code table index is out of range");
    this.lower = t === 0 ? -2147483648 : -THRESHOLD;
    this.upper = t === max - 1 ? 1 << 30 : THRESHOLD;
    const tab = n === 4 || n === 8 ? 0 : t;
    this.codes = set.codes[tab]!;
    this.map = decodeMap(n, tab);
    const d = set.delta;
    if (n === 6 || n === 12) {
      const rowOf = (r: number) => d!.slice(r * n, r * n + n);
      this.delta1 = rowOf(t - (t + 1 === max ? 1 : 0));
      this.delta = rowOf(t - 1 + (t === 0 ? 1 : 0));
    } else {
      this.delta = d;
      this.delta1 = null;
    }
  }

  /** Writes a symbol. */
  write(w: BitWriter, symbol: number, extraBits = 0, extra = 0): void {
    // `extra` (with `extraBits` bits) is written right after the code (a sign, usually).
    const len = this.codes[2 * symbol + 1]!;
    w.put(this.codes[2 * symbol]! * (1 << extraBits) + extra, len + extraBits);
  }

  /** Reads a symbol. */
  read(r: BitReader): number {
    let code = 0;
    for (let len = 1; len <= 9; len++) {
      code = (code << 1) | r.get(1);
      const s = this.map.get((len << 16) | code);
      if (s !== undefined) return s;
    }
    throw new JxrError("A variable length code is not one of the table's");
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The adaptive state of a coder
// ---------------------------------------------------------------------------------------------------------------------

/** The order the 15 coefficients of a block are scanned in, which moves the coefficients that are often nonzero to the front. */
export class AdaptiveScan {
  total = new Int32Array(16);
  scan = new Int32Array(16);

  constructor(private readonly order: readonly number[]) {
    this.reset();
  }

  reset(): void {
    for (let i = 0; i < 16; i++) this.scan[i] = this.order[i]!;
  }

  resetTotals(): void {
    let weight = 32;
    this.total[0] = MAX_TOTAL;
    for (let k = 1; k < 16; k++) {
      this.total[k] = weight;
      weight -= 2;
    }
  }

  /** Counts a nonzero coefficient at scan position `k`, and moves it up when it has become more frequent than the one before. */
  bump(k: number): void {
    this.total[k]!++;
    if (k > 0 && this.total[k]! > this.total[k - 1]!) {
      const t = this.total[k]!;
      this.total[k] = this.total[k - 1]!;
      this.total[k - 1] = t;
      const s = this.scan[k]!;
      this.scan[k] = this.scan[k - 1]!;
      this.scan[k - 1] = s;
    }
  }
}

/** How many bits of each coefficient are sent outside the entropy coded part ("model bits"), kept for the luma and the chroma, per band. */
export class BitModel {
  state = [0, 0];
  bits = [0, 0];
  constructor(readonly band: 1 | 2 | 3, start = 0) {
    this.bits = [start, start];
  }
}

const WEIGHT0 = [240, 12, 1];
const WEIGHT1 = [
  [0, 240, 120, 80, 60, 48, 40, 34, 30, 27, 24, 22, 20, 18, 17, 16],
  [0, 12, 6, 4, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1],
  [0, 16, 8, 5, 4, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 1],
];
const WEIGHT2 = [120, 37, 2, 120, 18, 1];

/** Moves the model bits at the end of a macroblock by how many coefficients it had. `mean` holds the counts for luma and for chroma. */
export function updateModel(cf: number, channels: number, mean: [number, number], model: BitModel): void {
  const band = model.band - 1;
  mean[0] *= WEIGHT0[band]!;
  if (cf === CF_YUV_420) mean[1] *= WEIGHT2[band]!;
  else if (cf === CF_YUV_422) mean[1] *= WEIGHT2[3 + band]!;
  else {
    mean[1] *= WEIGHT1[band]![channels - 1]!;
    if (model.band === 3) mean[1] >>= 4;
  }
  for (let j = 0; j < 2; j++) {
    const lm = mean[j]!;
    let ms = model.state[j]!;
    let delta = (lm - 70) >> 2;
    if (delta <= -8) {
      delta += 4;
      if (delta < -16) delta = -16;
      ms += delta;
      if (ms < -8) {
        if (model.bits[j] === 0) ms = -8;
        else {
          ms = 0;
          model.bits[j]!--;
        }
      }
    } else if (delta >= 8) {
      delta -= 4;
      if (delta > 15) delta = 15;
      ms += delta;
      if (ms > 8) {
        if (model.bits[j]! >= 15) {
          model.bits[j] = 15;
          ms = 8;
        } else {
          ms = 0;
          model.bits[j]!++;
        }
      }
    }
    model.state[j] = ms;
    if (cf === CF_Y_ONLY) break;
  }
}

/** The state that predicts which blocks of a macroblock have high pass coefficients. */
export class CbpModel {
  count0 = [-4, -4];
  count1 = [4, 4];
  state = [0, 0];
}

const saturate = (x: number): number => (x + 16 >>> 0) >= 32 ? (x < 0 ? -16 : 15) : x;

/** Moves the CBP model by how many blocks of a macroblock had coefficients (`ones`, of 16, or for the chroma of 420/422 scaled). */
export function updateCbpModel(m: CbpModel, c1: number, ones: number): void {
  m.count0[c1] = saturate(m.count0[c1]! + ones - 3);
  m.count1[c1] = saturate(m.count1[c1]! + 16 - ones - 3);
  if (m.count0[c1]! < 0) m.state[c1] = m.count0[c1]! < m.count1[c1]! ? 1 : 2;
  else if (m.count1[c1]! < 0) m.state[c1] = 2;
  else m.state[c1] = 0;
}

export const numOnes = (x: number): number => {
  let n = 0;
  x &= 0xffff;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n;
};

const ALPHABET = [5, 4, 8, 7, 7, 12, 6, 6, 12, 6, 6, 7, 7, 12, 6, 6, 12, 6, 6, 7, 7];

/** Everything a coder keeps between macroblocks of one tile column: it starts over at the start of each tile. */
export class CodingContext {
  cbpy: AdaptiveHuffman;
  cbpy1 = new AdaptiveHuffman(5);
  ah: AdaptiveHuffman[] = ALPHABET.map((n) => new AdaptiveHuffman(n));
  scanLow = new AdaptiveScan(ZIGZAG_LOW);
  scanH = new AdaptiveScan(ZIGZAG_H.map((i) => DCT_INDEX[0]![i]!));
  scanV = new AdaptiveScan(ZIGZAG_V.map((i) => DCT_INDEX[0]![i]!));
  modelAC = new BitModel(3);
  modelLP = new BitModel(2, 4);
  modelDC = new BitModel(1, 8);
  cbpCountZero = 1;
  cbpCountMax = 1;
  cbp = new CbpModel();
  trimFlexBits = 0;

  constructor(cf: number) {
    this.cbpy = new AdaptiveHuffman(cf === CF_Y_ONLY || cf === CF_NCOMPONENT || cf === CF_CMYK ? 5 : 9);
    this.reset();
  }

  reset(): void {
    this.cbpy.reset();
    this.cbpy1.reset();
    for (const a of this.ah) a.reset();
    this.adaptLowpass();
    this.adaptHighpass();
    this.scanLow.reset();
    this.scanH.reset();
    this.scanV.reset();
    this.modelAC = new BitModel(3);
    this.modelLP = new BitModel(2, 4);
    this.modelDC = new BitModel(1, 8);
    this.cbpCountMax = this.cbpCountZero = 1;
    this.cbp = new CbpModel();
  }

  adaptLowpass(): void {
    for (let k = 0; k < CONTEXT_X + CT_DC; k++) this.ah[k]!.adapt();
  }

  adaptHighpass(): void {
    this.cbpy.adapt();
    this.cbpy1.adapt();
    for (let k = 0; k < CONTEXT_X; k++) this.ah[k + CONTEXT_X + CT_DC]!.adapt();
  }
}
