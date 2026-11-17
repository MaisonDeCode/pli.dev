/** Small encoders for the filter tests (the engine only needs decoders). */

export function lzwEncode(data: Uint8Array, early = 1): Uint8Array {
  const out: number[] = [];
  let buf = 0;
  let cnt = 0;
  const put = (code: number, width: number) => {
    buf = (buf << width) | code;
    cnt += width;
    while (cnt >= 8) {
      out.push((buf >> (cnt - 8)) & 255);
      cnt -= 8;
    }
    buf &= (1 << cnt) - 1;
  };
  // the encoder's table is one entry ahead of the decoder's
  const widthFor = (n: number) => (n + early - 1 >= 2048 ? 12 : n + early - 1 >= 1024 ? 11 : n + early - 1 >= 512 ? 10 : 9);
  let dict = new Map<string, number>();
  let next = 258;
  let width = 9;
  put(256, 9);
  let w = "";
  const code = (s: string) => (s.length === 1 ? s.charCodeAt(0) : dict.get(s)!);
  for (const b of data) {
    const c = String.fromCharCode(b);
    if (w === "" || dict.has(w + c)) {
      w += c;
      continue;
    }
    put(code(w), width);
    dict.set(w + c, next++);
    width = widthFor(next);
    if (next >= 4093) {
      put(256, width);
      dict = new Map();
      next = 258;
      width = 9;
    }
    w = c;
  }
  if (w) put(code(w), width);
  put(257, widthFor(next + 1 > 4095 ? 4095 : next));
  if (cnt > 0) out.push((buf << (8 - cnt)) & 255);
  return Uint8Array.from(out);
}

export function a85Encode(data: Uint8Array): string {
  let out = "";
  for (let i = 0; i < data.length; i += 4) {
    const n = Math.min(4, data.length - i);
    let v = 0;
    for (let k = 0; k < 4; k++) v = v * 256 + (k < n ? data[i + k]! : 0);
    if (n === 4 && v === 0) {
      out += "z";
      continue;
    }
    const ch: string[] = [];
    for (let k = 0; k < 5; k++) {
      ch.unshift(String.fromCharCode((v % 85) + 33));
      v = Math.floor(v / 85);
    }
    out += ch.slice(0, n + 1).join("");
  }
  return out + "~>";
}

export function rlEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; ) {
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i] && run < 128) run++;
    if (run >= 2) {
      out.push(257 - run, data[i]!);
      i += run;
    } else {
      let j = i + 1;
      while (j < data.length && j - i < 128 && data[j] !== data[j + 1]) j++;
      out.push(j - i - 1, ...data.subarray(i, j));
      i = j;
    }
  }
  out.push(128);
  return Uint8Array.from(out);
}

