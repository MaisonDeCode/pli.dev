import {
  AdaptiveHuffman,
  AdaptiveScan,
  BLK_OFFSET,
  BD_8,
  BitWriter,
  CF_NCOMPONENT,
  CF_Y_ONLY,
  CF_YUV_444,
  CONTEXT_X,
  CodingContext,
  CT_DC,
  DCT_INDEX,
  IDX_CC,
  JxrError,
  OL_ONE,
  SB_ALL,
  SB_DC_ONLY,
  SB_NO_HIGHPASS,
  SIGNIFICANT_RUN_BIN,
  SIGNIFICANT_RUN_FIXED,
  numOnes,
  updateCbpModel,
  updateModel,
} from "./jxr-common";
import { fwdTransformChannel } from "./jxr-transform";

/*
 * A JPEG XR codestream encoder: one tile, spatial order, no overlap between blocks, all bands, every quantizer 1. Nothing is
 * lost: what the decoder gives back is exactly what was put in. The codestream is what follows the container's header.
 */

export interface PlanesInput {
  width: number;
  height: number;
  /** How it is coded: `CF_Y_ONLY` (one plane) or `CF_YUV_444` (three planes). */
  cf: number;
  /** The colour format of the picture it stands for (4 bits in the header): 0 grey, 7 RGB. */
  srcCf: number;
  /** How much the blocks overlap (0 none, 1 one level, 2 two levels); the default is 1. */
  overlap?: number;
  /** Frequency order (the bands in packets of their own, with an index table) rather than spatial order. */
  frequency?: boolean;
  /** The widths of the tile columns and the heights of the tile rows, in macroblocks (they add up to the size of the picture); one tile when left out. */
  tileWidths?: number[];
  tileHeights?: number[];
  /** Which bands are written: 0 all, 1 all but the flexbits, 2 not the high pass, 3 only the DC. The picture is then not what was put in. */
  subband?: number;
  /** How many of the lowest bits of the high pass coefficients are not written (0 to 15); the picture is then not what was put in. */
  trimFlexBits?: number;
  /** A fourth, grey plane that is the alpha, coded in the same codestream (interleaved) rather than in a file of its own; centred like the others. */
  alpha?: Int32Array;
  /** One array of `width * height` numbers for each plane, already centred on 0 and, for colour, already converted. */
  planes: Int32Array[];
}

/** The lossless colour conversion from RGB (each 0 to 255) to the three planes the colour is coded in. */
export function rgbToPlanes(rgb: Uint8Array | Uint8ClampedArray, width: number, height: number, stride: number, order: "rgb" | "bgr" = "rgb"): Int32Array[] {
  const n = width * height;
  const y = new Int32Array(n);
  const u = new Int32Array(n);
  const v = new Int32Array(n);
  const ri = order === "rgb" ? 0 : 2;
  const bi = 2 - ri;
  for (let i = 0; i < n; i++) {
    let r = rgb[i * stride + ri]!;
    let g = rgb[i * stride + 1]!;
    let b = rgb[i * stride + bi]!;
    b -= r;
    r += ((b + 1) >> 1) - g;
    g += r >> 1;
    u[i] = -r;
    v[i] = b;
    y[i] = g - 128;
  }
  return [y, u, v];
}

/** Writes the number of bytes or the offset the way the header does: 2 bytes up to 0xfaff, more after an escape byte. */
function putVlWord(w: BitWriter, s: number): void {
  if (s < 0xfb00) w.put(s, 16);
  else {
    w.put(0xfb, 8);
    w.put(Math.floor(s / 65536) & 0xffff, 16);
    w.put(s & 0xffff, 16);
  }
}

interface PredInfo {
  dc: number;
  cbp: number;
  ad: Int32Array;
}

/** What the encoder needs per macroblock for the prediction of its neighbours. */
class PredRow {
  info: PredInfo[];
  constructor(width: number) {
    this.info = Array.from({ length: width }, () => ({ dc: 0, cbp: 0, ad: new Int32Array(6) }));
  }
}

const ORIENT_WEIGHT = 4;

/** The bit streams of a tile: in spatial order all four are the same one. */
interface TileStreams {
  dc: BitWriter;
  lp: BitWriter;
  ac: BitWriter;
  fl: BitWriter;
  all: BitWriter[];
}

