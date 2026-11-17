import {
  AdaptiveHuffman,
  AdaptiveScan,
  BD_16,
  BD_8,
  BLK_OFFSET,
  BitReader,
  CF_CMYK,
  CF_NCOMPONENT,
  CF_Y_ONLY,
  CF_YUV_420,
  CF_YUV_444,
  CONTEXT_X,
  CT_DC,
  CodingContext,
  DCT_INDEX,
  IDX_CC,
  JxrError,
  SB_DC_ONLY,
  SB_NO_FLEXBITS,
  SB_NO_HIGHPASS,
  SIGNIFICANT_RUN_BIN,
  SIGNIFICANT_RUN_FIXED,
  SRC_RGB,
  numOnes,
  updateCbpModel,
  updateModel,
} from "./jxr-common";
import { invTransformChannel, invTransformChroma420, type ChromaCorners } from "./jxr-transform";

/*
 * A JPEG XR codestream decoder. It reads what the standard allows for pictures of 8 or 16 bits a channel in one, three or four
 * channels (grey, 4:4:4 colour, with interleaved alpha): spatial or frequency order, any tiling, overlap between blocks of
 * none, one or two levels, every band, trimmed flexbits and any quantizers. Pictures coded as 4:2:0 or 4:2:2 chroma, in more
 * channels than that, or in 32-bit or floating point numbers are not read (they throw a `JxrError`).
 */

export interface DecodedPicture {
  width: number;
  height: number;
  /** 1 for grey, 3 for red, green, blue; 4 when alpha is in the same codestream. */
  channels: number;
  /** `channels` bytes for each pixel, row by row. */
  data: Uint8Array;
}

const SHIFT_SCALED = 3; // SHIFTZERO + QPFRACBITS

/** The quantizer (the number the coefficients are multiplied by) an index of 0 to 255 stands for. */
export function quantizerOf(index: number, shift: number, scaled: boolean): number {
  if (index === 0) return 1;
  let man: number;
  let exp: number;
  if (!scaled) {
    if (index < 32) {
      man = (index + 3) >> 2;
      exp = 0;
    } else if (index < 48) {
      man = (16 + (index & 15) + 1) >> 1;
      exp = (index >> 4) - 2;
    } else {
      man = 16 + (index & 15);
      exp = (index >> 4) - 3;
    }
  } else if (index < 16) {
    man = index;
    exp = shift;
  } else {
    man = 16 + (index & 15);
    exp = (index >> 4) - 1 + shift;
  }
  return man * 2 ** exp;
}

const dquantBits = (n: number): number => (n < 2 ? 0 : n < 4 ? 1 : n < 6 ? 2 : n < 10 ? 3 : 4);

interface PlaneHeader {
  cf: number;
  scaled: boolean;
  sb: number;
  nCh: number;
  shiftLen: number;
  dcPerTile: boolean;
  lpPerTile: boolean;
  hpPerTile: boolean;
  lpUsesDc: boolean;
  hpUsesLp: boolean;
  dcIdx: number[];
  lpIdx: number[];
  hpIdx: number[];
}

/** Reads a set of quantizer indexes: one for each channel (the channel mode says how many are in the stream). */
function readIndexes(r: BitReader, nCh: number): number[] {
  const out = new Array<number>(nCh).fill(0);
  let mode = 0;
  if (nCh > 1) mode = r.get(2);
  out[0] = r.get(8);
  if (mode === 1) {
    const uv = r.get(8);
    for (let i = 1; i < nCh; i++) out[i] = uv;
  } else if (mode > 0) for (let i = 1; i < nCh; i++) out[i] = r.get(8);
  else for (let i = 1; i < nCh; i++) out[i] = out[0]!;
  return out;
}

function readPlaneHeader(r: BitReader, srcBd: number): PlaneHeader {
  const cf = r.get(3);
  if (cf > CF_NCOMPONENT) throw new JxrError("Unknown colour format");
  const scaled = r.get(1) === 1;
  const sb = r.get(4);
  let nCh = 1;
  switch (cf) {
    case CF_Y_ONLY:
      break;
    case CF_YUV_420:
    case CF_YUV_444:
      nCh = 3;
      r.get(8);
      break;
    case CF_NCOMPONENT:
      nCh = r.get(4) + 1;
      r.get(4);
      break;
    case CF_CMYK:
      nCh = 4;
      break;
    default:
      throw new JxrError("Pictures with subsampled chroma are not read");
  }
  let shiftLen = 0;
  if (srcBd === BD_16 || srcBd === 3 || srcBd === 5 || srcBd === 6) shiftLen = r.get(8);
  else if (srcBd === 7) {
    shiftLen = r.get(8);
    r.get(8);
  }
  const h: PlaneHeader = { cf, scaled, sb, nCh, shiftLen, dcPerTile: false, lpPerTile: false, hpPerTile: false, lpUsesDc: false, hpUsesLp: false, dcIdx: [], lpIdx: [], hpIdx: [] };
  if (r.get(1) === 1) h.dcIdx = readIndexes(r, nCh);
  else h.dcPerTile = true;
  if (sb !== SB_DC_ONLY) {
    if (r.get(1) === 0) {
      if (r.get(1) === 1) h.lpIdx = readIndexes(r, nCh);
      else h.lpPerTile = true;
    } else {
      h.lpUsesDc = true;
      h.lpPerTile = h.dcPerTile;
    }
    if (sb !== SB_NO_HIGHPASS) {
      if (r.get(1) === 0) {
        if (r.get(1) === 1) h.hpIdx = readIndexes(r, nCh);
        else h.hpPerTile = true;
      } else {
        h.hpUsesLp = true;
        h.hpPerTile = h.lpPerTile;
      }
    }
  }
  r.flushToByte();
  return h;
}

/** What a tile (column) of a plane uses to dequantize: the quantizer of each channel, for the DC, each of the low pass and each of the high pass sets. */
interface TileQuant {
  dc: number[];
  lp: number[][];
  hp: number[][];
  bitsLP: number;
  bitsHP: number;
}

interface Pred {
  dc: number;
  qp: number;
  cbp: number;
  ad: Int32Array;
}

const VLC_REMAP = [1, 2, 3, 5, 7, 1, 2, 3, 5, 7, 1, 2, 3, 4, 5];
const CBP_OFF = [0, 4, 2, 8, 12, 1];
const CBP_FLC = [0, 2, 1, 2, 2, 0];
const CBP_OUT = [0, 15, 3, 12, 1, 2, 4, 8, 5, 6, 9, 10, 7, 11, 13, 14];

