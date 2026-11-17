/**
 * The standard security handler (PDF passwords): RC4 40/128 bit (V1/V2, R2/R3), AES-128 (V4, R4) and AES-256
 * (V5, R5 and R6). Opened with the empty user password, or with a password you give (user or owner).
 *
 * MD5, SHA-256/384/512, RC4 and AES are written here in plain TypeScript so the engine runs in browsers,
 * JavaScriptCore and QuickJS alike. They are for reading PDFs, not for protecting secrets: do not reuse them for
 * anything else.
 */
import { PliError } from "@pli.dev/core";
import { PdfDict, PdfName, PdfString, type PdfObj } from "./objects";

// ---- MD5 ---------------------------------------------------------------------------------------------------

let MD5_K: Uint32Array | undefined;
const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

export function md5(data: Uint8Array): Uint8Array {
  if (!MD5_K) {
    MD5_K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  }
  const K = MD5_K;
  const n = data.length;
  const total = (((n + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, (n << 3) >>> 0, true);
  dv.setUint32(total - 4, Math.floor(n / 536870912), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) & 15;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) & 15;
      }
      F = (F + A + K[i]! + M[g]!) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << MD5_S[i]!) | (F >>> (32 - MD5_S[i]!)))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0 >>> 0, true);
  ov.setUint32(4, b0 >>> 0, true);
  ov.setUint32(8, c0 >>> 0, true);
  ov.setUint32(12, d0 >>> 0, true);
  return out;
}

// ---- SHA-2 -------------------------------------------------------------------------------------------------

interface ShaTables {
  /** SHA-256 round constants. */
  k256: Uint32Array;
  /** SHA-512 round constants as (hi, lo) pairs. */
  k512: Uint32Array;
  /** Initial values: SHA-256, SHA-384, SHA-512. */
  h256: Uint32Array;
  h384: Uint32Array;
  h512: Uint32Array;
}
let SHA: ShaTables | undefined;

function shaTables(): ShaTables {
  if (SHA) return SHA;
  // The constants are fractions of square and cube roots of primes; computing them exactly needs big integers.
  const primes: number[] = [];
  for (let n = 2; primes.length < 80; n++) if (primes.every((p) => n % p !== 0)) primes.push(n);
  const root = (n: bigint, k: bigint): bigint => {
    let x = 1n << (BigInt(n.toString(2).length) / k + 1n);
    for (;;) {
      const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
      if (y >= x) return x;
      x = y;
    }
  };
  const mask = (1n << 64n) - 1n;
  const frac = (p: number, k: bigint): bigint => root(BigInt(p) << (64n * k), k) & mask;
  const pair = (v: bigint, out: Uint32Array, i: number): void => {
    out[i] = Number(v >> 32n);
    out[i + 1] = Number(v & 0xffffffffn);
  };
  const k512 = new Uint32Array(160);
  for (let i = 0; i < 80; i++) pair(frac(primes[i]!, 3n), k512, i * 2);
  const k256 = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k256[i] = k512[i * 2]!;
  const h512 = new Uint32Array(16);
  for (let i = 0; i < 8; i++) pair(frac(primes[i]!, 2n), h512, i * 2);
  const h384 = new Uint32Array(16);
  for (let i = 0; i < 8; i++) pair(frac(primes[8 + i]!, 2n), h384, i * 2);
  const h256 = new Uint32Array(8);
  for (let i = 0; i < 8; i++) h256[i] = h512[i * 2]!;
  return (SHA = { k256, k512, h256, h384, h512 });
}

function padMessage(data: Uint8Array, block: number, lenBytes: number): Uint8Array {
  const n = data.length;
  const total = Math.ceil((n + 1 + lenBytes) / block) * block;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 4, (n << 3) >>> 0, false);
  dv.setUint32(total - 8, Math.floor(n / 536870912), false);
  return buf;
}

export function sha256(data: Uint8Array): Uint8Array {
  const t = shaTables();
  const K = t.k256;
  const H = Uint32Array.from(t.h256);
  const buf = padMessage(data, 64, 8);
  const dv = new DataView(buf.buffer);
  const W = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!;
      const w2 = W[i - 2]!;
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) | 0;
    }
    let a = H[0]!;
    let b = H[1]!;
    let c = H[2]!;
    let d = H[3]!;
    let e = H[4]!;
    let f = H[5]!;
    let g = H[6]!;
    let h = H[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + W[i]!) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] = (H[0]! + a) | 0;
    H[1] = (H[1]! + b) | 0;
    H[2] = (H[2]! + c) | 0;
    H[3] = (H[3]! + d) | 0;
    H[4] = (H[4]! + e) | 0;
    H[5] = (H[5]! + f) | 0;
    H[6] = (H[6]! + g) | 0;
    H[7] = (H[7]! + h) | 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]! >>> 0, false);
  return out;
}