/** The coded bytes of one picture (a codestream, from "WMPHOTO" on). */
export function encodeCodestream(inp: PlanesInput): Uint8Array {
  const { width, height, cf, planes } = inp;
  if (cf !== CF_Y_ONLY && cf !== CF_YUV_444) throw new JxrError("Only grey and 4:4:4 colour are written");
  const nCh = planes.length;
  if (nCh !== (cf === CF_Y_ONLY ? 1 : 3)) throw new JxrError("The planes do not fit the colour format");
  if (width < 1 || height < 1 || width > 65536 * 16 || height > 65536 * 16) throw new JxrError("The picture is too large or too small");
  const mbW = (width + 15) >> 4;
  const mbH = (height + 15) >> 4;
  const frequency = inp.frequency === true;
  const subband = inp.subband ?? SB_ALL;
  const trim = subband === 1 ? 0 : (inp.trimFlexBits ?? 0);
  if (subband < 0 || subband > 3 || trim < 0 || trim > 15 || !Number.isInteger(trim)) throw new JxrError("Unknown band or trim");
  const tileWidths = inp.tileWidths ?? [mbW];
  const tileHeights = inp.tileHeights ?? [mbH];
  if (tileWidths.reduce((n, v) => n + v, 0) !== mbW || tileHeights.reduce((n, v) => n + v, 0) !== mbH || [...tileWidths, ...tileHeights].some((v) => v < 1)) throw new JxrError("The tiles do not fit the picture");
  const tileX = [0];
  for (const v of tileWidths) tileX.push(tileX[tileX.length - 1]! + v);
  const tileY = [0];
  for (const v of tileHeights) tileY.push(tileY[tileY.length - 1]! + v);
  const tiled = tileWidths.length > 1 || tileHeights.length > 1;
  const indexTable = frequency || tiled;
  const cSB = subband === SB_ALL ? 4 : subband === 1 ? 3 : subband === 2 ? 2 : 1;
  const w = new BitWriter();
  writeHeader(w, inp, mbW, mbH, { tileX, tileY, indexTable, frequency, subband, trim });
  const overlap = inp.overlap ?? OL_ONE;

  // the bit streams of each tile, and the coding context of each tile column
  const streams: TileStreams[][] = tileHeights.map(() =>
    tileWidths.map(() => {
      if (!frequency) {
        const one = new BitWriter();
        return { dc: one, lp: one, ac: one, fl: one, all: [one] };
      }
      const four = [new BitWriter(), new BitWriter(), new BitWriter(), new BitWriter()];
      return { dc: four[0]!, lp: four[1]!, ac: four[2]!, fl: four[3]!, all: four.slice(0, cSB) };
    }),
  );
  // the planes coded: the picture, and the alpha beside it when it is in the same codestream
  interface PlaneState {
    cf: number;
    nCh: number;
    input: Int32Array[];
    contexts: CodingContext[];
    prev: PredRow;
    cur: PredRow;
    buf: Int32Array[];
    mb: Int32Array[];
    dcBlock: Int32Array[];
  }
  // two rows of macroblocks, one after the other, with a macroblock of room at both ends
  const region = (mbW + 2) * 256;
  const at = (row: number, x: number): number => (row & 1) * region + 256 + x * 256;
  const makePlane = (planeCf: number, input: Int32Array[]): PlaneState => ({
    cf: planeCf,
    nCh: input.length,
    input,
    contexts: tileWidths.map(() => new CodingContext(planeCf)),
    prev: new PredRow(mbW * input.length),
    cur: new PredRow(mbW * input.length),
    buf: input.map(() => new Int32Array(region * 2)),
    mb: input.map(() => new Int32Array(256)),
    dcBlock: input.map(() => new Int32Array(16)),
  });
  const coded: PlaneState[] = [makePlane(cf, planes)];
  if (inp.alpha) coded.push(makePlane(CF_Y_ONLY, [inp.alpha]));

  let tileCol = 0;
  let tileRow = 0;
  for (let cRow = 0; cRow <= mbH; cRow++) {
    for (const ps of coded) {
      if (cRow >= mbH) break;
      // load the pixels of this row of macroblocks
      for (let c = 0; c < ps.nCh; c++) {
        const src = ps.input[c]!;
        const b = ps.buf[c]!;
        b.fill(0, (cRow & 1) * region, (cRow & 1) * region + region);
        for (let mx = 0; mx < mbW; mx++) {
          const base = at(cRow, mx);
          for (let y = 0; y < 16; y++) {
            const sy = Math.min(height - 1, cRow * 16 + y);
            for (let x = 0; x < 16; x++) {
              const sx = Math.min(width - 1, mx * 16 + x);
              b[base + IDX_CC[y * 16 + x]!] = src[sy * width + sx]!;
            }
          }
        }
      }
    }
    for (let cColumn = 0; cColumn <= mbW; cColumn++) {
      for (const ps of coded) {
        const { nCh: n, buf, mb, dcBlock, contexts } = ps;
        const p1 = at(cRow, cColumn);
        const p0 = cRow > 0 ? at(cRow - 1, cColumn) : 0;
        for (let c = 0; c < n; c++) fwdTransformChannel(buf[c]!, p0, p1, { left: cColumn === 0, right: cColumn === mbW, top: cRow === 0, bottom: cRow === mbH }, overlap);
        if (cColumn === 0 || cRow === 0) continue;
        // the macroblock before this one and above it is finished: take its numbers and code them
        const mx = cColumn - 1;
        const my = cRow - 1;
        const from = at(my, mx);
        for (let c = 0; c < n; c++) {
          mb[c]!.set(buf[c]!.subarray(from, from + 256));
          for (let i = 0; i < 16; i++) dcBlock[c]![i] = mb[c]![DCT_INDEX[2]![i]!]!;
        }
        // which tile it is in, and where in it
        if (mx === 0) tileCol = 0;
        else if (tileCol < tileWidths.length - 1 && mx === tileX[tileCol + 1]) tileCol++;
        if (my === 0) tileRow = 0;
        else if (tileRow < tileHeights.length - 1 && my === tileY[tileRow + 1]) tileRow++;
        const left = mx === tileX[tileCol];
        const top = my === tileY[tileRow];
        let resetContext = (mx - tileX[tileCol]!) % 16 === 0;
        const resetTotals = resetContext;
        if (tileCol === tileWidths.length - 1) {
          if (mx + 1 === mbW) resetContext = true;
        } else if (mx + 1 === tileX[tileCol + 1]) resetContext = true;
        const st = streams[tileRow]![tileCol]!;
        const ctx = contexts[tileCol]!;
        if (left && top && ps === coded[0]) {
          // the start of a tile: the contexts begin again at the start of a row of tiles, and each stream has its packet header
          if (mx === 0) for (const q of coded) for (const c of q.contexts) c.reset();
          const id = (tileRow * tileWidths.length + tileCol) & 0x1f;
          const header = (b: BitWriter, type: number): void => {
            b.put(0, 8);
            b.put(0, 8);
            b.put(1, 8);
            b.put((id << 3) + type, 8);
          };
          if (!frequency) {
            header(st.dc, 0);
            if (trim) st.dc.put(trim, 4);
          } else {
            header(st.dc, 1);
            if (cSB > 1) header(st.lp, 2);
            if (cSB > 2) header(st.ac, 3);
            if (cSB > 3) {
              header(st.fl, 4);
              if (trim) st.fl.put(trim, 4);
            }
          }
        }
        // (the reference decoder does not trim the alpha that is in the same codestream, so the alpha is not trimmed)
        const planeTrim = ps === coded[0] ? trim : 0;
        ctx.trimFlexBits = planeTrim;
        const orientation = predict(ps.cf, n, mb, dcBlock, ps.prev, ps.cur, mx, left, top);
        encodeDc(st.dc, ctx, ps.cf, n, dcBlock);
        if (subband === SB_DC_ONLY && resetContext) for (let k = 2; k < 5; k++) ctx.ah[k]!.adapt();
        if (subband !== SB_DC_ONLY) {
          encodeLowpass(st.lp, ctx, ps.cf, n, dcBlock, resetTotals);
          if (resetContext) ctx.adaptLowpass();
        }
        if (subband !== SB_DC_ONLY && subband !== 2) {
          encodeHighpass(st.ac, st.fl, ctx, ps.cf, n, mb, orientation, resetTotals, ps.prev, ps.cur, mx, left, top, planeTrim, subband === 1);
          if (resetContext) ctx.adaptHighpass();
        }
      }
    }
    if (cRow > 0) {
      for (const ps of coded) {
        const t = ps.prev;
        ps.prev = ps.cur;
        ps.cur = t;
      }
    }
  }

  // the packets, in the order of the file; one of 4 bytes or fewer (a header and nothing else) is left out
  const packets: { bytes: Uint8Array; kept: boolean }[] = [];
  for (const row of streams) {
    for (const st of row) {
      for (const b of st.all) {
        b.fillToByte();
        const bytes = b.bytes();
        packets.push({ bytes, kept: !frequency || bytes.length > 4 });
      }
    }
  }
  if (indexTable) {
    w.fillToByte();
    w.put(1, 16);
    let offset = 0;
    for (const pk of packets) {
      if (!pk.kept) w.put(0xff, 8);
      else {
        putVlWord(w, offset);
        offset += pk.bytes.length;
      }
    }
    w.put(0xff, 8);
    w.fillToByte();
  } else {
    // no index table: the "header size" word and the profile and level
    w.fillToByte();
    putVlWord(w, 4);
    w.put(111, 8);
    w.put(255, 8);
    w.put(1, 16);
  }
  w.fillToByte();
  const head = w.bytes();
  const kept = packets.filter((pk) => pk.kept);
  const out = new Uint8Array(head.length + kept.reduce((n, pk) => n + pk.bytes.length, 0));
  out.set(head);
  let at2 = head.length;
  for (const pk of kept) {
    out.set(pk.bytes, at2);
    at2 += pk.bytes.length;
  }
  return out;
}

