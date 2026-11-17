import { describe, expect, it } from "vitest";
import { betaI, choose, erf, erfc, gamma, gammaP, invert, lnGamma, normCdf, normInv } from "../src/functions/special";

const close = (a: number, b: number, digits = 12) => expect(Math.abs(a - b)).toBeLessThan(10 ** -digits * Math.max(1, Math.abs(b)));

describe("special functions", () => {
  it("error function", () => {
    close(erf(0.5), 0.5204998778130465);
    close(erf(1), 0.8427007929497149);
    close(erf(-2), -0.9953222650189527);
    close(erf(3), 0.9999779095030014);
    close(erfc(3), 2.209049699858544e-5, 12);
    close(erfc(5), 1.5374597944280349e-12, 12);
    expect(erf(0)).toBe(0);
  });

  it("gamma", () => {
    close(gamma(5), 24);
    close(gamma(0.5), Math.sqrt(Math.PI));
    close(gamma(-1.5), 2.3632718012073513);
    close(lnGamma(100), 359.1342053695754, 11);
    close(gammaP(2, 3), 0.8008517265285442);
    close(gammaP(0.5, 0.2), 0.47291074313446196);
  });

  it("beta, normal and inverses", () => {
    close(betaI(0.4, 2, 3), 0.5248);
    close(normCdf(1.96), 0.9750021048517795);
    close(normInv(0.975), 1.959963984540054);
    close(normInv(0.001), -3.090232306167813);
    close(normInv(0.5), 0);
    close(invert((x) => x * x * x, 8, 0, 1), 2);
    expect(choose(5, 2)).toBe(10);
    expect(choose(50, 25)).toBeCloseTo(126410606437752, 0);
  });
});