// 64-bit helpers on (hi, lo) halves; results go to these two variables.
let rh = 0;
let rl = 0;
function rotr64(h: number, l: number, n: number): void {
  if (n < 32) {
    rh = (h >>> n) | (l << (32 - n));
    rl = (l >>> n) | (h << (32 - n));
  } else if (n === 32) {
    rh = l;
    rl = h;
  } else {
    const m = n - 32;
    rh = (l >>> m) | (h << (32 - m));
    rl = (h >>> m) | (l << (32 - m));
  }
}

function sha512core(data: Uint8Array, init: Uint32Array, outLen: number): Uint8Array {
  const K = shaTables().k512;
  const H = Uint32Array.from(init);
  const buf = padMessage(data, 128, 16);
  const dv = new DataView(buf.buffer);
  const W = new Uint32Array(160);
  for (let off = 0; off < buf.length; off += 128) {
    for (let i = 0; i < 32; i++) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      // sigma0(w[i-15]) = rotr1 ^ rotr8 ^ shr7
      const h15 = W[(i - 15) * 2]!;
      const l15 = W[(i - 15) * 2 + 1]!;
      rotr64(h15, l15, 1);
      let s0h = rh;
      let s0l = rl;
      rotr64(h15, l15, 8);
      s0h ^= rh;
      s0l ^= rl;
      s0h ^= h15 >>> 7;
      s0l ^= (l15 >>> 7) | (h15 << 25);
      const h2 = W[(i - 2) * 2]!;
      const l2 = W[(i - 2) * 2 + 1]!;
      rotr64(h2, l2, 19);
      let s1h = rh;
      let s1l = rl;
      rotr64(h2, l2, 61);
      s1h ^= rh;
      s1l ^= rl;
      s1h ^= h2 >>> 6;
      s1l ^= (l2 >>> 6) | (h2 << 26);
      // w[i] = w[i-16] + s0 + w[i-7] + s1
      const lo = (W[(i - 16) * 2 + 1]! >>> 0) + (s0l >>> 0) + (W[(i - 7) * 2 + 1]! >>> 0) + (s1l >>> 0);
      const carry = Math.floor(lo / 4294967296);
      W[i * 2 + 1] = lo >>> 0;
      W[i * 2] = (W[(i - 16) * 2]! + s0h + W[(i - 7) * 2]! + s1h + carry) >>> 0;
    }
    let ah = H[0]!, al = H[1]!, bh = H[2]!, bl = H[3]!, ch = H[4]!, cl = H[5]!, dh = H[6]!, dl = H[7]!;
    let eh = H[8]!, el = H[9]!, fh = H[10]!, fl = H[11]!, gh = H[12]!, gl = H[13]!, hh = H[14]!, hl = H[15]!;
    for (let i = 0; i < 80; i++) {
      // S1(e) = rotr14 ^ rotr18 ^ rotr41
      rotr64(eh, el, 14);
      let S1h = rh;
      let S1l = rl;
      rotr64(eh, el, 18);
      S1h ^= rh;
      S1l ^= rl;
      rotr64(eh, el, 41);
      S1h ^= rh;
      S1l ^= rl;
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      // t1 = h + S1 + ch + K[i] + W[i]
      let lo = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + K[i * 2 + 1]! + W[i * 2 + 1]!;
      const t1l = lo >>> 0;
      const t1h = (hh + S1h + chh + K[i * 2]! + W[i * 2]! + Math.floor(lo / 4294967296)) >>> 0;
      // S0(a) = rotr28 ^ rotr34 ^ rotr39
      rotr64(ah, al, 28);
      let S0h = rh;
      let S0l = rl;
      rotr64(ah, al, 34);
      S0h ^= rh;
      S0l ^= rl;
      rotr64(ah, al, 39);
      S0h ^= rh;
      S0l ^= rl;
      const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
      lo = (S0l >>> 0) + (majl >>> 0);
      const t2l = lo >>> 0;
      const t2h = (S0h + majh + Math.floor(lo / 4294967296)) >>> 0;
      hh = gh;
      hl = gl;
      gh = fh;
      gl = fl;
      fh = eh;
      fl = el;
      lo = (dl >>> 0) + t1l;
      el = lo >>> 0;
      eh = (dh + t1h + Math.floor(lo / 4294967296)) >>> 0;
      dh = ch;
      dl = cl;
      ch = bh;
      cl = bl;
      bh = ah;
      bl = al;
      lo = t1l + t2l;
      al = lo >>> 0;
      ah = (t1h + t2h + Math.floor(lo / 4294967296)) >>> 0;
    }
    const add = (i: number, h: number, l: number): void => {
      const lo = (H[i + 1]! >>> 0) + (l >>> 0);
      H[i + 1] = lo >>> 0;
      H[i] = (H[i]! + h + Math.floor(lo / 4294967296)) >>> 0;
    };
    add(0, ah, al);
    add(2, bh, bl);
    add(4, ch, cl);
    add(6, dh, dl);
    add(8, eh, el);
    add(10, fh, fl);
    add(12, gh, gl);
    add(14, hh, hl);
  }
  const out = new Uint8Array(64);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) ov.setUint32(i * 4, H[i]! >>> 0, false);
  return out.slice(0, outLen);
}