interface HeaderOptions {
  tileX: number[];
  tileY: number[];
  indexTable: boolean;
  frequency: boolean;
  subband: number;
  trim: number;
}

function writeHeader(w: BitWriter, inp: PlanesInput, mbW: number, mbH: number, o: HeaderOptions): void {
  for (const ch of "WMPHOTO") w.put(ch.charCodeAt(0), 8);
  w.put(0, 8);
  w.put(1, 4); // version
  w.put(1, 4); // subversion: soft tile boundaries
  const sliceV = o.tileX.length - 2;
  const sliceH = o.tileY.length - 2;
  w.put(sliceV || sliceH ? 1 : 0, 1); // tiling
  w.put(o.frequency ? 1 : 0, 1); // frequency order or spatial order
  w.put(0, 3); // orientation
  w.put(o.indexTable ? 1 : 0, 1); // index table
  w.put(inp.overlap ?? OL_ONE, 2);
  const short = mbW <= 255 && mbH <= 255;
  w.put(short ? 1 : 0, 1);
  w.put(1, 1); // long words
  w.put(0, 1); // windowing
  w.put(o.trim > 0 ? 1 : 0, 1); // trimmed flexbits
  w.put(0, 1); // tile stretching
  w.put(0, 2);
  w.put(inp.alpha ? 1 : 0, 1); // alpha in the codestream
  w.put(inp.srcCf, 4);
  w.put(BD_8, 4);
  w.put(inp.width - 1, short ? 16 : 32);
  w.put(inp.height - 1, short ? 16 : 32);
  if (sliceV || sliceH) {
    w.put(sliceV, 12);
    w.put(sliceH, 12);
    for (let i = 0; i < sliceV; i++) w.put(o.tileX[i + 1]! - o.tileX[i]!, short ? 8 : 16);
    for (let i = 0; i < sliceH; i++) w.put(o.tileY[i + 1]! - o.tileY[i]!, short ? 8 : 16);
  }
  w.fillToByte();
  // the plane headers: the picture's, and the alpha's
  planeHeader(w, inp.cf, inp.planes.length, o.subband);
  if (inp.alpha) planeHeader(w, CF_Y_ONLY, 1, o.subband);
}

