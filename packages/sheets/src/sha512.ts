/*
 * SHA-512, written out so that a password can be checked at once, anywhere (the browser's own is asynchronous, and only
 * there on secure pages). Excel checks a protection password with it. The constants are worked out from the cube and
 * square roots of the first primes, as the standard says: `sha512-constants.ts` has them, and a test works them out again.
 */

import { IH, IL, KH, KL } from "./sha512-constants";

const WH = new Uint32Array(80);
const WL = new Uint32Array(80);

/** The SHA-512 hash of `data`. */
export function sha512(data: Uint8Array): Uint8Array {
  const padded = Math.ceil((data.length + 17) / 128) * 128;
  const buf = new Uint8Array(padded);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padded - 8, Math.floor((data.length * 8) / 0x100000000));
  view.setUint32(padded - 4, (data.length * 8) >>> 0);
  const hh = Uint32Array.from(IH);
  const hl = Uint32Array.from(IL);
  for (let off = 0; off < padded; off += 128) {
    for (let i = 0; i < 16; i++) {
      WH[i] = view.getUint32(off + i * 8);
      WL[i] = view.getUint32(off + i * 8 + 4);
    }
    for (let i = 16; i < 80; i++) {
      // sigma0 = rotr1 ^ rotr8 ^ shr7 of w[i-15]; sigma1 = rotr19 ^ rotr61 ^ shr6 of w[i-2]
      const ah = WH[i - 15]!, al = WL[i - 15]!;
      const s0h = ((ah >>> 1) | (al << 31)) ^ ((ah >>> 8) | (al << 24)) ^ (ah >>> 7);
      const s0l = ((al >>> 1) | (ah << 31)) ^ ((al >>> 8) | (ah << 24)) ^ ((al >>> 7) | (ah << 25));
      const bh = WH[i - 2]!, bl = WL[i - 2]!;
      const s1h = ((bh >>> 19) | (bl << 13)) ^ ((bl >>> 29) | (bh << 3)) ^ (bh >>> 6);
      const s1l = ((bl >>> 19) | (bh << 13)) ^ ((bh >>> 29) | (bl << 3)) ^ ((bl >>> 6) | (bh << 26));
      const lo = (WL[i - 16]! >>> 0) + (s0l >>> 0) + WL[i - 7]! + (s1l >>> 0);
      const hi = (WH[i - 16]! >>> 0) + (s0h >>> 0) + WH[i - 7]! + (s1h >>> 0) + Math.floor(lo / 0x100000000);
      WL[i] = lo >>> 0;
      WH[i] = hi >>> 0;
    }
    let Ah = hh[0]!, Al = hl[0]!, Bh = hh[1]!, Bl = hl[1]!, Ch = hh[2]!, Cl = hl[2]!, Dh = hh[3]!, Dl = hl[3]!;
    let Eh = hh[4]!, El = hl[4]!, Fh = hh[5]!, Fl = hl[5]!, Gh = hh[6]!, Gl = hl[6]!, Hh = hh[7]!, Hl = hl[7]!;
    for (let i = 0; i < 80; i++) {
      // Sigma1(e) = rotr14 ^ rotr18 ^ rotr41
      const S1h = ((Eh >>> 14) | (El << 18)) ^ ((Eh >>> 18) | (El << 14)) ^ ((El >>> 9) | (Eh << 23));
      const S1l = ((El >>> 14) | (Eh << 18)) ^ ((El >>> 18) | (Eh << 14)) ^ ((Eh >>> 9) | (El << 23));
      const chh = (Eh & Fh) ^ (~Eh & Gh);
      const chl = (El & Fl) ^ (~El & Gl);
      const t1lo = (Hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + KL[i]! + WL[i]!;
      const t1hi = (Hh >>> 0) + (S1h >>> 0) + (chh >>> 0) + KH[i]! + WH[i]! + Math.floor(t1lo / 0x100000000);
      const T1l = t1lo >>> 0;
      const T1h = t1hi >>> 0;
      // Sigma0(a) = rotr28 ^ rotr34 ^ rotr39
      const S0h = ((Ah >>> 28) | (Al << 4)) ^ ((Al >>> 2) | (Ah << 30)) ^ ((Al >>> 7) | (Ah << 25));
      const S0l = ((Al >>> 28) | (Ah << 4)) ^ ((Ah >>> 2) | (Al << 30)) ^ ((Ah >>> 7) | (Al << 25));
      const mjh = (Ah & Bh) ^ (Ah & Ch) ^ (Bh & Ch);
      const mjl = (Al & Bl) ^ (Al & Cl) ^ (Bl & Cl);
      const t2lo = (S0l >>> 0) + (mjl >>> 0);
      const T2l = t2lo >>> 0;
      const T2h = ((S0h >>> 0) + (mjh >>> 0) + Math.floor(t2lo / 0x100000000)) >>> 0;
      Hh = Gh; Hl = Gl; Gh = Fh; Gl = Fl; Fh = Eh; Fl = El;
      const elo = (Dl >>> 0) + T1l;
      El = elo >>> 0;
      Eh = ((Dh >>> 0) + T1h + Math.floor(elo / 0x100000000)) >>> 0;
      Dh = Ch; Dl = Cl; Ch = Bh; Cl = Bl; Bh = Ah; Bl = Al;
      const alo = T1l + T2l;
      Al = alo >>> 0;
      Ah = (T1h + T2h + Math.floor(alo / 0x100000000)) >>> 0;
    }
    const add = (i: number, h: number, l: number) => {
      const lo = hl[i]! + l;
      hl[i] = lo >>> 0;
      hh[i] = (hh[i]! + h + Math.floor(lo / 0x100000000)) >>> 0;
    };
    add(0, Ah, Al); add(1, Bh, Bl); add(2, Ch, Cl); add(3, Dh, Dl); add(4, Eh, El); add(5, Fh, Fl); add(6, Gh, Gl); add(7, Hh, Hl);
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setUint32(i * 8, hh[i]!);
    outView.setUint32(i * 8 + 4, hl[i]!);
  }
  return out;
}