export const sha512 = (data: Uint8Array): Uint8Array => sha512core(data, shaTables().h512, 64);
export const sha384 = (data: Uint8Array): Uint8Array => sha512core(data, shaTables().h384, 48);

// ---- RC4 ---------------------------------------------------------------------------------------------------

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  if (key.length === 0) return data.slice();
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  let j = 0;
  for (let n = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    const t = s[i]!;
    s[i] = s[j]!;
    s[j] = t;
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

// ---- AES ---------------------------------------------------------------------------------------------------

interface AesTables {
  sbox: Uint8Array;
  inv: Uint8Array;
  te: [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
  td: [Uint32Array, Uint32Array, Uint32Array, Uint32Array];
}
let AES: AesTables | undefined;

function aesTables(): AesTables {
  if (AES) return AES;
  const sbox = new Uint8Array(256);
  const inv = new Uint8Array(256);
  let p = 1;
  let q = 1;
  do {
    p = (p ^ ((p << 1) & 255) ^ (p & 0x80 ? 0x1b : 0)) & 255; // p * 3
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 255;
    if (q & 0x80) q ^= 0x09; // q / 3
    const rot = (x: number, n: number): number => ((x << n) | (x >>> (8 - n))) & 255;
    const x = q ^ rot(q, 1) ^ rot(q, 2) ^ rot(q, 3) ^ rot(q, 4);
    sbox[p] = (x ^ 0x63) & 255;
    inv[sbox[p]!] = p;
  } while (p !== 1);
  sbox[0] = 0x63;
  inv[0x63] = 0;
  const mul = (a: number, b: number): number => {
    let r = 0;
    while (b) {
      if (b & 1) r ^= a;
      a = ((a << 1) ^ (a & 0x80 ? 0x11b : 0)) & 0x1ff;
      b >>= 1;
    }
    return r & 255;
  };
  const te: AesTables["te"] = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const td: AesTables["td"] = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < 256; i++) {
    const s = sbox[i]!;
    const w = ((mul(s, 2) << 24) | (s << 16) | (s << 8) | mul(s, 3)) >>> 0;
    te[0][i] = w;
    te[1][i] = ((w >>> 8) | (w << 24)) >>> 0;
    te[2][i] = ((w >>> 16) | (w << 16)) >>> 0;
    te[3][i] = ((w >>> 24) | (w << 8)) >>> 0;
    const v = inv[i]!;
    const d = ((mul(v, 14) << 24) | (mul(v, 9) << 16) | (mul(v, 13) << 8) | mul(v, 11)) >>> 0;
    td[0][i] = d;
    td[1][i] = ((d >>> 8) | (d << 24)) >>> 0;
    td[2][i] = ((d >>> 16) | (d << 16)) >>> 0;
    td[3][i] = ((d >>> 24) | (d << 8)) >>> 0;
  }
  return (AES = { sbox, inv, te, td });
}

class AesKey {
  readonly rounds: number;
  readonly enc: Uint32Array;
  private dec?: Uint32Array;
  constructor(key: Uint8Array) {
    if (key.length !== 16 && key.length !== 24 && key.length !== 32) throw new PliError("invalid_operation", "bad AES key length");
    const { sbox } = aesTables();
    const nk = key.length / 4;
    this.rounds = nk + 6;
    const total = 4 * (this.rounds + 1);
    const w = new Uint32Array(total);
    for (let i = 0; i < nk; i++) w[i] = ((key[4 * i]! << 24) | (key[4 * i + 1]! << 16) | (key[4 * i + 2]! << 8) | key[4 * i + 3]!) >>> 0;
    const sub = (x: number): number => ((sbox[x >>> 24]! << 24) | (sbox[(x >>> 16) & 255]! << 16) | (sbox[(x >>> 8) & 255]! << 8) | sbox[x & 255]!) >>> 0;
    let rcon = 1;
    for (let i = nk; i < total; i++) {
      let t = w[i - 1]!;
      if (i % nk === 0) {
        t = sub(((t << 8) | (t >>> 24)) >>> 0) ^ (rcon << 24);
        rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 255;
      } else if (nk > 6 && i % nk === 4) t = sub(t);
      w[i] = (w[i - nk]! ^ t) >>> 0;
    }
    this.enc = w;
  }
  decKeys(): Uint32Array {
    if (this.dec) return this.dec;
    const { td, sbox } = aesTables();
    const n = this.rounds;
    const dk = new Uint32Array(this.enc.length);
    for (let r = 0; r <= n; r++) {
      for (let c = 0; c < 4; c++) {
        const w = this.enc[4 * (n - r) + c]!;
        dk[4 * r + c] = r === 0 || r === n ? w : (td[0][sbox[w >>> 24]!]! ^ td[1][sbox[(w >>> 16) & 255]!]! ^ td[2][sbox[(w >>> 8) & 255]!]! ^ td[3][sbox[w & 255]!]!) >>> 0;
      }
    }
    return (this.dec = dk);
  }
}

function encryptBlock(k: AesKey, s: Uint32Array): void {
  const { te, sbox } = aesTables();
  const w = k.enc;
  const [t0, t1, t2, t3] = te;
  let a = s[0]! ^ w[0]!;
  let b = s[1]! ^ w[1]!;
  let c = s[2]! ^ w[2]!;
  let d = s[3]! ^ w[3]!;
  for (let r = 1; r < k.rounds; r++) {
    const x0 = t0[a >>> 24]! ^ t1[(b >>> 16) & 255]! ^ t2[(c >>> 8) & 255]! ^ t3[d & 255]! ^ w[4 * r]!;
    const x1 = t0[b >>> 24]! ^ t1[(c >>> 16) & 255]! ^ t2[(d >>> 8) & 255]! ^ t3[a & 255]! ^ w[4 * r + 1]!;
    const x2 = t0[c >>> 24]! ^ t1[(d >>> 16) & 255]! ^ t2[(a >>> 8) & 255]! ^ t3[b & 255]! ^ w[4 * r + 2]!;
    const x3 = t0[d >>> 24]! ^ t1[(a >>> 16) & 255]! ^ t2[(b >>> 8) & 255]! ^ t3[c & 255]! ^ w[4 * r + 3]!;
    a = x0;
    b = x1;
    c = x2;
    d = x3;
  }
  const n = 4 * k.rounds;
  s[0] = (((sbox[a >>> 24]! << 24) | (sbox[(b >>> 16) & 255]! << 16) | (sbox[(c >>> 8) & 255]! << 8) | sbox[d & 255]!) ^ w[n]!) >>> 0;
  s[1] = (((sbox[b >>> 24]! << 24) | (sbox[(c >>> 16) & 255]! << 16) | (sbox[(d >>> 8) & 255]! << 8) | sbox[a & 255]!) ^ w[n + 1]!) >>> 0;
  s[2] = (((sbox[c >>> 24]! << 24) | (sbox[(d >>> 16) & 255]! << 16) | (sbox[(a >>> 8) & 255]! << 8) | sbox[b & 255]!) ^ w[n + 2]!) >>> 0;
  s[3] = (((sbox[d >>> 24]! << 24) | (sbox[(a >>> 16) & 255]! << 16) | (sbox[(b >>> 8) & 255]! << 8) | sbox[c & 255]!) ^ w[n + 3]!) >>> 0;
}

function decryptBlock(k: AesKey, s: Uint32Array): void {
  const { td, inv } = aesTables();
  const w = k.decKeys();
  const [t0, t1, t2, t3] = td;
  let a = s[0]! ^ w[0]!;
  let b = s[1]! ^ w[1]!;
  let c = s[2]! ^ w[2]!;
  let d = s[3]! ^ w[3]!;
  for (let r = 1; r < k.rounds; r++) {
    const x0 = t0[a >>> 24]! ^ t1[(d >>> 16) & 255]! ^ t2[(c >>> 8) & 255]! ^ t3[b & 255]! ^ w[4 * r]!;
    const x1 = t0[b >>> 24]! ^ t1[(a >>> 16) & 255]! ^ t2[(d >>> 8) & 255]! ^ t3[c & 255]! ^ w[4 * r + 1]!;
    const x2 = t0[c >>> 24]! ^ t1[(b >>> 16) & 255]! ^ t2[(a >>> 8) & 255]! ^ t3[d & 255]! ^ w[4 * r + 2]!;
    const x3 = t0[d >>> 24]! ^ t1[(c >>> 16) & 255]! ^ t2[(b >>> 8) & 255]! ^ t3[a & 255]! ^ w[4 * r + 3]!;
    a = x0;
    b = x1;
    c = x2;
    d = x3;
  }
  const n = 4 * k.rounds;
  s[0] = (((inv[a >>> 24]! << 24) | (inv[(d >>> 16) & 255]! << 16) | (inv[(c >>> 8) & 255]! << 8) | inv[b & 255]!) ^ w[n]!) >>> 0;
  s[1] = (((inv[b >>> 24]! << 24) | (inv[(a >>> 16) & 255]! << 16) | (inv[(d >>> 8) & 255]! << 8) | inv[c & 255]!) ^ w[n + 1]!) >>> 0;
  s[2] = (((inv[c >>> 24]! << 24) | (inv[(b >>> 16) & 255]! << 16) | (inv[(a >>> 8) & 255]! << 8) | inv[d & 255]!) ^ w[n + 2]!) >>> 0;
  s[3] = (((inv[d >>> 24]! << 24) | (inv[(c >>> 16) & 255]! << 16) | (inv[(b >>> 8) & 255]! << 8) | inv[a & 255]!) ^ w[n + 3]!) >>> 0;
}

/** AES-CBC decryption without padding removal. `data` is cut to a multiple of 16 bytes. */
export function aesCbcDecryptRaw(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const k = new AesKey(key);
  const blocks = data.length >> 4;
  const out = new Uint8Array(blocks * 16);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ov = new DataView(out.buffer);
  const ivv = new DataView(iv.buffer, iv.byteOffset, 16);
  let p0 = ivv.getUint32(0, false);
  let p1 = ivv.getUint32(4, false);
  let p2 = ivv.getUint32(8, false);
  let p3 = ivv.getUint32(12, false);
  const s = new Uint32Array(4);
  for (let i = 0; i < blocks; i++) {
    const c0 = dv.getUint32(i * 16, false);
    const c1 = dv.getUint32(i * 16 + 4, false);
    const c2 = dv.getUint32(i * 16 + 8, false);
    const c3 = dv.getUint32(i * 16 + 12, false);
    s[0] = c0;
    s[1] = c1;
    s[2] = c2;
    s[3] = c3;
    decryptBlock(k, s);
    ov.setUint32(i * 16, (s[0]! ^ p0) >>> 0, false);
    ov.setUint32(i * 16 + 4, (s[1]! ^ p1) >>> 0, false);
    ov.setUint32(i * 16 + 8, (s[2]! ^ p2) >>> 0, false);
    ov.setUint32(i * 16 + 12, (s[3]! ^ p3) >>> 0, false);
    p0 = c0;
    p1 = c1;
    p2 = c2;
    p3 = c3;
  }
  return out;
}

/** AES-CBC encryption of whole blocks (`data.length` must be a multiple of 16), no padding. */
export function aesCbcEncryptRaw(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const k = new AesKey(key);
  const blocks = data.length >> 4;
  const out = new Uint8Array(blocks * 16);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ov = new DataView(out.buffer);
  const ivv = new DataView(iv.buffer, iv.byteOffset, 16);
  let p0 = ivv.getUint32(0, false);
  let p1 = ivv.getUint32(4, false);
  let p2 = ivv.getUint32(8, false);
  let p3 = ivv.getUint32(12, false);
  const s = new Uint32Array(4);
  for (let i = 0; i < blocks; i++) {
    s[0] = (dv.getUint32(i * 16, false) ^ p0) >>> 0;
    s[1] = (dv.getUint32(i * 16 + 4, false) ^ p1) >>> 0;
    s[2] = (dv.getUint32(i * 16 + 8, false) ^ p2) >>> 0;
    s[3] = (dv.getUint32(i * 16 + 12, false) ^ p3) >>> 0;
    encryptBlock(k, s);
    p0 = s[0]!;
    p1 = s[1]!;
    p2 = s[2]!;
    p3 = s[3]!;
    ov.setUint32(i * 16, p0, false);
    ov.setUint32(i * 16 + 4, p1, false);
    ov.setUint32(i * 16 + 8, p2, false);
    ov.setUint32(i * 16 + 12, p3, false);
  }
  return out;
}

/** PDF AES data: 16 bytes of IV, then CBC blocks with PKCS#5 padding. Damaged padding is left alone. */
export function aesDecryptPdf(key: Uint8Array, data: Uint8Array): Uint8Array {
  if (data.length < 32) return new Uint8Array(0);
  const iv = data.subarray(0, 16);
  const out = aesCbcDecryptRaw(key, iv, data.subarray(16));
  const pad = out.length ? out[out.length - 1]! : 0;
  if (pad >= 1 && pad <= 16 && pad <= out.length) return out.subarray(0, out.length - pad);
  return out;
}

// ---- The standard security handler -----------------------------------------------------------------------------

const PAD = Uint8Array.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a]);