function planeHeader(w: BitWriter, cf: number, nCh: number, subband: number): void {
  w.put(cf, 3);
  w.put(0, 1); // unscaled arithmetic
  w.put(subband, 4);
  if (cf === CF_YUV_444) {
    w.put(0, 4);
    w.put(0, 4);
  }
  const quantizer = () => {
    if (nCh > 1) w.put(2, 2); // the channels have their own
    for (let i = 0; i < nCh; i++) w.put(0, 8); // index 0: the quantizer is 1
  };
  w.put(1, 1); // DC: one quantizer for the picture
  quantizer();
  if (subband !== SB_DC_ONLY) {
    w.put(0, 1); // low pass has its own
    w.put(1, 1);
    quantizer();
    if (subband !== SB_NO_HIGHPASS) {
      w.put(0, 1); // high pass has its own
      w.put(1, 1);
      quantizer();
    }
  }
  w.fillToByte();
}

// ---- prediction ----------------------------------------------------------------------------------------------------

/** Which way the high pass coefficients are predicted: 0 from the left, 1 from above, 2 not. */
function acPredMode(cf: number, dc: Int32Array[]): number {
  const y = dc[0]!;
  let strH = Math.abs(y[1]!) + Math.abs(y[2]!) + Math.abs(y[3]!);
  let strV = Math.abs(y[4]!) + Math.abs(y[8]!) + Math.abs(y[12]!);
  if (cf !== CF_Y_ONLY && cf !== CF_NCOMPONENT) {
    const u = dc[1]!;
    const v = dc[2]!;
    strH += Math.abs(u[1]!) + Math.abs(v[1]!);
    strV += Math.abs(u[4]!) + Math.abs(v[4]!);
  }
  return strH * ORIENT_WEIGHT < strV ? 1 : strV * ORIENT_WEIGHT < strH ? 0 : 2;
}

/** The mode for the DC (0 left, 1 above, 2 both, 3 none) and the first row and column of the low pass (4 above, 0 left, 8 none). */
function dcAcPredMode(cf: number, prev: PredRow, cur: PredRow, mx: number, mbW: number, left: boolean, top: boolean): number {
  let dcMode: number;
  if (left && top) dcMode = 3;
  else if (left) dcMode = 1;
  else if (top) dcMode = 0;
  else {
    const l = cur.info[mx - 1]!.dc;
    const t = prev.info[mx]!.dc;
    const tl = prev.info[mx - 1]!.dc;
    let strH: number;
    let strV: number;
    if (cf === CF_Y_ONLY || cf === CF_NCOMPONENT) {
      strH = Math.abs(tl - l);
      strV = Math.abs(tl - t);
    } else {
      const at = (row: PredRow, ch: number, x: number) => row.info[ch * mbW + x]!.dc;
      strH = Math.abs(tl - l) * 2 + Math.abs(at(prev, 1, mx - 1) - at(cur, 1, mx - 1)) + Math.abs(at(prev, 2, mx - 1) - at(cur, 2, mx - 1));
      strV = Math.abs(tl - t) * 2 + Math.abs(at(prev, 1, mx - 1) - at(prev, 1, mx)) + Math.abs(at(prev, 2, mx - 1) - at(prev, 2, mx));
    }
    dcMode = strH * ORIENT_WEIGHT < strV ? 1 : strV * ORIENT_WEIGHT < strH ? 0 : 2;
  }
  // every macroblock has the same quantizer, so the neighbour's low pass is always usable
  const adMode = dcMode === 1 ? 1 : dcMode === 0 ? 0 : 2;
  return dcMode + (adMode << 2);
}

/**
 * Predicts the DC, the first row and column of the low pass, and the high pass coefficients, from the neighbours, and keeps what
 * the next macroblocks need. Returns the scan orientation of the macroblock.
 */