function decodeQpIndex(r: BitReader, bits: number): number {
  if (r.get(1) === 0) return 0;
  return r.get(bits) + 1;
}

function decodeAbsLevel(r: BitReader, ah: AdaptiveHuffman): number {
  const index = ah.read(r);
  ah.disc += ah.delta![index]!;
  if (index < 2) return index + 2;
  if (index < 6) return [2, 3, 4, 6, 10, 14][index]! + r.get([0, 0, 1, 2, 2, 2][index]!);
  let fixed = r.get(4) + 4;
  if (fixed === 19) {
    fixed += r.get(2);
    if (fixed === 22) fixed += r.get(3);
  }
  return 2 + 2 ** fixed + r.get(fixed);
}

function decodeRun(r: BitReader, ah: AdaptiveHuffman, maxRun: number): number {
  if (maxRun < 5) {
    if (maxRun === 1) return 1;
    if (r.get(1)) return 1;
    if (maxRun === 2 || r.get(1)) return 2;
    if (maxRun === 3 || r.get(1)) return 3;
    return 4;
  }
  const bin = SIGNIFICANT_RUN_BIN[maxRun]!;
  const index = ah.read(r) + bin * 5;
  let run = VLC_REMAP[index]!;
  const flc = SIGNIFICANT_RUN_FIXED[index]!;
  if (flc) run += r.get(flc);
  return run;
}

/** Reads the levels and runs of one block: `rl` gets (run, level) pairs; returns how many. */
function decodeBlock(r: BitReader, ctx: CodingContext, chroma: boolean, rl: Int32Array, table: number, location: number): number {
  const ah = ctx.ah;
  const base = table + (chroma ? 3 : 0);
  let n = 1;
  const first = ah[base]!;
  const index0 = first.read(r);
  first.disc += first.delta![index0]!;
  first.disc1 += first.delta1![index0]!;
  let sr = index0 & 1;
  let srn = index0 >> 2;
  let cont = sr & srn;
  let neg = r.get(1) === 1;
  let level = 1;
  if (index0 & 2) level = decodeAbsLevel(r, ah[6 + table + cont]!);
  rl[1] = neg ? -level : level;
  rl[0] = 0;
  if (sr === 0) rl[0] = decodeRun(r, ah[0]!, 15 - location);
  location += rl[0]! + 1;
  while (srn !== 0) {
    sr = srn & 1;
    rl[n * 2] = 0;
    if (sr === 0) rl[n * 2] = decodeRun(r, ah[0]!, 15 - location);
    location += rl[n * 2]! + 1;
    let index: number;
    if (location < 15) {
      const t = ah[base + cont + 1]!;
      index = t.read(r);
      t.disc += t.delta![index]!;
      t.disc1 += t.delta1![index]!;
    } else if (location === 15) {
      if (r.get(1) === 0) index = 0;
      else if (r.get(1) === 0) index = 2;
      else index = 1 + 2 * r.get(1);
    } else index = r.get(1);
    srn = index >> 1;
    cont &= srn;
    neg = r.get(1) === 1;
    level = 1;
    if (index & 1) level = decodeAbsLevel(r, ah[6 + table + cont]!);
    rl[n * 2 + 1] = neg ? -level : level;
    n++;
    if (n > 16) throw new JxrError("A block has too many coefficients");
  }
  return n;
}

/** Where the four blocks of the chroma of a 4:2:0 macroblock are, in the order they are coded. */
const BLK_OFFSET_420_CHROMA = [0, 32, 16, 48];
/** Where each of the 8 by 8 chroma numbers of a 4:2:0 macroblock is kept: `IDX_420[row * 8 + column]`. */
const IDX_420 = (() => {
  const fy = [0, 2, 10, 8];
  const fx = [0, 1, 5, 4];
  return Array.from({ length: 64 }, (_, i) => (((i & 7) >> 2) << 5) | (((i >> 3) >> 2) << 4) | (fy[(i >> 3) & 3]! ^ fx[i & 3]!));
})();

class Plane {
  readonly cf: number;
  readonly nCh: number;
  readonly mbW: number;
  readonly mbH: number;
  /** The numbers a macroblock has in each channel: 256, or 64 for the chroma of 4:2:0. */
  readonly stride: number[];
  buf: Int32Array[];
  corners: ChromaCorners[] = [{ before: [0, 0], after: [0, 0] }, { before: [0, 0], after: [0, 0] }];
  ctx: CodingContext[] = [];
  tiles: TileQuant[] = [];
  /** the prediction information of the row above and of the row being read */
  prev: Pred[][];
  cur: Pred[][];
  blockDC: Int32Array[];
  cbp: number[];
  diffCbp: number[];
  qLP = 0;
  qHP = 0;
  orientation = 2;

  constructor(
    readonly h: PlaneHeader,
    readonly overlap: number,
    readonly width: number,
    readonly height: number,
    tileCols: number,
  ) {
    this.cf = h.cf;
    this.nCh = h.nCh;
    this.mbW = (width + 15) >> 4;
    this.mbH = (height + 15) >> 4;
    this.stride = Array.from({ length: this.nCh }, (_, c) => (this.cf === CF_YUV_420 && c > 0 ? 64 : 256));
    this.buf = this.stride.map((st) => new Int32Array((this.mbW + 2) * st * 2));
    for (let i = 0; i < tileCols; i++) this.ctx.push(new CodingContext(h.cf));
    this.tiles = Array.from({ length: tileCols }, () => ({ dc: [], lp: [], hp: [], bitsLP: 0, bitsHP: 0 }));
    const row = () => Array.from({ length: this.nCh }, () => Array.from({ length: this.mbW }, () => ({ dc: 0, qp: 0, cbp: 0, ad: new Int32Array(6) })));
    this.prev = row();
    this.cur = row();
    this.blockDC = Array.from({ length: this.nCh }, () => new Int32Array(16));
    this.cbp = new Array<number>(this.nCh).fill(0);
    this.diffCbp = new Array<number>(this.nCh).fill(0);
  }

  /** Where macroblock `x` of macroblock row `row` starts in the numbers of channel `c`. */
  at(row: number, x: number, c = 0): number {
    const st = this.stride[c]!;
    return (row & 1) * (this.mbW + 2) * st + st + x * st;
  }

  startRow(row: number): void {
    this.buf.forEach((b, c) => {
      const size = (this.mbW + 2) * this.stride[c]!;
      b.fill(0, (row & 1) * size, (row & 1) * size + size);
    });
  }

