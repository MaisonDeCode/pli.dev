import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha512 } from "../src/sha512";
import { IH, IL, KH, KL } from "../src/sha512-constants";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("sha512", () => {
  it("matches the standard's test vectors", () => {
    expect(hex(sha512(new Uint8Array()))).toBe("cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e");
    expect(hex(sha512(new TextEncoder().encode("abc")))).toBe("ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f");
  });

  it("matches node's own on every length across block boundaries, and on random data", () => {
    for (let n = 0; n <= 300; n++) {
      const data = randomBytes(n);
      expect(hex(sha512(data)), `length ${n}`).toBe(createHash("sha512").update(data).digest("hex"));
    }
    const big = randomBytes(100_000);
    expect(hex(sha512(big))).toBe(createHash("sha512").update(big).digest("hex"));
  });

  it("has the constants the standard works out from prime roots (written out so that no BigInt is needed where it loads)", () => {
    const mask = (1n << 64n) - 1n;
    const primes: number[] = [];
    for (let p = 2; primes.length < 80; p++) if (primes.every((q) => p % q !== 0)) primes.push(p);
    const iroot = (n: bigint, k: bigint): bigint => {
      let x = 1n << (BigInt(n.toString(2).length) / k + 1n);
      for (;;) {
        const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
        if (y >= x) return x;
        x = y;
      }
    };
    primes.forEach((p, i) => {
      const k = iroot(BigInt(p) << 192n, 3n) & mask;
      expect([KH[i], KL[i]]).toEqual([Number(k >> 32n), Number(k & 0xffffffffn)]);
    });
    primes.slice(0, 8).forEach((p, i) => {
      const h = iroot(BigInt(p) << 128n, 2n) & mask;
      expect([IH[i], IL[i]]).toEqual([Number(h >> 32n), Number(h & 0xffffffffn)]);
    });
    expect([KH.length, KL.length, IH.length, IL.length]).toEqual([80, 80, 8, 8]);
  });
});