function predict(cf: number, nCh: number, mb: Int32Array[], dc: Int32Array[], prev: PredRow, cur: PredRow, mx: number, left: boolean, top: boolean): number {
  const mbW = prev.info.length / nCh;
  const mode = dcAcPredMode(cf, prev, cur, mx, mbW, left, top);
  const dcMode = mode & 3;
  const adMode = mode & 12;
  const acMode = acPredMode(cf, dc);
  for (let c = 0; c < nCh; c++) {
    const d = dc[c]!;
    const me = cur.info[c * mbW + mx]!;
    // keep what the neighbours need (before it is predicted)
    me.dc = d[0]!;
    me.ad[0] = d[1]!;
    me.ad[1] = d[2]!;
    me.ad[2] = d[3]!;
    me.ad[3] = d[4]!;
    me.ad[4] = d[8]!;
    me.ad[5] = d[12]!;
    const above = prev.info[c * mbW + mx];
    const before = mx > 0 ? cur.info[c * mbW + mx - 1] : undefined;
    if (dcMode === 1) d[0] = d[0]! - above!.dc;
    else if (dcMode === 0) d[0] = d[0]! - before!.dc;
    else if (dcMode === 2) d[0] = d[0]! - ((before!.dc + above!.dc) >> 1);
    if (adMode === 4) {
      const ref = above!.ad;
      d[4] = d[4]! - ref[3]!;
      d[8] = d[8]! - ref[4]!;
      d[12] = d[12]! - ref[5]!;
    } else if (adMode === 0) {
      const ref = before!.ad;
      d[1] = d[1]! - ref[0]!;
      d[2] = d[2]! - ref[1]!;
      d[3] = d[3]! - ref[2]!;
    }
    const o = mb[c]!;
    if (acMode === 1) {
      for (let k = 0; k <= 192; k += 64) {
        for (let j = 48; j > 0; j -= 16) {
          o[k + j + 10] = o[k + j + 10]! - o[k + j + 10 - 16]!;
          o[k + j + 2] = o[k + j + 2]! - o[k + j + 2 - 16]!;
          o[k + j + 9] = o[k + j + 9]! - o[k + j + 9 - 16]!;
        }
      }
    } else if (acMode === 0) {
      for (let k = 0; k < 64; k += 16) {
        for (let j = 192; j > 0; j -= 64) {
          o[k + j + 5] = o[k + j + 5]! - o[k + j + 5 - 64]!;
          o[k + j + 1] = o[k + j + 1]! - o[k + j + 1 - 64]!;
          o[k + j + 6] = o[k + j + 6]! - o[k + j + 6 - 64]!;
        }
      }
    }
  }
  return 2 - acMode;
}

// ---- the entropy coded parts ---------------------------------------------------------------------------------------

/** Writes an absolute level of 1 or more (`a` is the level less one... see the decoder: it reads back `a + 2` more than 1). */
function writeAbsLevel(w: BitWriter, a: number, ah: AdaptiveHuffman): void {
  a--;
  if (a >= 16) {
    let fixed = 4;
    let i = a >> 5;
    while (i) {
      fixed++;
      i >>= 1;
    }
    ah.disc += ah.delta![6]!;
    ah.write(w, 6);
    if (fixed > 18) {
      w.put(15, 4);
      if (fixed > 21) {
        w.put(3, 2);
        w.put(fixed - 22, 3);
      } else w.put(fixed - 19, 2);
    } else w.put(fixed - 4, 4);
    w.put(a, fixed);
  } else {
    const index = ABS_INDEX[a]!;
    const fixed = ABS_FIXED[index]!;
    ah.disc += ah.delta![index]!;
    ah.write(w, index);
    w.put(a, fixed);
  }
}
const ABS_INDEX = [0, 1, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5];
const ABS_FIXED = [0, 0, 1, 2, 2, 2];

function encodeDc(w: BitWriter, ctx: CodingContext, cf: number, nCh: number, dc: Int32Array[]): void {
  const model = ctx.modelDC;
  const mean: [number, number] = [0, 0];
  if (cf === CF_Y_ONLY || cf === CF_NCOMPONENT) {
    for (let c = 0; c < nCh; c++) {
      const bits = model.bits[c === 0 ? 0 : 1]!;
      const v = dc[c]![0]!;
      const a = Math.abs(v);
      const q = a >> bits;
      if (q) {
        w.put(1, 1);
        writeAbsLevel(w, q, ctx.ah[3]!);
        mean[c === 0 ? 0 : 1]++;
      } else w.put(0, 1);
      w.put(a, bits);
      if (a) w.put(v < 0 ? 1 : 0, 1);
    }
  } else {
    const ah = ctx.ah[2]!;
    const [vy, vu, vv] = [dc[0]![0]!, dc[1]![0]!, dc[2]![0]!];
    const by = model.bits[0]!;
    const bc = model.bits[1]!;
    const qy = Math.abs(vy) >> by;
    const qu = Math.abs(vu) >> bc;
    const qv = Math.abs(vv) >> bc;
    ah.write(w, (qy ? 4 : 0) + (qu ? 2 : 0) + (qv ? 1 : 0));
    if (qy) {
      writeAbsLevel(w, qy, ctx.ah[3]!);
      mean[0]++;
    }
    w.put(Math.abs(vy), by);
    if (vy) w.put(vy < 0 ? 1 : 0, 1);
    if (qu) {
      writeAbsLevel(w, qu, ctx.ah[4]!);
      mean[1]++;
    }
    w.put(Math.abs(vu), bc);
    if (vu) w.put(vu < 0 ? 1 : 0, 1);
    if (qv) {
      writeAbsLevel(w, qv, ctx.ah[4]!);
      mean[1]++;
    }
    w.put(Math.abs(vv), bc);
    if (vv) w.put(vv < 0 ? 1 : 0, 1);
  }
  updateModel(cf, nCh, mean, model);
}