  swapPred(): void {
    const t = this.prev;
    this.prev = this.cur;
    this.cur = t;
  }
}

interface TilePos {
  col: number;
  row: number;
  left: boolean;
  top: boolean;
  reset: boolean;
  resetTotals: boolean;
}

interface Streams {
  dc: BitReader;
  lp: BitReader;
  ac: BitReader;
  fl: BitReader;
}

const aTab = [6, 9, 10, 12];

/** Reads a codestream. */
export function decodeCodestream(bytes: Uint8Array): DecodedPicture {
  const r = new BitReader(bytes);
  for (const ch of "WMPHOTO") if (r.get(8) !== ch.charCodeAt(0)) throw new JxrError("Not a JPEG XR codestream");
  if (r.get(8) !== 0) throw new JxrError("Not a JPEG XR codestream");
  const version = r.get(4);
  const sub = r.get(4);
  if (version !== 1 || sub !== 1) throw new JxrError("This version of the format (or hard tile boundaries) is not read");
  const tiling = r.get(1) === 1;
  const frequency = r.get(1) === 1;
  const orientation = r.get(3);
  const indexTable = r.get(1) === 1;
  const overlap = r.get(2);
  if (overlap === 3) throw new JxrError("Unknown overlap");
  const short = r.get(1) === 1;
  r.get(1); // long words
  const inscribed = r.get(1) === 1;
  const trimFlag = r.get(1) === 1;
  const stretch = r.get(1) === 1;
  r.get(1); // red-blue swapped
  r.get(1);
  const hasAlpha = r.get(1) === 1;
  const srcCf = r.get(4);
  const srcBd = r.get(4);
  if (srcBd !== BD_8 && srcBd !== BD_16) throw new JxrError("Only 8 and 16 bit pictures are read");
  if (orientation !== 0) throw new JxrError("Rotated pictures are not read");
  if (inscribed) throw new JxrError("Windowed pictures are not read");
  const width = r.get(short ? 16 : 32) + 1;
  const height = r.get(short ? 16 : 32) + 1;
  if (width * height > 50_000_000) throw new JxrError("The picture is too large");
  let sliceV = 0;
  let sliceH = 0;
  if (tiling) {
    sliceV = r.get(12);
    sliceH = r.get(12);
  }
  const mbW = (width + 15) >> 4;
  const mbH = (height + 15) >> 4;
  const tileX = [0];
  const tileY = [0];
  for (let i = 0; i < sliceV; i++) tileX.push(r.get(short ? 8 : 16) + tileX[i]!);
  for (let i = 0; i < sliceH; i++) tileY.push(r.get(short ? 8 : 16) + tileY[i]!);
  if (stretch) for (let i = 0; i < (sliceV + 1) * (sliceH + 1); i++) r.get(8);
  if (tileX.some((x, i) => i > 0 && (x <= tileX[i - 1]! || x >= mbW)) || tileY.some((y, i) => i > 0 && (y <= tileY[i - 1]! || y >= mbH))) throw new JxrError("The tiles do not fit the picture");
  r.flushToByte();
  const head = readPlaneHeader(r, srcBd);
  let alphaHead: PlaneHeader | undefined;
  if (hasAlpha) alphaHead = readPlaneHeader(r, srcBd);
  if (head.sb === 4 || (alphaHead && alphaHead.sb === 4)) throw new JxrError("Isolated bands are not read");

  // the index table, or the header size of a stream that has none
  const cSB = head.sb === SB_DC_ONLY ? 1 : head.sb === SB_NO_HIGHPASS ? 2 : head.sb === SB_NO_FLEXBITS ? 3 : 4;
  const tileCols = sliceV + 1;
  const tileRows = sliceH + 1;
  if (!indexTable && (frequency || tileCols * tileRows > 1)) throw new JxrError("A tiled or frequency order picture needs an index table");
  const bitIos = !indexTable ? 0 : frequency ? tileCols * cSB : tileCols;
  const offsets: number[] = [];
  const escaped: boolean[] = [];
  const vlWord = (): { value: number; escape: boolean } => {
    const s = r.get(8);
    if (s === 0xfd || s === 0xfe || s === 0xff) return { value: 0, escape: true };
    if (s < 0xfb) return { value: (s << 8) | r.get(8), escape: false };
    if (s === 0xfb) return { value: r.get(32), escape: false };
    const hi = r.get(32);
    return { value: hi * 2 ** 32 + r.get(32), escape: false };
  };
  if (bitIos > 0) {
    if (r.get(16) !== 1) throw new JxrError("The index table does not begin as it should");
    for (let i = 0; i < bitIos * tileRows; i++) {
      const w = vlWord();
      offsets.push(w.value);
      escaped.push(w.escape);
    }
  }
  const headerSize = vlWord().value;
  r.flushToByte();
  const dataStart = r.bytePos + headerSize;
  if (dataStart > bytes.length) throw new JxrError("The header is cut short");

  const bd16 = srcBd === BD_16;
  const planes = [new Plane(head, overlap, width, height, tileCols)];
  if (alphaHead) {
    if (alphaHead.cf !== CF_Y_ONLY) throw new JxrError("Alpha must be one channel");
    planes.push(new Plane(alphaHead, overlap, width, height, tileCols));
  }
  for (const p of planes) {
    if (p.h.cf !== CF_Y_ONLY && p.h.cf !== CF_YUV_420 && p.h.cf !== CF_YUV_444 && p.h.cf !== CF_NCOMPONENT && p.h.cf !== CF_CMYK) throw new JxrError("Unsupported colour format");
    // frame level quantizers
    const h = p.h;
    for (const t of p.tiles) {
      const dcOf = (idx: number[]) => idx.map((v, c) => quantizerOf(v, c > 0 ? 0 : 1, h.scaled));
      if (!h.dcPerTile) t.dc = dcOf(h.dcIdx);
      if (h.sb !== SB_DC_ONLY && !h.lpPerTile) t.lp = [h.lpUsesDc ? t.dc : dcOf(h.lpIdx)];
      if (h.sb !== SB_DC_ONLY && h.sb !== SB_NO_HIGHPASS && !h.hpPerTile) t.hp = [h.hpUsesLp ? t.lp[0]! : h.hpIdx.map((v) => quantizerOf(v, 1, h.scaled))];
    }
  }

  // the streams
  let streams: Streams[] = [];
  const makeStreams = (tileRow: number): Streams[] => {
    const out: Streams[] = [];
    for (let c = 0; c < tileCols; c++) {
      if (!bitIos) {
        const s = new BitReader(bytes, dataStart);
        out.push({ dc: s, lp: s, ac: s, fl: s });
      } else if (!frequency) {
        const k = tileRow * bitIos + c;
        const s = new BitReader(bytes, dataStart + offsets[k]!);
        out.push({ dc: s, lp: s, ac: s, fl: s });
      } else {
        const rd = (b: number): BitReader => {
          if (b >= cSB) return new BitReader(new Uint8Array(0));
          const k = tileRow * bitIos + c * cSB + b;
          return escaped[k] ? new BitReader(new Uint8Array(0)) : new BitReader(bytes, dataStart + offsets[k]!);
        };
        out.push({ dc: rd(0), lp: rd(1), ac: rd(2), fl: rd(3) });
      }
    }
    return out;
  };
  const skipFlex = head.sb === SB_NO_FLEXBITS;
  const readPacketHeader = (s: BitReader): void => {
    if (s.get(8) !== 0 || s.get(8) !== 0 || s.get(8) !== 1) throw new JxrError("A packet does not begin as it should");
    s.get(8);
  };

  const pos: TilePos = { col: 0, row: 0, left: true, top: true, reset: true, resetTotals: true };
  const tilePos = (mx: number, my: number): void => {
    if (mx === 0) pos.col = 0;
    else if (pos.col < sliceV && mx === tileX[pos.col + 1]) pos.col++;
    if (my === 0) pos.row = 0;
    else if (pos.row < sliceH && my === tileY[pos.row + 1]) pos.row++;
    pos.left = mx === tileX[pos.col];
    pos.top = my === tileY[pos.row];
    pos.reset = pos.resetTotals = ((mx - tileX[pos.col]!) & 15) === 0;
    if (pos.col === sliceV) {
      if (mx + 1 === mbW) pos.reset = true;
    } else if (mx + 1 === tileX[pos.col + 1]) pos.reset = true;
  };

  /** The tile header of one plane: quantizers for the tile, when it has its own. */
  const readTileHeaders = (p: Plane, s: Streams): void => {
    const h = p.h;
    const tile = p.tiles[pos.col]!;
    const nCh = p.nCh;
    if (h.dcPerTile) {
      const idx = readIndexes(s.dc, nCh);
      tile.dc = idx.map((v, c) => quantizerOf(v, c > 0 ? 0 : 1, h.scaled));
    }
    tile.bitsLP = 0;
    tile.bitsHP = 0;
    if (h.sb !== SB_DC_ONLY && h.lpPerTile) {
      const useDc = s.lp.get(1) === 1;
      if (useDc) tile.lp = [tile.dc];
      else {
        const n = s.lp.get(4) + 1;
        tile.bitsLP = dquantBits(n);
        tile.lp = [];
        for (let i = 0; i < n; i++) tile.lp.push(readIndexes(s.lp, nCh).map((v, c) => quantizerOf(v, c > 0 ? 0 : 1, h.scaled)));
      }
    }
    if (h.sb !== SB_DC_ONLY && h.sb !== SB_NO_HIGHPASS && h.hpPerTile) {
      const useLp = s.ac.get(1) === 1;
      if (useLp) tile.hp = tile.lp.map((q) => q);
      else {
        const n = s.ac.get(4) + 1;
        tile.bitsHP = dquantBits(n);
        tile.hp = [];
        for (let i = 0; i < n; i++) tile.hp.push(readIndexes(s.ac, nCh).map((v) => quantizerOf(v, 1, h.scaled)));
      }
    }
  };

  // ---- the macroblock ------------------------------------------------------------------------------------------------

  const getAcPredMode = (p: Plane): number => {
    const y = p.blockDC[0]!;
    let strH = Math.abs(y[1]!) + Math.abs(y[2]!) + Math.abs(y[3]!);
    let strV = Math.abs(y[4]!) + Math.abs(y[8]!) + Math.abs(y[12]!);
    if (p.cf !== CF_Y_ONLY && p.cf !== CF_NCOMPONENT) {
      const u = p.blockDC[1]!;
      const v = p.blockDC[2]!;
      strH += Math.abs(u[1]!) + Math.abs(v[1]!);
      strV += p.cf === CF_YUV_420 ? Math.abs(u[2]!) + Math.abs(v[2]!) : Math.abs(u[4]!) + Math.abs(v[4]!);
    }
    return strH * 4 < strV ? 1 : strV * 4 < strH ? 0 : 2;
  };

  const getDcAcPredMode = (p: Plane, mx: number): number => {
    let dcMode: number;
    if (pos.left && pos.top) dcMode = 3;
    else if (pos.left) dcMode = 1;
    else if (pos.top) dcMode = 0;
    else {
      const l = p.cur[0]![mx - 1]!.dc;
      const t = p.prev[0]![mx]!.dc;
      const tl = p.prev[0]![mx - 1]!.dc;
      let strH: number;
      let strV: number;
      if (p.cf === CF_Y_ONLY || p.cf === CF_NCOMPONENT) {
        strH = Math.abs(tl - l);
        strV = Math.abs(tl - t);
      } else {
        const scale = p.cf === CF_YUV_420 ? 8 : 2;
        strH = Math.abs(tl - l) * scale + Math.abs(p.prev[1]![mx - 1]!.dc - p.cur[1]![mx - 1]!.dc) + Math.abs(p.prev[2]![mx - 1]!.dc - p.cur[2]![mx - 1]!.dc);
        strV = Math.abs(tl - t) * scale + Math.abs(p.prev[1]![mx - 1]!.dc - p.prev[1]![mx]!.dc) + Math.abs(p.prev[2]![mx - 1]!.dc - p.prev[2]![mx]!.dc);
      }
      dcMode = strH * 4 < strV ? 1 : strV * 4 < strH ? 0 : 2;
    }
    let adMode = 2;
    if (dcMode === 1 && p.qLP === p.prev[0]![mx]!.qp) adMode = 1;
    if (dcMode === 0 && p.qLP === p.cur[0]![mx - 1]!.qp) adMode = 0;
    return dcMode + (adMode << 2);
  };

  const decodeDc = (p: Plane, ctx: CodingContext, rd: BitReader): void => {
    const tile = p.tiles[pos.col]!;
    for (const b of p.blockDC) b.fill(0);
    p.qLP = p.qHP = 0;
    if (!frequency && head.sb !== SB_DC_ONLY) {
      if (tile.bitsLP > 0) p.qLP = decodeQpIndex(rd, tile.bitsLP);
      if (head.sb !== SB_NO_HIGHPASS && tile.bitsHP > 0) p.qHP = decodeQpIndex(rd, tile.bitsHP);
    }
    if (tile.bitsHP === 0 && tile.hp.length > 1) p.qHP = p.qLP;
    if (p.qLP >= Math.max(1, tile.lp.length) || p.qHP >= Math.max(1, tile.hp.length)) throw new JxrError("A quantizer index is out of range");
    const model = ctx.modelDC;
    const mean: [number, number] = [0, 0];
    if (p.cf === CF_Y_ONLY || p.cf === CF_CMYK || p.cf === CF_NCOMPONENT) {
      for (let c = 0; c < p.nCh; c++) {
        const bits = model.bits[c === 0 ? 0 : 1]!;
        let q = 0;
        if (rd.get(1)) {
          q = decodeAbsLevel(rd, ctx.ah[3]!) - 1;
          mean[c === 0 ? 0 : 1]++;
        }
        if (bits) q = q * 2 ** bits + rd.get(bits);
        if (q && rd.get(1)) q = -q;
        p.blockDC[c]![0] = q;
      }
    } else {
      const idx = ctx.ah[2]!.read(rd);
      const flags = [idx >> 2, (idx >> 1) & 1, idx & 1];
      for (let c = 0; c < 3; c++) {
        const bits = model.bits[c === 0 ? 0 : 1]!;
        let q = 0;
        if (flags[c]) {
          q = decodeAbsLevel(rd, ctx.ah[c === 0 ? 3 : 4]!) - 1;
          mean[c === 0 ? 0 : 1]++;
        }
        if (bits) q = q * 2 ** bits + rd.get(bits);
        if (q && rd.get(1)) q = -q;
        p.blockDC[c]![0] = q;
      }
    }
    updateModel(p.cf, p.nCh, mean, model);
    if (head.sb === SB_DC_ONLY && pos.reset) for (let k = 2; k < 5; k++) ctx.ah[k]!.adapt();
  };

  const rl = new Int32Array(40);

  const decodeLp = (p: Plane, ctx: CodingContext, rd: BitReader): void => {
    const tile = p.tiles[pos.col]!;
    if (frequency && tile.bitsLP > 0) p.qLP = decodeQpIndex(rd, tile.bitsLP);
    const scan = ctx.scanLow;
    if (pos.resetTotals) scan.resetTotals();
    let cbp = 0;
    const nCh = p.nCh;
    const sub = p.cf === CF_YUV_420;
    // (the chroma of 4:2:0 is coded as one block for both channels)
    const full = sub ? 2 : nCh;
    if (p.cf === CF_YUV_444 || sub) {
      let countM = ctx.cbpCountMax;
      let countZ = ctx.cbpCountZero;
      const iMax = full * 4 - 5;
      if (countZ <= 0 || countM < 0) {
        cbp = 0;
        if (rd.get(1)) {
          cbp = 1;
          const k = rd.get(full - 1);
          if (k) cbp = k * 2 + rd.get(1);
        }
        if (countM < countZ) cbp = iMax - cbp;
      } else cbp = rd.get(full);
      countM += 1 - 4 * (cbp === iMax ? 1 : 0);
      countZ += 1 - 4 * (cbp === 0 ? 1 : 0);
      ctx.cbpCountMax = Math.max(-8, Math.min(7, countM));
      ctx.cbpCountZero = Math.max(-8, Math.min(7, countZ));
    } else for (let c = 0; c < nCh; c++) cbp |= rd.get(1) << c;
    const model = ctx.modelLP;
    const mean: [number, number] = [0, 0];
    for (let c = 0; c < full; c++) {
      const bits = model.bits[c === 0 ? 0 : 1]!;
      const coef = p.blockDC[c]!;
      const chroma420 = sub && c === 1;
      if (cbp & 1) {
        const n = decodeBlock(rd, ctx, c > 0, rl, CT_DC, chroma420 ? 10 : 1);
        mean[c === 0 ? 0 : 1] += n;
        if (chroma420) {
          // six numbers, taken in turn by the two channels
          const temp = new Int32Array(16);
          let index = 0;
          for (let k = 0; k < n; k++) {
            index += rl[k * 2]!;
            temp[index & 15] = rl[k * 2 + 1]!;
            index++;
          }
          for (let k = 0; k < 6; k++) p.blockDC[(k & 1) + 1]![1 + (k >> 1)] = temp[k]!;
        } else {
          let index = 1;
          for (let k = 0; k < n; k++) {
            index += rl[k * 2]!;
            if (index > 15) throw new JxrError("A coefficient is past the end of its block");
            coef[scan.scan[index]!] = rl[k * 2 + 1]!;
            scan.bump(index);
            index++;
          }
        }
      }
      if (bits) {
        if (chroma420) {
          for (let k = 1; k < 4; k++) {
            for (const ch of [1, 2]) {
              const d = p.blockDC[ch]!;
              const v = d[k]!;
              if (v > 0) d[k] = v * 2 ** bits + rd.get(bits);
              else if (v < 0) d[k] = v * 2 ** bits - rd.get(bits);
              else d[k] = rd.getSigned(bits);
            }
          }
        } else {
          for (let k = 1; k < 16; k++) {
            const v = coef[k]!;
            if (v > 0) coef[k] = v * 2 ** bits + rd.get(bits);
            else if (v < 0) coef[k] = v * 2 ** bits - rd.get(bits);
            else coef[k] = rd.getSigned(bits);
          }
        }
      }
      cbp >>= 1;
    }
    updateModel(p.cf, nCh, mean, model);
    if (pos.reset) ctx.adaptLowpass();
  };

  const predDcAc = (p: Plane, mx: number): void => {
    const mode = getDcAcPredMode(p, mx);
    const dcMode = mode & 3;
    const adMode = mode & 12;
    const sub = p.cf === CF_YUV_420;
    for (let c = 0; c < p.nCh; c++) {
      const d = p.blockDC[c]!;
      const chroma420 = sub && c > 0;
      if (dcMode === 1) d[0] = d[0]! + p.prev[c]![mx]!.dc;
      else if (dcMode === 0) d[0] = d[0]! + p.cur[c]![mx - 1]!.dc;
      else if (dcMode === 2) d[0] = d[0]! + ((p.cur[c]![mx - 1]!.dc + p.prev[c]![mx]!.dc + (chroma420 ? 1 : 0)) >> 1);
      if (chroma420) {
        if (adMode === 4) d[2] = d[2]! + p.prev[c]![mx]!.ad[1]!;
        else if (adMode === 0) d[1] = d[1]! + p.cur[c]![mx - 1]!.ad[0]!;
      } else if (adMode === 4) {
        const ref = p.prev[c]![mx]!.ad;
        d[4] = d[4]! + ref[3]!;
        d[8] = d[8]! + ref[4]!;
        d[12] = d[12]! + ref[5]!;
      } else if (adMode === 0) {
        const ref = p.cur[c]![mx - 1]!.ad;
        d[1] = d[1]! + ref[0]!;
        d[2] = d[2]! + ref[1]!;
        d[3] = d[3]! + ref[2]!;
      }
    }
    p.orientation = 2 - getAcPredMode(p);
  };

  const dequantize = (p: Plane, row: number, column: number): void => {
    const tile = p.tiles[pos.col]!;
    for (let c = 0; c < p.nCh; c++) {
      const buf = p.buf[c]!;
      const base = p.at(row, column, c);
      buf[base] = p.blockDC[c]![0]! * tile.dc[c]!;
      if (head.sb !== SB_DC_ONLY) {
        const q = tile.lp[p.qLP]![c]!;
        const d = p.blockDC[c]!;
        if (p.cf === CF_YUV_420 && c > 0) {
          buf[base + 32] = d[1]! * q;
          buf[base + 16] = d[2]! * q;
          buf[base + 48] = d[3]! * q;
        } else for (let k = 1; k < 16; k++) buf[base + DCT_INDEX[2]![k]!] = d[k]! * q;
      }
    }
  };

  const decodeCbp = (p: Plane, ctx: CodingContext, rd: BitReader): void => {
    const planes = p.cf === CF_NCOMPONENT || p.cf === CF_CMYK ? p.nCh : 1;
    const ahC = ctx.cbpy;
    const ahC1 = ctx.cbpy1;
    for (let i = 0; i < planes; i++) {
      let cy = 0;
      let cu = 0;
      let cv = 0;
      const symbol = ahC1.read(rd);
      ahC1.disc += ahC1.delta![symbol]!;
      let groups = symbol;
      if (symbol === 2) {
        const b = rd.get(2);
        if (b === 0) groups = 3;
        else if (b === 1) groups = 5;
        else groups = aTab[b * 2 + rd.get(1) - 4]!;
      } else if (symbol === 1) groups = 1 << rd.get(2);
      else if (symbol === 3) groups = 0xf ^ (1 << rd.get(2));
      else if (symbol === 4) groups = 0xf;
      for (let g = 0; g < 4; g++) {
        if (!(groups & (1 << g))) continue;
        const sym = ahC.read(rd);
        ahC.disc += ahC.delta![sym]!;
        let val = sym + 1;
        let block = 0;
        if (val >= 6) {
          if (rd.get(1)) block = 0x10;
          else if (rd.get(1)) block = 0x20;
          else block = 0x30;
          if (val === 9) {
            if (rd.get(1)) {
              // stays 9
            } else if (rd.get(1)) val = 10;
            else val = 11;
          }
          val -= 6;
        }
        let code = CBP_OFF[val]!;
        if (CBP_FLC[val]) code += rd.get(CBP_FLC[val]!);
        block += CBP_OUT[code]!;
        cy |= (block & 0xf) << (g * 4);
        if (p.cf === CF_YUV_420) {
          cu |= ((block >> 4) & 1) << g;
          cv |= ((block >> 5) & 1) << g;
        }
        if (p.cf === CF_YUV_444) {
          for (let k = 0; k < 2; k++) {
            if (!((block >> (k + 4)) & 1)) continue;
            const a1 = ctx.ah[1]!;
            let c = a1.read(rd);
            if (c === 1) {
              c = rd.get(2);
              if (c === 0) c = 3;
              else if (c === 1) c = 5;
              else c = aTab[c * 2 + rd.get(1) - 4]!;
            } else if (c === 0) c = 1 << rd.get(2);
            else if (c === 2) c = 0xf ^ (1 << rd.get(2));
            else c = 0xf;
            if (k === 0) cu |= c << (g * 4);
            else cv |= c << (g * 4);
          }
        }
      }
      p.diffCbp[i] = cy;
      if (p.cf === CF_YUV_444 || p.cf === CF_YUV_420) {
        p.diffCbp[1] = cu;
        p.diffCbp[2] = cv;
      }
    }
  };

  const predCbp = (p: Plane, ctx: CodingContext, mx: number): void => {
    for (let c = 0; c < p.nCh; c++) {
      const c1 = c ? 1 : 0;
      const m = ctx.cbp;
      let cbp = p.diffCbp[c]!;
      if (p.cf === CF_YUV_420 && c > 0) {
        // the chroma of 4:2:0 has four blocks
        if (m.state[1] === 0) {
          if (pos.left) {
            if (pos.top) cbp ^= 1;
            else cbp ^= (p.prev[c]![mx]!.cbp >> 2) & 1;
          } else cbp ^= (p.cur[c]![mx - 1]!.cbp >> 1) & 1;
          cbp ^= 0x02 & (cbp << 1);
          cbp ^= (cbp & 0x3) << 2;
        } else if (m.state[1] === 2) cbp ^= 0xf;
        updateCbpModel(m, 1, numOnes(cbp) * 4);
        p.cbp[c] = cbp;
        p.cur[c]![mx]!.cbp = cbp;
        continue;
      }
      if (m.state[c1] === 0) {
        if (pos.left) {
          if (pos.top) cbp ^= 1;
          else cbp ^= (p.prev[c]![mx]!.cbp >> 10) & 1;
        } else cbp ^= (p.cur[c]![mx - 1]!.cbp >> 5) & 1;
        cbp ^= 0x02 & (cbp << 1);
        cbp ^= 0x10 & (cbp << 3);
        cbp ^= 0x20 & (cbp << 1);
        cbp ^= (cbp & 0x33) << 2;
        cbp ^= (cbp & 0xcc) << 6;
        cbp ^= (cbp & 0x3300) << 2;
      } else if (m.state[c1] === 2) cbp ^= 0xffff;
      cbp &= 0xffff;
      updateCbpModel(m, c1, numOnes(cbp));
      p.cbp[c] = cbp;
      p.cur[c]![mx]!.cbp = cbp;
    }
  };

  const decodeHp = (p: Plane, ctx: CodingContext, ac: BitReader, fl: BitReader, row: number, mx: number): void => {
    const tile = p.tiles[pos.col]!;
    if (pos.resetTotals) {
      ctx.scanH.resetTotals();
      ctx.scanV.resetTotals();
    }
    if (frequency && tile.bitsHP > 0) {
      p.qHP = decodeQpIndex(ac, tile.bitsHP);
      if (p.qHP >= tile.hp.length) throw new JxrError("A quantizer index is out of range");
    } else if (tile.bitsHP === 0 && tile.hp.length > 1) p.qHP = p.qLP;
    decodeCbp(p, ctx, ac);
    predCbp(p, ctx, mx);
    const scan: AdaptiveScan = p.orientation === 1 ? ctx.scanV : ctx.scanH;
    const model = ctx.modelAC;
    const mean: [number, number] = [0, 0];
    const trim = ctx.trimFlexBits;
    for (let c = 0; c < p.nCh; c++) {
      const bits = model.bits[c === 0 ? 0 : 1]!;
      const chroma = c > 0;
      const qp = tile.hp[p.qHP]![c]!;
      const buf = p.buf[c]!;
      const base = p.at(row, mx, c);
      const small = p.cf === CF_YUV_420 && c > 0;
      const offsets = small ? BLK_OFFSET_420_CHROMA : BLK_OFFSET;
      let pattern = p.cbp[c]!;
      let flex = bits - trim;
      if (flex < 0 || skipFlex) flex = 0;
      for (let b = 0; b < offsets.length; b++, pattern >>= 1) {
        const o = base + offsets[b]!;
        if (pattern & 1) {
          const n = decodeBlock(ac, ctx, chroma, rl, CT_DC + CONTEXT_X, 1);
          mean[chroma ? 1 : 0] += n;
          let index = 1;
          const mul = qp * 2 ** bits;
          for (let k = 0; k < n; k++) {
            index += rl[k * 2]!;
            if (index > 15) throw new JxrError("A coefficient is past the end of its block");
            buf[o + scan.scan[index]!] = rl[k * 2 + 1]! * mul;
            scan.bump(index);
            index++;
          }
        }
        if (flex) {
          const order = DCT_INDEX[0]!;
          if (qp + trim === 1) {
            for (let k = 1; k < 16; k++) {
              const at = o + order[k]!;
              const v = buf[at]!;
              if (v < 0) buf[at] = v - fl.get(flex);
              else if (v > 0) buf[at] = v + fl.get(flex);
              else buf[at] = fl.getSigned(flex);
            }
          } else {
            const q1 = qp * 2 ** trim;
            for (let k = 1; k < 16; k++) {
              const at = o + order[k]!;
              const v = buf[at]!;
              if (v < 0) buf[at] = v - q1 * fl.get(flex);
              else if (v > 0) buf[at] = v + q1 * fl.get(flex);
              else buf[at] = q1 * fl.getSigned(flex);
            }
          }
        }
      }
    }
    updateModel(p.cf, p.nCh, mean, model);
    if (pos.reset) ctx.adaptHighpass();
  };

  const predAc = (p: Plane, row: number, mx: number): void => {
    const mode = 2 - p.orientation;
    for (let c = 0; c < p.nCh; c++) {
      const buf = p.buf[c]!;
      const base = p.at(row, mx, c);
      if (p.cf === CF_YUV_420 && c > 0) {
        if (mode === 1) {
          for (const blockOffset of [16, 48]) {
            const o = base + blockOffset;
            buf[o + 2] = buf[o + 2]! + buf[o + 2 - 16]!;
            buf[o + 10] = buf[o + 10]! + buf[o + 10 - 16]!;
            buf[o + 9] = buf[o + 9]! + buf[o + 9 - 16]!;
          }
        } else if (mode === 0) {
          for (const blockOffset of [32, 48]) {
            const o = base + blockOffset;
            buf[o + 1] = buf[o + 1]! + buf[o + 1 - 32]!;
            buf[o + 5] = buf[o + 5]! + buf[o + 5 - 32]!;
            buf[o + 6] = buf[o + 6]! + buf[o + 6 - 32]!;
          }
        }
        continue;
      }
      if (mode === 1) {
        for (const blk of [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15]) {
          const o = base + 16 * blk;
          buf[o + 2] = buf[o + 2]! + buf[o + 2 - 16]!;
          buf[o + 10] = buf[o + 10]! + buf[o + 10 - 16]!;
          buf[o + 9] = buf[o + 9]! + buf[o + 9 - 16]!;
        }
      } else if (mode === 0) {
        for (let j = 64; j < 256; j += 16) {
          const o = base + j;
          buf[o + 1] = buf[o + 1]! + buf[o + 1 - 64]!;
          buf[o + 5] = buf[o + 5]! + buf[o + 5 - 64]!;
          buf[o + 6] = buf[o + 6]! + buf[o + 6 - 64]!;
        }
      }
    }
  };

  const updatePred = (p: Plane, mx: number): void => {
    for (let c = 0; c < p.nCh; c++) {
      const pr = p.cur[c]![mx]!;
      const d = p.blockDC[c]!;
      pr.dc = d[0]!;
      pr.qp = p.qLP;
      pr.ad[0] = d[1]!;
      pr.ad[1] = d[2]!;
      pr.ad[2] = d[3]!;
      pr.ad[3] = d[4]!;
      pr.ad[4] = d[8]!;
      pr.ad[5] = d[12]!;
    }
  };

  // ---- the rows ------------------------------------------------------------------------------------------------------

  // ---- colour: how the numbers of a pixel become its bytes ----------------------------------------------------------------

  const main = planes[0]!;
  const nLen = main.h.shiftLen;
  const clipTo = (v: number): number => {
    if (bd16) {
      v = v << nLen;
      return Math.max(0, Math.min(65535, v)) >> 8;
    }
    return v < 0 ? 0 : v > 255 ? 255 : v;
  };
  let channels: number;
  if (main.cf === CF_Y_ONLY) channels = 1;
  else if ((main.cf === CF_YUV_444 || main.cf === CF_YUV_420) && srcCf === SRC_RGB) channels = 3;
  else throw new JxrError("Only grey and RGB pictures are read");
  const outChannels = channels + (alphaHead ? 1 : 0);
  const data = new Uint8Array(width * height * outChannels);

  /** The chroma of a 4:2:0 picture made as tall and as wide as the picture: the rule is the standard's (halfway between neighbours). */
  const upsample = (p: Plane, mbRow: number, ch: number): Int32Array => {
    const W = mbW * 16;
    const buf = p.buf[ch]!;
    const last = mbRow + 1 === mbH;
    const tmp = new Int32Array(16 * W);
    for (let cc = 0; cc < mbW * 8; cc++) {
      const src = (r: number): number => buf[p.at(mbRow, cc >> 3, ch) + IDX_420[r * 8 + (cc & 7)]!]!;
      const x = cc * 2;
      for (let row = 0; row < 16; row += 2) {
        tmp[row * W + x] = src(row >> 1);
        if (row > 0) tmp[(row - 1) * W + x] = (tmp[(row - 2) * W + x]! + tmp[row * W + x]! + 1) >> 1;
      }
      const below = last ? tmp[14 * W + x]! : (buf[p.at(mbRow + 1, cc >> 3, ch) + IDX_420[cc & 7]!]! + tmp[14 * W + x]! + 1) >> 1;
      tmp[15 * W + x] = below;
    }
    for (let row = 0; row < 16; row++) {
      for (let col = 1; col < W - 2; col += 2) tmp[row * W + col] = (tmp[row * W + col + 1]! + tmp[row * W + col - 1]! + 1) >> 1;
      tmp[row * W + W - 1] = tmp[row * W + W - 2]!;
    }
    return tmp;
  };

  /** Takes the macroblock row `mbRow` of a plane, brings the numbers to colours and puts them in the picture. */
  const writeRow = (p: Plane, mbRow: number): void => {
    const y0 = mbRow * 16;
    const rows = Math.min(16, height - y0);
    const vals = Array.from({ length: p.nCh }, () => new Int32Array(rows * width));
    for (let c = 0; c < p.nCh; c++) {
      const out = vals[c]!;
      if (p.cf === CF_YUV_420 && c > 0) {
        const full = upsample(p, mbRow, c);
        for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) out[y * width + x] = full[y * mbW * 16 + x]!;
        continue;
      }
      const buf = p.buf[c]!;
      for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) out[y * width + x] = buf[p.at(mbRow, x >> 4, c) + IDX_CC[y * 16 + (x & 15)]!]!;
    }
    const isAlpha = p !== planes[0];
    const shiftOf = p.h.scaled ? SHIFT_SCALED : 0;
    const biasOf = bd16 ? ((32768 >> nLen) << shiftOf) + (shiftOf ? 1 << (shiftOf - 1) : 0) : (128 << shiftOf) + (p.h.scaled ? (1 << (SHIFT_SCALED - 1)) - 1 : 0);
    for (let i = 0; i < rows * width; i++) {
      const at = (y0 * width + i) * outChannels;
      if (isAlpha) data[at + channels] = clipTo((vals[0]![i]! + biasOf) >> shiftOf);
      else if (channels === 1) data[at] = clipTo((vals[0]![i]! + biasOf) >> shiftOf);
      else {
        let g = vals[0]![i]! + biasOf;
        let r = -vals[1]![i]!;
        let b = vals[2]![i]!;
        g -= r >> 1;
        r -= ((b + 1) >> 1) - g;
        b += r;
        data[at] = clipTo(r >> shiftOf);
        data[at + 1] = clipTo(g >> shiftOf);
        data[at + 2] = clipTo(b >> shiftOf);
      }
    }
  };

  for (let cRow = 0; cRow <= mbH; cRow++) {
    for (const p of planes) p.startRow(cRow);
    for (let cColumn = 0; cColumn <= mbW; cColumn++) {
      for (const p of planes) {
        const bottom = cRow === mbH;
        const right = cColumn === mbW;
        if (!bottom && !right) {
          tilePos(cColumn, cRow);
          // the start of a tile row: the streams, their headers and fresh coding contexts
          if (cColumn === 0 && cRow === tileY[pos.row]) {
            if (p === planes[0]) {
              streams = makeStreams(pos.row);
              for (let k = 0; k < tileCols; k++) {
                const s = streams[k]!;
                if (!frequency) {
                  readPacketHeader(s.dc);
                  // (the alpha of the same codestream is not trimmed, as the reference decoder reads it)
                  planes[0]!.ctx[k]!.trimFlexBits = trimFlag ? s.dc.get(4) : 0;
                } else {
                  readPacketHeader(s.dc);
                  if (cSB > 1) readPacketHeader(s.lp);
                  if (cSB > 2) readPacketHeader(s.ac);
                  if (cSB > 3) {
                    try {
                      readPacketHeader(s.fl);
                    } catch {
                      // a flexbits packet that is missing is not an error
                    }
                    const trim = trimFlag ? s.fl.get(4) : 0;
                    planes[0]!.ctx[k]!.trimFlexBits = trim;
                  }
                }
              }
            }
            for (let k = 0; k < tileCols; k++) {
              const trim = p.ctx[k]!.trimFlexBits;
              p.ctx[k]!.reset();
              p.ctx[k]!.trimFlexBits = trim;
            }
          }
          const s = streams[pos.col]!;
          if (pos.left && pos.top && p === planes[0]) for (const q of planes) readTileHeaders(q, s);
          const ctx = p.ctx[pos.col]!;
          decodeDc(p, ctx, s.dc);
          if (head.sb !== SB_DC_ONLY) decodeLp(p, ctx, s.lp);
          predDcAc(p, cColumn);
          dequantize(p, cRow, cColumn);
          if (head.sb !== SB_DC_ONLY && head.sb !== SB_NO_HIGHPASS) {
            decodeHp(p, ctx, s.ac, s.fl, cRow, cColumn);
            predAc(p, cRow, cColumn);
          }
          updatePred(p, cColumn);
        }
        // undo the transforms of what can now be finished
        const at = { left: cColumn === 0, right, top: cRow === 0, bottom };
        for (let c = 0; c < p.nCh; c++) {
          const p1 = p.at(cRow, cColumn, c);
          const p0 = cRow > 0 ? p.at(cRow - 1, cColumn, c) : 0;
          if (p.cf === CF_YUV_420 && c > 0) invTransformChroma420(p.buf[c]!, p0, p1, { ...at, leftAdjacent: cColumn === 1, rightAdjacent: cColumn === mbW - 1 }, overlap, p.h.scaled, p.corners[c - 1]!);
          else invTransformChannel(p.buf[c]!, p0, p1, at, overlap, p.h.scaled, c > 0);
        }
      }
    }
    if (cRow > 0) for (const p of planes) writeRow(p, cRow - 1);
    for (const p of planes) p.swapPred();
  }

  return { width, height, channels: outChannels, data };
}
