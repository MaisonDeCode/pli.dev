import { OL_NONE, OL_TWO } from "./jxr-common";

/*
 * The transforms of JPEG XR on a macroblock of 256 numbers (a 16 by 16 pixel area as sixteen 4 by 4 blocks, kept the way
 * `IDX_CC` says). Every function takes the array and the places of the numbers it works on. All the arithmetic is integer
 * (lifting steps that undo each other exactly), so a picture coded without losses comes back exactly.
 */

type A = Int32Array;

/** The 2 by 2 transform that is its own inverse (rounds down). */
export function dn(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  const C = p[ic]!;
  let d = p[id]!;
  a += d;
  b -= C;
  const t = (a - b) >> 1;
  const c = t - d;
  d = t - C;
  a -= d;
  b += c;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

/** The 2 by 2 transform, rounding up. */
export function up(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  const C = p[ic]!;
  let d = p[id]!;
  a += d;
  b -= C;
  const t = (a - b + 1) >> 1;
  const c = t - d;
  d = t - C;
  a -= d;
  b += c;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

const fourButterfly = (p: A, o: number, idx: readonly number[]): void => {
  for (let k = 0; k < 16; k += 4) dn(p, o + idx[k]!, o + idx[k + 1]!, o + idx[k + 2]!, o + idx[k + 3]!);
};

const SECOND_STAGE_BUTTERFLY = [0, 192, 48, 240, 64, 128, 112, 176, 16, 208, 32, 224, 80, 144, 96, 160] as const;

// ---- forward -----------------------------------------------------------------------------------------------------

function fwdOddOdd(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = -p[ib]!;
  let c = -p[ic]!;
  let d = p[id]!;
  d += a;
  c -= b;
  const t1 = d >> 1;
  a -= t1;
  const t2 = c >> 1;
  b += t2;
  a += (b * 3 + 4) >> 3;
  b -= (a * 3 + 3) >> 2;
  a += (b * 3 + 3) >> 3;
  b -= t2;
  a += t1;
  c += b;
  d -= a;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

function fwdOdd(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  b -= c;
  a += d;
  c += (b + 1) >> 1;
  d = ((a + 1) >> 1) - d;
  b -= (a * 3 + 4) >> 3;
  a += (b * 3 + 4) >> 3;
  d -= (c * 3 + 4) >> 3;
  c += (d * 3 + 4) >> 3;
  d += b >> 1;
  c -= (a + 1) >> 1;
  b -= d;
  a += c;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

/** The first stage of the forward transform: the 16 numbers of a block (at `o`) become one DC and 15 high pass coefficients. */
export function fwdStage1(p: A, o: number): void {
  for (let c = 0; c < 4; c++) dn(p, o + c, o + 4 + c, o + 8 + c, o + 12 + c);
  up(p, o + 0, o + 1, o + 2, o + 3);
  fwdOddOdd(p, o + 15, o + 14, o + 13, o + 12);
  fwdOdd(p, o + 5, o + 4, o + 7, o + 6);
  fwdOdd(p, o + 10, o + 8, o + 11, o + 9);
}

/** The second stage: the 16 DC numbers of a macroblock (at `o + 16 k`) become the macroblock's DC and 15 low pass coefficients. */
export function fwdStage2(p: A, o: number): void {
  fourButterfly(p, o, SECOND_STAGE_BUTTERFLY);
  up(p, o + 0, o + 64, o + 16, o + 80);
  fwdOddOdd(p, o + 160, o + 224, o + 176, o + 240);
  fwdOdd(p, o + 128, o + 192, o + 144, o + 208);
  fwdOdd(p, o + 32, o + 48, o + 96, o + 112);
}

// ---- inverse -----------------------------------------------------------------------------------------------------

const irotate1 = (p: A, ia: number, ib: number): void => {
  p[ia] = p[ia]! - ((p[ib]! + 1) >> 1);
  p[ib] = p[ib]! + ((p[ia]! + 1) >> 1);
};

function invOddOdd(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  d += a;
  c -= b;
  const t1 = d >> 1;
  a -= t1;
  const t2 = c >> 1;
  b += t2;
  a -= (b * 3 + 3) >> 3;
  b += (a * 3 + 3) >> 2;
  a -= (b * 3 + 4) >> 3;
  b -= t2;
  a += t1;
  c += b;
  d -= a;
  p[ia] = a;
  p[ib] = -b;
  p[ic] = -c;
  p[id] = d;
}

function invOddOddPost(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  d += a;
  c -= b;
  const t1 = d >> 1;
  a -= t1;
  const t2 = c >> 1;
  b += t2;
  a -= (b * 3 + 6) >> 3;
  b += (a * 3 + 2) >> 2;
  a -= (b * 3 + 4) >> 3;
  b -= t2;
  a += t1;
  c += b;
  d -= a;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

function invOdd(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  b += d;
  a -= c;
  d -= b >> 1;
  c += (a + 1) >> 1;
  a -= (b * 3 + 4) >> 3;
  b += (a * 3 + 4) >> 3;
  c -= (d * 3 + 4) >> 3;
  d += (c * 3 + 4) >> 3;
  c -= (b + 1) >> 1;
  d = ((a + 1) >> 1) - d;
  b += c;
  a -= d;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

/** The first stage of the inverse transform of one block at `o`. */
export function invStage1(p: A, o: number): void {
  up(p, o + 0, o + 1, o + 2, o + 3);
  invOdd(p, o + 5, o + 4, o + 7, o + 6);
  invOdd(p, o + 10, o + 8, o + 11, o + 9);
  invOddOdd(p, o + 15, o + 14, o + 13, o + 12);
  for (let c = 0; c < 4; c++) dn(p, o + c, o + 4 + c, o + 8 + c, o + 12 + c);
}

/** The second stage of the inverse transform of the macroblock at `o`: DC and low pass back to the DC of each block. */
export function invStage2(p: A, o: number): void {
  invOdd(p, o + 32, o + 48, o + 96, o + 112);
  invOdd(p, o + 128, o + 192, o + 144, o + 208);
  invOddOdd(p, o + 160, o + 224, o + 176, o + 240);
  up(p, o + 0, o + 64, o + 16, o + 80);
  fourButterfly(p, o, SECOND_STAGE_BUTTERFLY);
}

/** Doubles the DC of each block of a chroma macroblock (in the coding that scales the arithmetic). */
export function normalizeDec(p: A, o: number, chroma: boolean): void {
  if (!chroma) return;
  for (let i = 0; i < 256; i += 16) p[o + i] = p[o + i]! + p[o + i]!;
}

// ---- the post filters (the overlap between blocks, in the decoder) -------------------------------------------------------

function hstDec1(p: A, ia: number, id: number): void {
  let a = p[ia]!;
  let d = p[id]!;
  a += d;
  d = (a >> 1) - d;
  a += (d * 3) >> 3;
  d += (a * 3) >> 4;
  d += a >> 7;
  d -= a >> 10;
  p[ia] = a;
  p[id] = d;
}

function hstDec1Edge(p: A, ia: number, id: number): void {
  let a = p[ia]!;
  let d = p[id]!;
  a += d;
  d = (a >> 1) - d;
  a += (d * 3) >> 3;
  d += (a * 3) >> 4;
  d += a >> 7;
  d -= a >> 10;
  a += (d * 3 + 4) >> 3;
  d -= a >> 1;
  a += d;
  p[ia] = a;
  p[id] = -d;
}

function hstDec(p: A, ia: number, ib: number, ic: number, id: number): void {
  const a0 = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  b -= c;
  const a = a0 + ((d * 3 + 4) >> 3);
  d -= b >> 1;
  c = ((a - b) >> 1) - c;
  p[ic] = d;
  p[id] = c;
  p[ia] = a - c;
  p[ib] = b + d;
}

function post4(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  a += d;
  b += c;
  d -= (a + 1) >> 1;
  c -= (b + 1) >> 1;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
  hstDec1Edge(p, ia, id);
  hstDec1Edge(p, ib, ic);
  a = p[ia]!;
  b = p[ib]!;
  c = p[ic]!;
  d = p[id]!;
  c -= (d + 1) >> 1;
  d += (c + 1) >> 1;
  d += (a + 1) >> 1;
  c += (b + 1) >> 1;
  a -= d;
  b -= c;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

function post4x4Stage1Split(p: A, i0: number, i1: number, offset: number): void {
  const p2 = i0 + 72 - offset;
  const p3 = i1 + 64 - offset;
  const p0 = i0 + 12;
  const p1 = i1 + 4;
  for (let k = 0; k < 4; k++) dn(p, p0 + k, p2 + k, p1 + k, p3 + k);
  invOddOddPost(p, p3 + 0, p3 + 1, p3 + 2, p3 + 3);
  irotate1(p, p1 + 2, p1 + 3);
  irotate1(p, p1 + 0, p1 + 1);
  irotate1(p, p2 + 1, p2 + 3);
  irotate1(p, p2 + 0, p2 + 2);
  for (let k = 0; k < 4; k++) hstDec1(p, p0 + k, p3 + k);
  for (let k = 0; k < 4; k++) hstDec(p, p0 + k, p2 + k, p1 + k, p3 + k);
}

const post4x4Stage1 = (p: A, i: number, offset: number): void => post4x4Stage1Split(p, i, i + 16, offset);

function post4x4Stage2Split(p: A, p0: number, p1: number): void {
  dn(p, p0 - 96, p0 + 96, p1 - 112, p1 + 80);
  dn(p, p0 - 32, p0 + 32, p1 - 48, p1 + 16);
  dn(p, p0 - 80, p0 + 112, p1 - 128, p1 + 64);
  dn(p, p0 - 16, p0 + 48, p1 - 64, p1 + 0);
  invOddOddPost(p, p1 + 0, p1 + 64, p1 + 16, p1 + 80);
  irotate1(p, p0 + 48, p0 + 32);
  irotate1(p, p0 + 112, p0 + 96);
  irotate1(p, p1 - 64, p1 - 128);
  irotate1(p, p1 - 48, p1 - 112);
  hstDec1(p, p0 - 96, p1 + 80);
  hstDec1(p, p0 - 32, p1 + 16);
  hstDec1(p, p0 - 80, p1 + 64);
  hstDec1(p, p0 - 16, p1 + 0);
  hstDec(p, p0 - 96, p1 - 112, p0 + 96, p1 + 80);
  hstDec(p, p0 - 32, p1 - 48, p0 + 32, p1 + 16);
  hstDec(p, p0 - 80, p1 - 128, p0 + 112, p1 + 64);
  hstDec(p, p0 - 16, p1 - 64, p0 + 48, p1 + 0);
}

export interface MbPlace {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
}

/**
 * Undoes the transforms of the macroblock whose place is `p1` in the row being decoded, whose neighbour above is at `p0`,
 * for a full resolution channel. This is the work that can be done once that macroblock is read: it also finishes the
 * macroblocks before it and above it, which the overlap between blocks reaches into. `left` and `right` say the macroblock
 * is the first or the one past the last of its row, `top` and `bottom` the same for rows.
 */
export function invTransformChannel(p: A, p0: number, p1: number, at: MbPlace, overlap: number, scaled: boolean, chroma: boolean): void {
  const { left, right, top, bottom } = at;
  const topOrBottom = top || bottom;
  const leftOrRight = left || right;
  const bottomOrRight = bottom || right;
  // second level inverse transform
  if (!bottomOrRight) {
    invStage2(p, p1);
    if (scaled) normalizeDec(p, p1, chroma);
  }
  // second level inverse overlap
  if (overlap === OL_TWO) {
    if (top && left) post4(p, p1 + 0, p1 + 64, p1 + 0 + 16, p1 + 64 + 16);
    if (top && right) post4(p, p1 - 128, p1 - 64, p1 - 128 + 16, p1 - 64 + 16);
    if (bottom && left) post4(p, p0 + 32, p0 + 96, p0 + 32 + 16, p0 + 96 + 16);
    if (bottom && right) post4(p, p0 - 96, p0 - 32, p0 - 96 + 16, p0 - 32 + 16);
    if (leftOrRight && !topOrBottom) {
      if (left) {
        post4(p, p0 + 32, p0 + 48, p1 + 0, p1 + 16);
        post4(p, p0 + 96, p0 + 112, p1 + 64, p1 + 80);
      }
      if (right) {
        const j = -128;
        post4(p, p0 + j + 32, p0 + j + 48, p1 + j + 0, p1 + j + 16);
        post4(p, p0 + j + 96, p0 + j + 112, p1 + j + 64, p1 + j + 80);
      }
    }
    if (!leftOrRight) {
      if (topOrBottom) {
        const q = top ? p1 : p0 + 32;
        post4(p, q - 128, q - 64, q + 0, q + 64);
        post4(p, q - 112, q - 48, q + 16, q + 80);
      } else post4x4Stage2Split(p, p0, p1);
    }
  }
  // first level inverse transform
  if (!top) {
    for (let j = left ? 32 : -96; j < (right ? 32 : 160); j += 64) {
      invStage1(p, p0 + j + 0);
      invStage1(p, p0 + j + 16);
    }
  }
  if (!bottom) {
    for (let j = left ? 0 : -128; j < (right ? 0 : 128); j += 64) {
      invStage1(p, p1 + j + 0);
      invStage1(p, p1 + j + 16);
    }
  }
  // first level inverse overlap
  if (overlap !== OL_NONE) {
    if (leftOrRight) {
      if (top && left) post4(p, p1 + 0, p1 + 1, p1 + 2, p1 + 3);
      if (top && right) post4(p, p1 - 59, p1 - 60, p1 - 57, p1 - 58);
      if (bottom && left) post4(p, p0 + 48 + 10, p0 + 48 + 11, p0 + 48 + 8, p0 + 48 + 9);
      if (bottom && right) post4(p, p0 - 1, p0 - 2, p0 - 3, p0 - 4);
      for (const j of [...(left ? [0 + 10] : []), ...(right ? [-64 + 14] : [])]) {
        if (!top) {
          const q = p0 + 16 + j;
          post4(p, q + 0, q - 2, q + 6, q + 8);
          post4(p, q + 1, q - 1, q + 7, q + 9);
          post4(p, q + 16, q + 14, q + 22, q + 24);
          post4(p, q + 17, q + 15, q + 23, q + 25);
        }
        if (!bottom) {
          const q = p1 + j;
          post4(p, q + 0, q - 2, q + 6, q + 8);
          post4(p, q + 1, q - 1, q + 7, q + 9);
        }
        if (!topOrBottom) {
          post4(p, p0 + 48 + j + 0, p0 + 48 + j - 2, p1 - 10 + j, p1 - 8 + j);
          post4(p, p0 + 48 + j + 1, p0 + 48 + j - 1, p1 - 9 + j, p1 - 7 + j);
        }
      }
    }
    const from = left ? 0 : -192;
    const to = right ? -64 : 64;
    if (top) {
      for (let j = from; j < to; j += 64) {
        const q = p1 + j;
        post4(p, q + 5, q + 4, q + 64, q + 65);
        post4(p, q + 7, q + 6, q + 66, q + 67);
        post4x4Stage1(p, p1 + j, 0);
      }
    }
    if (bottom) {
      for (let j = from; j < to; j += 64) {
        post4x4Stage1(p, p0 + 16 + j, 0);
        post4x4Stage1(p, p0 + 32 + j, 0);
        const q = p0 + 48 + j;
        post4(p, q + 15, q + 14, q + 74, q + 75);
        post4(p, q + 13, q + 12, q + 72, q + 73);
      }
    }
    if (!top && !bottom) {
      for (let j = from; j < to; j += 64) {
        post4x4Stage1(p, p0 + 16 + j, 0);
        post4x4Stage1(p, p0 + 32 + j, 0);
        post4x4Stage1Split(p, p0 + 48 + j, p1 + j, 0);
        post4x4Stage1(p, p1 + j, 0);
      }
    }
  }
}

// ---- chroma of 4:2:0 pictures ---------------------------------------------------------------------------------------------

function post2(p: A, ia: number, ib: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  b += (a + 2) >> 2;
  a += (b + 1) >> 1;
  a += b >> 5;
  a += b >> 9;
  a += b >> 13;
  b += (a + 2) >> 2;
  p[ia] = a;
  p[ib] = b;
}

function post2x2(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  a += d;
  b += c;
  d -= (a + 1) >> 1;
  c -= (b + 1) >> 1;
  b += (a + 2) >> 2;
  a += (b + 1) >> 1;
  a += b >> 5;
  a += b >> 9;
  a += b >> 13;
  b += (a + 2) >> 2;
  d += (a + 1) >> 1;
  c += (b + 1) >> 1;
  a -= d;
  b -= c;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

/** The 2 by 2 transform of the DC of a chroma macroblock that doubles what it gives (for the coding that scales its arithmetic). */
function dnDec(p: A, ia: number, ib: number, ic: number, id: number): void {
  dn(p, ia, ib, ic, id);
  p[ia] = p[ia]! * 2;
  p[ib] = p[ib]! * 2;
  p[ic] = p[ic]! * 2;
  p[id] = p[id]! * 2;
}

export interface ChromaPlace extends MbPlace {
  /** the macroblock is the second of its row / the last of the picture's columns */
  leftAdjacent: boolean;
  rightAdjacent: boolean;
}

/** The numbers the second stage of the chroma overlap keeps from one macroblock to a later one (for the two corners at the right). */
export interface ChromaCorners {
  before: [number, number];
  after: [number, number];
}

/** `invTransformChannel` for the chroma of a 4:2:0 picture (macroblocks of 64 numbers: four blocks). */
export function invTransformChroma420(p: A, p0: number, p1: number, at: ChromaPlace, overlap: number, scaled: boolean, corners: ChromaCorners): void {
  const { left, right, top, bottom, leftAdjacent, rightAdjacent } = at;
  const topOrBottom = top || bottom;
  const leftOrRight = left || right;
  const bottomOrRight = bottom || right;
  // second level inverse transform
  if (!bottomOrRight) (scaled ? dnDec : dn)(p, p1, p1 + 32, p1 + 16, p1 + 48);
  // second level inverse overlap
  if (overlap === OL_TWO) {
    if (leftAdjacent && top) p[p1 - 64] = p[p1 - 64]! - p[p1 - 64 + 32]!;
    if (rightAdjacent && top) corners.before[0] = p[p1]!;
    if (right && top) p[p1 - 64 + 32] = p[p1 - 64 + 32]! - corners.before[0];
    if (leftAdjacent && bottom) p[p0 - 64 + 16] = p[p0 - 64 + 16]! - p[p0 - 64 + 48]!;
    if (rightAdjacent && bottom) corners.before[1] = p[p0 + 16]!;
    if (right && bottom) p[p0 - 64 + 48] = p[p0 - 64 + 48]! - corners.before[1];
    if (leftOrRight && !topOrBottom) {
      if (left) post2(p, p0 + 0 + 16, p1 + 0);
      if (right) post2(p, p0 - 32 + 16, p1 - 32);
    }
    if (!leftOrRight) {
      if (topOrBottom) {
        if (top) post2(p, p1 - 32, p1);
        if (bottom) post2(p, p0 + 16 - 32, p0 + 16);
      } else post2x2(p, p0 - 16, p0 + 16, p1 - 32, p1);
    }
    if (leftAdjacent && top) p[p1 - 64] = p[p1 - 64]! + p[p1 - 64 + 32]!;
    if (rightAdjacent && top) corners.after[0] = p[p1]!;
    if (right && top) p[p1 - 64 + 32] = p[p1 - 64 + 32]! + corners.after[0];
    if (leftAdjacent && bottom) p[p0 - 64 + 16] = p[p0 - 64 + 16]! + p[p0 - 64 + 48]!;
    if (rightAdjacent && bottom) corners.after[1] = p[p0 + 16]!;
    if (right && bottom) p[p0 - 64 + 48] = p[p0 - 64 + 48]! + corners.after[1];
  }
  // first level inverse transform (the left column waits one macroblock for the corner operations)
  if (!top) {
    for (let j = left ? 48 : leftAdjacent ? -48 : -16; j < (right ? 16 : 48); j += 32) invStage1(p, p0 + j);
  }
  if (!bottom) {
    for (let j = left ? 32 : leftAdjacent ? -64 : -32; j < (right ? 0 : 32); j += 32) invStage1(p, p1 + j);
  }
  // first level inverse overlap
  if (overlap !== OL_NONE) {
    if (top && leftAdjacent) post4(p, p1 - 64 + 0, p1 - 64 + 1, p1 - 64 + 2, p1 - 64 + 3);
    if (top && right) post4(p, p1 - 27, p1 - 28, p1 - 25, p1 - 26);
    if (bottom && leftAdjacent) post4(p, p0 - 64 + 16 + 10, p0 - 64 + 16 + 11, p0 - 64 + 16 + 8, p0 - 64 + 16 + 9);
    if (bottom && right) post4(p, p0 - 1, p0 - 2, p0 - 3, p0 - 4);
    if (!left && !top) {
      if (leftAdjacent) {
        if (!bottom) {
          post4(p, p0 - 64 + 26, p0 - 64 + 24, p1 - 64 + 0, p1 - 64 + 2);
          post4(p, p0 - 64 + 27, p0 - 64 + 25, p1 - 64 + 1, p1 - 64 + 3);
        }
        post4(p, p0 - 64 + 10, p0 - 64 + 8, p0 - 64 + 16, p0 - 64 + 18);
        post4(p, p0 - 64 + 11, p0 - 64 + 9, p0 - 64 + 17, p0 - 64 + 19);
      }
      if (bottom) {
        let q = p0 - 48;
        post4(p, q + 15, q + 14, q + 42, q + 43);
        post4(p, q + 13, q + 12, q + 40, q + 41);
        if (!right) {
          q = p0 - 16;
          post4(p, q + 15, q + 14, q + 42, q + 43);
          post4(p, q + 13, q + 12, q + 40, q + 41);
        }
      } else {
        post4x4Stage1Split(p, p0 - 48, p1 - 16 - 48, 32);
        if (!right) post4x4Stage1Split(p, p0 - 16, p1 - 16 - 16, 32);
      }
      if (right) {
        if (!bottom) {
          post4(p, p0 - 2, p0 - 4, p1 - 28, p1 - 26);
          post4(p, p0 - 1, p0 - 3, p1 - 27, p1 - 25);
        }
        post4(p, p0 - 18, p0 - 20, p0 - 12, p0 - 10);
        post4(p, p0 - 17, p0 - 19, p0 - 11, p0 - 9);
      } else post4x4Stage1(p, p0 - 32, 32);
      post4x4Stage1(p, p0 - 64, 32);
    }
    if (top) {
      if (!left) {
        const q = p1 - 64 + 4;
        post4(p, q + 1, q + 0, q + 28, q + 29);
        post4(p, q + 3, q + 2, q + 30, q + 31);
      }
      if (!left && !right) {
        const q = p1 - 32 + 4;
        post4(p, q + 1, q + 0, q + 28, q + 29);
        post4(p, q + 3, q + 2, q + 30, q + 31);
      }
    }
  }
}

// ---- the pre filters (the overlap between blocks, in the encoder) -----------------------------------------------------

const rotate1 = (p: A, ia: number, ib: number): void => {
  p[ib] = p[ib]! - ((p[ia]! + 1) >> 1);
  p[ia] = p[ia]! + ((p[ib]! + 1) >> 1);
};

function hstEnc(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let d = p[ic]!;
  let c = p[id]!;
  a += c;
  b -= d;
  c = ((a - b) >> 1) - c;
  d += b >> 1;
  b += c;
  a -= (d * 3 + 4) >> 3;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

function hstEnc1(p: A, ia: number, id: number): void {
  let a = p[ia]!;
  let d = p[id]!;
  d -= a >> 7;
  d += a >> 10;
  d -= (a * 3) >> 4;
  a -= (d * 3) >> 3;
  d = (a >> 1) - d;
  a -= d;
  p[ia] = a;
  p[id] = d;
}

function hstEnc1Edge(p: A, ia: number, id: number): void {
  let a = p[ia]!;
  let d = -p[id]!;
  a -= d;
  d += a >> 1;
  a -= (d * 3 + 4) >> 3;
  d -= a >> 7;
  d += a >> 10;
  d -= (a * 3) >> 4;
  a -= (d * 3) >> 3;
  d = (a >> 1) - d;
  a -= d;
  p[ia] = a;
  p[id] = d;
}

function fwdOddOddPre(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  d += a;
  c -= b;
  const t1 = d >> 1;
  a -= t1;
  const t2 = c >> 1;
  b += t2;
  a += (b * 3 + 4) >> 3;
  b -= (a * 3 + 2) >> 2;
  a += (b * 3 + 6) >> 3;
  b -= t2;
  a += t1;
  c += b;
  d -= a;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

function pre4(p: A, ia: number, ib: number, ic: number, id: number): void {
  let a = p[ia]!;
  let b = p[ib]!;
  let c = p[ic]!;
  let d = p[id]!;
  a += d;
  b += c;
  d -= (a + 1) >> 1;
  c -= (b + 1) >> 1;
  d -= (c + 1) >> 1;
  c += (d + 1) >> 1;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
  hstEnc1Edge(p, ia, id);
  hstEnc1Edge(p, ib, ic);
  a = p[ia]!;
  b = p[ib]!;
  c = p[ic]!;
  d = p[id]!;
  d += (a + 1) >> 1;
  c += (b + 1) >> 1;
  a -= d;
  b -= c;
  p[ia] = a;
  p[ib] = b;
  p[ic] = c;
  p[id] = d;
}

function pre4x4Stage1Split(p: A, i0: number, i1: number, offset: number): void {
  const p2 = i0 + 72 - offset;
  const p3 = i1 + 64 - offset;
  const p0 = i0 + 12;
  const p1 = i1 + 4;
  for (let k = 0; k < 4; k++) hstEnc(p, p0 + k, p2 + k, p1 + k, p3 + k);
  for (let k = 0; k < 4; k++) hstEnc1(p, p0 + k, p3 + k);
  rotate1(p, p1 + 2, p1 + 3);
  rotate1(p, p1 + 0, p1 + 1);
  rotate1(p, p2 + 1, p2 + 3);
  rotate1(p, p2 + 0, p2 + 2);
  fwdOddOddPre(p, p3 + 0, p3 + 1, p3 + 2, p3 + 3);
  for (let k = 0; k < 4; k++) dn(p, p0 + k, p2 + k, p1 + k, p3 + k);
}

const pre4x4Stage1 = (p: A, i: number, offset: number): void => pre4x4Stage1Split(p, i, i + 16, offset);

function pre4x4Stage2Split(p: A, p0: number, p1: number): void {
  hstEnc(p, p0 - 96, p0 + 96, p1 - 112, p1 + 80);
  hstEnc(p, p0 - 32, p0 + 32, p1 - 48, p1 + 16);
  hstEnc(p, p0 - 80, p0 + 112, p1 - 128, p1 + 64);
  hstEnc(p, p0 - 16, p0 + 48, p1 - 64, p1 + 0);
  hstEnc1(p, p0 - 96, p1 + 80);
  hstEnc1(p, p0 - 32, p1 + 16);
  hstEnc1(p, p0 - 80, p1 + 64);
  hstEnc1(p, p0 - 16, p1 + 0);
  rotate1(p, p1 - 48, p1 - 112);
  rotate1(p, p1 - 64, p1 - 128);
  rotate1(p, p0 + 112, p0 + 96);
  rotate1(p, p0 + 48, p0 + 32);
  fwdOddOddPre(p, p1 + 0, p1 + 64, p1 + 16, p1 + 80);
  dn(p, p0 - 96, p1 - 112, p0 + 96, p1 + 80);
  dn(p, p0 - 32, p1 - 48, p0 + 32, p1 + 16);
  dn(p, p0 - 80, p1 - 128, p0 + 112, p1 + 64);
  dn(p, p0 - 16, p1 - 64, p0 + 48, p1 + 0);
}

/**
 * The forward counterpart of `invTransformChannel`: with the macroblock `p1` of the row being loaded and `p0` above it
 * in the buffer, filters across the edges between blocks, transforms the blocks that are complete, and finishes the
 * macroblock before and above (the second stage), which is then ready to be coded.
 */
export function fwdTransformChannel(p: A, p0: number, p1: number, at: MbPlace, overlap: number): void {
  const { left, right, top, bottom } = at;
  const topOrBottom = top || bottom;
  const leftOrRight = left || right;
  const topOrLeft = top || left;
  if (overlap !== OL_NONE) {
    if (top && left) pre4(p, p1 + 0, p1 + 1, p1 + 2, p1 + 3);
    if (top && right) pre4(p, p1 - 59, p1 - 60, p1 - 57, p1 - 58);
    if (bottom && left) pre4(p, p0 + 48 + 10, p0 + 48 + 11, p0 + 48 + 8, p0 + 48 + 9);
    if (bottom && right) pre4(p, p0 - 1, p0 - 2, p0 - 3, p0 - 4);
    if (!right && !bottom) {
      if (top) {
        for (let j = left ? 0 : -64; j < 192; j += 64) {
          const q = p1 + j;
          pre4(p, q + 5, q + 4, q + 64, q + 65);
          pre4(p, q + 7, q + 6, q + 66, q + 67);
        }
      } else {
        for (let j = left ? 0 : -64; j < 192; j += 64) pre4x4Stage1Split(p, p0 + 48 + j, p1 + j, 0);
      }
      if (left) {
        if (!top) {
          pre4(p, p0 + 58, p0 + 56, p1 + 0, p1 + 2);
          pre4(p, p0 + 59, p0 + 57, p1 + 1, p1 + 3);
        }
        for (let j = -64; j < -16; j += 16) {
          const q = p1 + j;
          pre4(p, q + 74, q + 72, q + 80, q + 82);
          pre4(p, q + 75, q + 73, q + 81, q + 83);
        }
      } else {
        for (let j = -64; j < -16; j += 16) pre4x4Stage1(p, p1 + j, 0);
      }
      for (const j of [0, 16, 32, 64, 80, 96, 128, 144, 160]) pre4x4Stage1(p, p1 + j, 0);
    }
    if (bottom) {
      for (let j = left ? 48 : -16; j < (right ? -16 : 240); j += 64) {
        const q = p0 + j;
        pre4(p, q + 15, q + 14, q + 74, q + 75);
        pre4(p, q + 13, q + 12, q + 72, q + 73);
      }
    }
    if (right && !bottom) {
      if (!top) {
        pre4(p, p0 - 1, p0 - 3, p1 - 59, p1 - 57);
        pre4(p, p0 - 2, p0 - 4, p1 - 60, p1 - 58);
      }
      for (let j = -64; j < -16; j += 16) {
        const q = p1 + j;
        pre4(p, q + 15, q + 13, q + 21, q + 23);
        pre4(p, q + 14, q + 12, q + 20, q + 22);
      }
    }
  }
  // first level transform
  if (!top) for (let j = left ? 48 : -16; j < (right ? 48 : 240); j += 64) fwdStage1(p, p0 + j);
  if (!bottom) {
    for (let j = left ? 0 : -64; j < (right ? 0 : 192); j += 64) {
      fwdStage1(p, p1 + j + 0);
      fwdStage1(p, p1 + j + 16);
      fwdStage1(p, p1 + j + 32);
    }
  }
  // second level overlap
  if (overlap === OL_TWO) {
    if (top && left) pre4(p, p1 + 0, p1 + 64, p1 + 0 + 16, p1 + 64 + 16);
    if (top && right) pre4(p, p1 - 128, p1 - 64, p1 - 128 + 16, p1 - 64 + 16);
    if (bottom && left) pre4(p, p0 + 32, p0 + 96, p0 + 32 + 16, p0 + 96 + 16);
    if (bottom && right) pre4(p, p0 - 96, p0 - 32, p0 - 96 + 16, p0 - 32 + 16);
    if (leftOrRight && !topOrBottom) {
      if (left) {
        pre4(p, p0 + 32, p0 + 48, p1 + 0, p1 + 16);
        pre4(p, p0 + 96, p0 + 112, p1 + 64, p1 + 80);
      }
      if (right) {
        const j = -128;
        pre4(p, p0 + j + 32, p0 + j + 48, p1 + j + 0, p1 + j + 16);
        pre4(p, p0 + j + 96, p0 + j + 112, p1 + j + 64, p1 + j + 80);
      }
    }
    if (!leftOrRight) {
      if (topOrBottom) {
        const q = top ? p1 : p0 + 32;
        pre4(p, q - 128, q - 64, q + 0, q + 64);
        pre4(p, q - 112, q - 48, q + 16, q + 80);
      } else pre4x4Stage2Split(p, p0, p1);
    }
  }
  // second level transform
  if (!topOrLeft) fwdStage2(p, p0 - 256);
}