/**
 * Splits a block's coefficients into the levels that are coded (with their runs) and the bits left over. `bits` is the number of
 * bits sent apart (the model bits) and `trim` how many of those are left out altogether. Returns the number coded.
 */
function scanBlock(coef: Int32Array, residual: Int32Array, scan: AdaptiveScan, bits: number, rl: Int32Array, trim = 0): number {
  let run = 0;
  let n = 0;
  const th = 1 << bits;
  for (let k = 1; k < 16; k++) {
    const pos = scan.scan[k]!;
    const c = coef[pos]!;
    const a = Math.abs(c);
    if (a >= th) {
      const level = a >> bits;
      residual[pos] = ((a & (th - 1)) >> trim) * 2;
      scan.bump(k);
      rl[n * 2] = run;
      rl[n * 2 + 1] = c < 0 ? -level : level;
      n++;
      run = 0;
    } else {
      run++;
      const t = c < 0 ? -(a >> trim) : a >> trim;
      residual[pos] = t === 0 ? 0 : Math.abs(t) * 4 + (t < 0 ? 3 : 1);
    }
  }
  return n;
}

function writeRun(w: BitWriter, ah: AdaptiveHuffman, run: number, maxRun: number): void {
  if (maxRun < 5) {
    if (maxRun > 1) {
      const len = [3, 3, 2, 1][maxRun - run]! - (4 - maxRun);
      w.put(maxRun !== run ? 1 : 0, len);
    }
    return;
  }
  const bin = SIGNIFICANT_RUN_BIN[maxRun]!;
  const index = RUN_INDEX[run + bin * 14 - 1]!;
  const flc = SIGNIFICANT_RUN_FIXED[index + bin * 5]!;
  ah.write(w, index);
  w.put(run + 1, flc);
}
const RUN_INDEX = [0, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 0, 1, 2, 2, 3, 3, 4, 4, 4, 4, 0, 0, 0, 0, 0, 1, 2, 3, 4, 4];

/** Writes one block's levels with the runs between them. `table` is where its code tables start in the context. */
function writeBlock(w: BitWriter, ctx: CodingContext, chroma: boolean, rl: Int32Array, n: number, table: number, location: number): void {
  const ah = ctx.ah;
  const base = table + (chroma ? 3 : 0);
  let lev = rl[1]!;
  let sr = rl[0] === 0 ? 1 : 0;
  let sl = lev + 1 >>> 0 > 2 ? 1 : 0;
  let srn = 1;
  if (n === 1) srn = 0;
  else if (rl[2]! > 0) srn = 2;
  let index = srn * 4 + sl * 2 + sr;
  {
    const t = ah[base]!;
    t.disc += t.delta![index]!;
    t.disc1 += t.delta1![index]!;
    t.write(w, index, 1, lev < 0 ? 1 : 0);
  }
  let cont = sr & srn;
  if (sl) writeAbsLevel(w, Math.abs(lev) - 1, ah[6 + table + cont]!);
  if (sr === 0) writeRun(w, ah[0]!, rl[0]!, 15 - location);
  location += rl[0]! + 1;
  for (let k = 1; k < n; k++) {
    if (srn === 2) writeRun(w, ah[0]!, rl[k * 2]!, 15 - location);
    location += rl[k * 2]! + 1;
    srn = 1;
    if (k === n - 1) srn = 0;
    else if (rl[k * 2 + 2]! > 0) srn = 2;
    lev = rl[k * 2 + 1]!;
    sl = lev + 1 >>> 0 > 2 ? 1 : 0;
    index = srn * 2 + sl;
    const sign = lev < 0 ? 1 : 0;
    if (location < 15) {
      const t = ah[base + cont + 1]!;
      t.disc += t.delta![index]!;
      t.disc1 += t.delta1![index]!;
      t.write(w, index, 1, sign);
    } else if (location === 15) {
      const code = [0, 6, 2, 7][index]!;
      const len = [1, 3, 2, 3][index]!;
      w.put(code * 2 + sign, len + 1);
    } else w.put(index * 2 + sign, 2);
    cont &= srn;
    if (sl) writeAbsLevel(w, Math.abs(lev) - 1, ah[6 + table + cont]!);
  }
}