export type CryptMethod = "None" | "RC4" | "AESV2" | "AESV3";

const concat = (...parts: Uint8Array[]): Uint8Array => {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

const eq = (a: Uint8Array, b: Uint8Array, n: number): boolean => {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Algorithm 2.B of ISO 32000-2: the hash of AES-256 revision 6. */
function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = sha256(concat(password, salt, udata));
  let i = 0;
  let last = 0;
  do {
    const k1 = concat(password, k, udata);
    const rep = new Uint8Array(k1.length * 64);
    for (let r = 0; r < 64; r++) rep.set(k1, r * k1.length);
    const e = aesCbcEncryptRaw(k.subarray(0, 16), k.subarray(16, 32), rep);
    let m = 0;
    for (let j = 0; j < 16; j++) m += e[j]!;
    m %= 3;
    k = m === 0 ? sha256(e) : m === 1 ? sha384(e) : sha512(e);
    last = e[e.length - 1]!;
    i++;
  } while (i < 64 || last > i - 32);
  return k.subarray(0, 32);
}

type Resolver = (o: PdfObj | undefined) => PdfObj;

export class SecurityHandler {
  readonly version: number;
  readonly revision: number;
  /** Key length in bytes. */
  readonly keyLength: number;
  readonly encryptMetadata: boolean;
  readonly stringMethod: CryptMethod;
  readonly streamMethod: CryptMethod;
  private readonly key: Uint8Array;
  private readonly filters = new Map<string, CryptMethod>();

  private constructor(
    version: number,
    revision: number,
    keyLength: number,
    encryptMetadata: boolean,
    key: Uint8Array,
    stringMethod: CryptMethod,
    streamMethod: CryptMethod,
    filters: Map<string, CryptMethod>,
  ) {
    this.version = version;
    this.revision = revision;
    this.keyLength = keyLength;
    this.encryptMetadata = encryptMetadata;
    this.key = key;
    this.stringMethod = stringMethod;
    this.streamMethod = streamMethod;
    this.filters = filters;
  }

  /**
   * Opens the handler described by an `Encrypt` dictionary (its strings still encrypted, as in the file) with the user
   * or owner password (default: empty). `id0` is the first element of the trailer `ID`.
   * Throws `PliError("unsupported", "password required")` or `"wrong password"`.
   */
  static open(encrypt: PdfDict, id0: Uint8Array, password: string | Uint8Array = "", resolve: Resolver = (o) => (o === undefined ? null : o)): SecurityHandler {
    const num = (k: string, def: number): number => {
      const v = resolve(encrypt.get(k));
      return typeof v === "number" ? v : def;
    };
    const bytesOf = (k: string): Uint8Array => {
      const v = resolve(encrypt.get(k));
      return v instanceof PdfString ? v.bytes : new Uint8Array(0);
    };
    const filter = resolve(encrypt.get("Filter"));
    if (!(filter instanceof PdfName) || filter.value !== "Standard") throw new PliError("unsupported", `unsupported security handler ${filter instanceof PdfName ? "/" + filter.value : ""}`.trim());
    const V = num("V", 0);
    const R = num("R", 2);
    if (V < 1 || V > 5 || R < 2 || R > 6) throw new PliError("unsupported", `unsupported encryption (V ${V}, R ${R})`);
    const O = bytesOf("O");
    const U = bytesOf("U");
    const P = num("P", 0) | 0;
    const em = resolve(encrypt.get("EncryptMetadata"));
    const encryptMetadata = em !== false;

    // Crypt filters
    const filters = new Map<string, CryptMethod>();
    filters.set("Identity", "None");
    let stringMethod: CryptMethod = "RC4";
    let streamMethod: CryptMethod = "RC4";
    let keyBytes = V === 1 ? 5 : Math.max(5, Math.min(16, Math.floor(num("Length", 40) / 8)));
    if (R === 2) keyBytes = 5;
    if (V >= 4) {
      const cf = resolve(encrypt.get("CF"));
      const method = (name: string): CryptMethod => {
        if (name === "Identity") return "None";
        const d = cf instanceof PdfDict ? resolve(cf.get(name)) : null;
        if (!(d instanceof PdfDict)) return "None";
        const cfm = resolve(d.get("CFM"));
        const m = cfm instanceof PdfName ? cfm.value : "None";
        return m === "V2" ? "RC4" : m === "AESV2" ? "AESV2" : m === "AESV3" ? "AESV3" : "None";
      };
      if (cf instanceof PdfDict) for (const name of cf.keys()) filters.set(name, method(name));
      const nameOf = (k: string): string => {
        const v = resolve(encrypt.get(k));
        return v instanceof PdfName ? v.value : "Identity";
      };
      streamMethod = method(nameOf("StmF"));
      stringMethod = method(nameOf("StrF"));
      if (V === 4) {
        keyBytes = 16;
        const first = [...filters.values()].find((m) => m === "RC4");
        if (first && cf instanceof PdfDict) {
          // RC4 crypt filter: key length from the filter or the Length entry
          let l = num("Length", 128);
          for (const name of cf.keys()) {
            const d = resolve(cf.get(name));
            if (d instanceof PdfDict && resolve(d.get("CFM")) instanceof PdfName && (resolve(d.get("CFM")) as PdfName).value === "V2") {
              const cl = resolve(d.get("Length"));
              if (typeof cl === "number") l = cl < 40 ? cl * 8 : cl;
            }
          }
          if (![...filters.values()].includes("AESV2")) keyBytes = Math.max(5, Math.min(16, Math.floor(l / 8)));
        }
      } else keyBytes = 32;
    }

    const given = password === "" ? [] : [password];
    const attempts: (string | Uint8Array)[] = ["", ...given];
    let key: Uint8Array | null = null;
    if (V === 5) {
      const OE = bytesOf("OE");
      const UE = bytesOf("UE");
      const hash = R === 5 ? (pw: Uint8Array, salt: Uint8Array, ud: Uint8Array) => sha256(concat(pw, salt, ud)) : hash2B;
      const zero = new Uint8Array(16);
      for (const a of attempts) {
        let pw = typeof a === "string" ? utf8(a) : a;
        if (pw.length > 127) pw = pw.subarray(0, 127);
        const none = new Uint8Array(0);
        if (eq(hash(pw, U.subarray(32, 40), none), U, 32)) {
          const ik = hash(pw, U.subarray(40, 48), none);
          key = aesCbcDecryptRaw(ik, zero, UE.subarray(0, 32));
          break;
        }
        const u48 = U.subarray(0, 48);
        if (eq(hash(pw, O.subarray(32, 40), u48), O, 32)) {
          const ik = hash(pw, O.subarray(40, 48), u48);
          key = aesCbcDecryptRaw(ik, zero, OE.subarray(0, 32));
          break;
        }
      }
    } else {
      const padded = (pw: Uint8Array): Uint8Array => {
        const out = new Uint8Array(32);
        const n = Math.min(32, pw.length);
        out.set(pw.subarray(0, n));
        out.set(PAD.subarray(0, 32 - n), n);
        return out;
      };
      const latin = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
      const fileKey = (pad32: Uint8Array): Uint8Array => {
        const p = new Uint8Array(4);
        new DataView(p.buffer).setInt32(0, P, true);
        let h = md5(concat(pad32, O.subarray(0, 32), p, id0, R >= 4 && !encryptMetadata ? Uint8Array.of(255, 255, 255, 255) : new Uint8Array(0)));
        if (R >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, keyBytes));
        return h.slice(0, keyBytes);
      };
      const checkUser = (k: Uint8Array): boolean => {
        if (R === 2) return eq(rc4(k, PAD), U, 32);
        let x = rc4(k, md5(concat(PAD, id0)));
        for (let i = 1; i <= 19; i++) x = rc4(k.map((b) => b ^ i), x);
        return eq(x, U, 16);
      };
      for (const a of attempts) {
        const pw = typeof a === "string" ? latin(a) : a;
        const pad = padded(pw);
        // as user password
        let k = fileKey(pad);
        if (checkUser(k)) {
          key = k;
          break;
        }
        // as owner password: recover the user password from O
        let oh = md5(pad);
        if (R >= 3) for (let i = 0; i < 50; i++) oh = md5(oh);
        const ok = oh.slice(0, keyBytes);
        let up: Uint8Array;
        if (R === 2) up = rc4(ok, O.subarray(0, 32));
        else {
          up = O.slice(0, 32);
          for (let i = 19; i >= 0; i--) up = rc4(ok.map((b) => b ^ i), up);
        }
        k = fileKey(up);
        if (checkUser(k)) {
          key = k;
          break;
        }
      }
    }
    if (!key) throw new PliError("unsupported", password === "" ? "password required" : "wrong password");
    if (V < 4) {
      stringMethod = "RC4";
      streamMethod = "RC4";
    }
    return new SecurityHandler(V, R, keyBytes, encryptMetadata, key, stringMethod, streamMethod, filters);
  }

  private objectKey(method: CryptMethod, num: number, gen: number): Uint8Array {
    if (method === "AESV3") return this.key;
    const ext = new Uint8Array(method === "AESV2" ? 9 : 5);
    ext[0] = num & 255;
    ext[1] = (num >> 8) & 255;
    ext[2] = (num >> 16) & 255;
    ext[3] = gen & 255;
    ext[4] = (gen >> 8) & 255;
    if (method === "AESV2") ext.set([0x73, 0x41, 0x6c, 0x54], 5);
    return md5(concat(this.key, ext)).subarray(0, Math.min(this.key.length + 5, 16));
  }

  private run(method: CryptMethod, data: Uint8Array, num: number, gen: number): Uint8Array {
    if (method === "None") return data;
    const key = this.objectKey(method, num, gen);
    return method === "RC4" ? rc4(key, data) : aesDecryptPdf(key, data);
  }

  decryptString(bytes: Uint8Array, num: number, gen: number): Uint8Array {
    return this.run(this.stringMethod, bytes, num, gen);
  }

  /** The method for a stream, or null when the stream is never encrypted (XRef streams, unencrypted metadata). */
  private streamMethodFor(dict: PdfDict, resolve: Resolver): CryptMethod | null {
    const type = resolve(dict.get("Type"));
    if (type instanceof PdfName) {
      if (type.value === "XRef") return null;
      if (type.value === "Metadata" && !this.encryptMetadata) return null;
    }
    let method = this.streamMethod;
    // An explicit Crypt filter picks its own method (default Identity).
    const f = resolve(dict.get("Filter"));
    const first = Array.isArray(f) ? resolve(f[0]) : f;
    if (first instanceof PdfName && first.value === "Crypt") {
      const p = resolve(dict.get("DecodeParms"));
      const pd = Array.isArray(p) ? resolve(p[0]) : p;
      const nm = pd instanceof PdfDict ? resolve(pd.get("Name")) : null;
      method = this.filters.get(nm instanceof PdfName ? nm.value : "Identity") ?? "None";
    }
    return method;
  }

  /**
   * Decrypts the data of a stream object. XRef streams, and metadata when `EncryptMetadata` is false, are left alone, as
   * are streams with an `Identity` crypt filter.
   */
  decryptStream(bytes: Uint8Array, num: number, gen: number, dict: PdfDict, resolve: Resolver = (o) => (o === undefined ? null : o)): Uint8Array {
    const method = this.streamMethodFor(dict, resolve);
    return method === null ? bytes : this.run(method, bytes, num, gen);
  }

  private seal(method: CryptMethod, data: Uint8Array, num: number, gen: number): Uint8Array {
    if (method === "None") return data;
    const key = this.objectKey(method, num, gen);
    if (method === "RC4") return rc4(key, data);
    const iv = randomBytes(16);
    const padLen = 16 - (data.length % 16);
    const padded = new Uint8Array(data.length + padLen);
    padded.set(data);
    padded.fill(padLen, data.length);
    return concat(iv, aesCbcEncryptRaw(key, iv, padded));
  }

  /** The inverse of `decryptString`, for writing new strings into an encrypted file. */
  encryptString(bytes: Uint8Array, num: number, gen: number): Uint8Array {
    return this.seal(this.stringMethod, bytes, num, gen);
  }

  /** The inverse of `decryptStream` (same exceptions: XRef streams, unencrypted metadata, Identity). */
  encryptStream(bytes: Uint8Array, num: number, gen: number, dict: PdfDict, resolve: Resolver = (o) => (o === undefined ? null : o)): Uint8Array {
    const method = this.streamMethodFor(dict, resolve);
    return method === null ? bytes : this.seal(method, bytes, num, gen);
  }
}

/** Random bytes: `crypto.getRandomValues` when the engine has it, else `Math.random` (an IV only needs to be unpredictable enough, not secret). */
function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}