function encodeLowpass(w: BitWriter, ctx: CodingContext, cf: number, nCh: number, dc: Int32Array[], resetTotals: boolean): void {
  const scan = ctx.scanLow;
  if (resetTotals) scan.resetTotals();
  const model = ctx.modelLP;
  const mean: [number, number] = [0, 0];
  const rl: Int32Array[] = dc.map(() => new Int32Array(32));
  const residual: Int32Array[] = dc.map(() => new Int32Array(16));
  const count = new Array<number>(nCh).fill(0);
  for (let c = 0; c < nCh; c++) count[c] = scanBlock(dc[c]!, residual[c]!, scan, model.bits[c === 0 ? 0 : 1]!, rl[c]!);
  if (cf === CF_YUV_444) {
    const iMax = nCh * 4 - 5;
    let cbp = (count[0]! > 0 ? 1 : 0) + (count[1]! > 0 ? 2 : 0) + (count[2]! > 0 ? 4 : 0);
    let countM = ctx.cbpCountMax;
    let countZ = ctx.cbpCountZero;
    if (countZ <= 0 || countM < 0) {
      let val = cbp;
      if (countM < countZ) val = iMax - cbp;
      if (val === 0) w.put(0, 1);
      else if (val === 1) w.put((nCh + 1) & 6, nCh);
      else w.put(val + iMax + 1, nCh + 1);
    } else w.put(cbp, nCh);
    countM += 1 - 4 * (cbp === iMax ? 1 : 0);
    countZ += 1 - 4 * (cbp === 0 ? 1 : 0);
    ctx.cbpCountMax = Math.max(-8, Math.min(7, countM));
    ctx.cbpCountZero = Math.max(-8, Math.min(7, countZ));
    cbp = 0;
  } else for (let c = 0; c < nCh; c++) w.put(count[c]! > 0 ? 1 : 0, 1);
  for (let c = 0; c < nCh; c++) {
    const bits = model.bits[c === 0 ? 0 : 1]!;
    if (count[c]) {
      mean[c === 0 ? 0 : 1] += count[c]!;
      writeBlock(w, ctx, c > 0, rl[c]!, count[c]!, CT_DC, 1);
    }
    if (bits) for (let k = 1; k < 16; k++) w.put(residual[c]![k]! >> 1, bits + (residual[c]![k]! & 1));
  }
  updateModel(cf, nCh, mean, model);
}

// ---- high pass -----------------------------------------------------------------------------------------------------

function encodeHighpass(
  w: BitWriter,
  fl: BitWriter,
  ctx: CodingContext,
  cf: number,
  nCh: number,
  mb: Int32Array[],
  orientation: number,
  resetTotals: boolean,
  prev: PredRow,
  cur: PredRow,
  mx: number,
  left: boolean,
  top: boolean,
  trim: number,
  noFlexbits: boolean,
): void {
  if (resetTotals) {
    ctx.scanH.resetTotals();
    ctx.scanV.resetTotals();
  }
  const mbW = prev.info.length / nCh;
  const model = ctx.modelAC;
  // which blocks have any coefficient that is coded: the pattern, then the pattern's difference from a prediction
  const diff: number[] = [];
  const cbpOf: number[] = [];
  for (let c = 0; c < nCh; c++) {
    const bits = model.bits[c === 0 ? 0 : 1]!;
    const threshold = 1 << bits;
    let cbp = 0;
    for (let j = 0; j < 16; j++) {
      const o = BLK_OFFSET[j]!;
      for (let i = 1; i < 16; i++) {
        if (Math.abs(mb[c]![o + i]!) >= threshold) {
          cbp |= 1 << j;
          break;
        }
      }
    }
    cbpOf.push(cbp);
    cur.info[c * mbW + mx]!.cbp = cbp;
    diff.push(predictCbp(ctx, cbp, c, prev, cur, mx, mbW, left, top));
  }
  writeCbp(w, ctx, cf, nCh, diff);
  const scan = orientation === 1 ? ctx.scanV : ctx.scanH;
  const mean: [number, number] = [0, 0];
  const rl = new Int32Array(32);
  const residual = new Int32Array(16);
  for (let c = 0; c < nCh; c++) {
    const bits = model.bits[c === 0 ? 0 : 1]!;
    const chroma = c > 0;
    // the bits kept out of the file only count when they are among those sent apart; the rest are sent
    const t = noFlexbits || trim > bits ? 0 : trim;
    const flex = noFlexbits || trim > bits ? 0 : bits - trim;
    const mask = (1 << flex) - 1;
    let pattern = cbpOf[c]!;
    for (let b = 0; b < 16; b++, pattern >>= 1) {
      const o = BLK_OFFSET[b]!;
      const coef = mb[c]!.subarray(o, o + 16);
      if (pattern & 1) {
        const n = scanBlock(coef, residual, scan, bits, rl, t);
        mean[chroma ? 1 : 0] += n;
        writeBlock(w, ctx, chroma, rl, n, CT_DC + CONTEXT_X, 1);
        if (flex) for (let k = 1; k < 16; k++) fl.put(residual[DCT_INDEX[0]![k]!]! >> 1, flex + (residual[DCT_INDEX[0]![k]!]! & 1));
      } else if (flex) {
        for (let k = 1; k < 16; k++) {
          const data = coef[DCT_INDEX[0]![k]!]!;
          const a = Math.abs(data) >> t;
          if (a) fl.put((a & mask) * 2 + (data < 0 ? 1 : 0), flex + 1);
          else fl.put(0, flex);
        }
      }
    }
  }
  updateModel(cf, nCh, mean, model);
}

/** The difference of a macroblock's block pattern from the one predicted from its neighbours (or the pattern itself, or its complement). */
function predictCbp(ctx: CodingContext, cbp: number, c: number, prev: PredRow, cur: PredRow, mx: number, mbW: number, left: boolean, top: boolean): number {
  let pred = 0;
  if (left) {
    if (top) pred = 1;
    else pred = (prev.info[c * mbW + mx]!.cbp >> 10) & 1;
  } else pred = (cur.info[c * mbW + mx - 1]!.cbp >> 5) & 1;
  pred |= (cbp & 0x3300) << 2;
  pred |= (cbp & 0xcc) << 6;
  pred |= (cbp & 0x33) << 2;
  pred |= (cbp & 0x11) << 1;
  pred |= (cbp & 0x2) << 3;
  const c1 = c ? 1 : 0;
  const m = ctx.cbp;
  const ones = numOnes(cbp);
  const result = m.state[c1] === 0 ? pred ^ cbp : m.state[c1] === 1 ? cbp : cbp ^ 0xffff;
  updateCbpModel(m, c1, ones);
  return result;
}

const NUM_ONES = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
const TAB_LEN = [0, 2, 2, 2, 2, 2, 3, 2, 2, 3, 3, 2, 3, 2, 2, 0];
const TAB_CODE = [0, 0, 1, 0, 2, 1, 4, 3, 3, 5, 6, 2, 7, 1, 0, 0];
const TAB0 = [0, 1, 1, 2, 1, 3, 3, 4, 1, 3, 3, 4, 2, 4, 4, 5];
const FL0 = [0, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 0];
const CODE0 = [0, 0, 1, 0, 2, 0, 1, 0, 3, 2, 3, 1, 1, 2, 3, 0];

function writeCbp(w: BitWriter, ctx: CodingContext, cf: number, nCh: number, diff: number[]): void {
  const planes = cf === CF_Y_ONLY || cf === CF_NCOMPONENT ? nCh : 1;
  for (let i = 0; i < planes; i++) {
    let dy = diff[i]!;
    const du = cf === CF_YUV_444 ? diff[1]! : 0;
    const dv = cf === CF_YUV_444 ? diff[2]! : 0;
    // which of the four groups of four blocks have anything
    let pattern = 0;
    let t = dy | (cf === CF_YUV_444 ? du | dv : 0);
    for (let g = 0; g < 4; g++) {
      pattern |= (t & 0xf) !== 0 ? 0x10 : 0;
      t >>= 4;
      pattern >>= 1;
    }
    const count = NUM_ONES[pattern]!;
    const a1 = ctx.cbpy1;
    a1.write(w, count);
    a1.disc += a1.delta![count]!;
    if (TAB_LEN[pattern]) w.put(TAB_CODE[pattern]!, TAB_LEN[pattern]!);
    let cu = du;
    let cv = dv;
    for (let g = 0; g < 4; g++) {
      let code: number;
      let codeU = 0;
      let codeV = 0;
      if (cf === CF_YUV_444) {
        code = dy & 0xf;
        codeU = cu & 0xf;
        codeV = cv & 0xf;
        code |= (codeU !== 0 ? 1 : 0) << 4;
        code |= (codeV !== 0 ? 1 : 0) << 5;
        dy >>= 4;
        cu >>= 4;
        cv >>= 4;
      } else {
        code = dy & 0xf;
        dy >>= 4;
      }
      if (!code) continue;
      let chroma = code >> 4;
      code &= 0xf;
      let val: number;
      if (chroma) val = TAB0[code]! > 2 ? 8 : TAB0[code]! + 6 - 1;
      else val = TAB0[code]! - 1;
      const ah = ctx.cbpy;
      ah.write(w, val);
      ah.disc += ah.delta![val]!;
      if (chroma) {
        if (chroma === 1) w.put(1, 1);
        else w.put(3 - chroma, 2);
      }
      if (val === 8) {
        if (TAB0[code] === 3) w.put(1, 1);
        else w.put(5 - TAB0[code]!, 2);
      }
      if (FL0[code]) w.put(CODE0[code]!, FL0[code]!);
      if (cf === CF_YUV_444) {
        const a = ctx.ah[1]!;
        let pat = codeU;
        for (let k = 0; k < 2; k++) {
          if (pat) {
            const n = NUM_ONES[pat]! - 1;
            a.write(w, n);
            if (TAB_LEN[pat]) w.put(TAB_CODE[pat]!, TAB_LEN[pat]!);
          }
          pat = codeV;
        }
      }
      chroma = 0;
    }
  }
}
