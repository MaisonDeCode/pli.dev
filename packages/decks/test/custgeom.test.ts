import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, customPath, customPdfPath, customTextRect, guideResolver, parseDeck, serializeDeck, unresolvedGuides, validateDeck, type CustomGeometry, type CustomCommand } from "../src";

type Cmd = [string, ...number[]];

/** Parses the SVG path data the engine writes (M, L, C, Z) into commands. */
function parse(d: string): Cmd[] {
  const out: Cmd[] = [];
  for (const m of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) out.push([m[1]!, ...m[2]!.trim().split(/\s+/).filter(Boolean).map(Number)]);
  return out;
}

/** Points along every curve and line of a path. */
function sample(cmds: readonly (readonly (string | number)[])[], per = 40): [number, number][] {
  const pts: [number, number][] = [];
  let cx = 0;
  let cy = 0;
  for (const c of cmds) {
    const n = c.slice(1) as number[];
    if (c[0] === "M" || c[0] === "L") {
      [cx, cy] = [n[0]!, n[1]!];
      pts.push([cx, cy]);
    } else if (c[0] === "C") {
      for (let i = 1; i <= per; i++) {
        const u = i / per;
        const v = 1 - u;
        pts.push([v * v * v * cx + 3 * v * v * u * n[0]! + 3 * v * u * u * n[2]! + u * u * u * n[4]!, v * v * v * cy + 3 * v * v * u * n[1]! + 3 * v * u * u * n[3]! + u * u * u * n[5]!]);
      }
      [cx, cy] = [n[4]!, n[5]!];
    }
  }
  return pts;
}

const geom = (commands: CustomCommand[], w = 100, h = 100, extra: Partial<CustomGeometry> = {}): CustomGeometry => ({ paths: [{ w, h, commands }], ...extra });
const first = (c: CustomGeometry, w: number, h: number) => customPath(c, w, h)[0]!;

describe("custom geometry paths", () => {
  it("draws a circle of four cubic curves that matches an ellipse", () => {
    // M left, then four 90 degree arcs, the way PowerPoint writes an ellipse.
    const c = geom([["M", 0, 50], ["A", 50, 50, 10800000, 5400000], ["A", 50, 50, 16200000, 5400000], ["A", 50, 50, 0, 5400000], ["A", 50, 50, 5400000, 5400000], ["Z"]]);
    const cmds = parse(first(c, 100, 100).d);
    expect(cmds.filter((k) => k[0] === "C")).toHaveLength(4);
    expect(cmds.at(-1)![0]).toBe("Z");
    for (const [x, y] of sample(cmds, 60)) expect(Math.abs(Math.hypot(x - 50, y - 50) - 50)).toBeLessThan(0.02);
  });

  it("scales a circle's path into a wider element as an ellipse", () => {
    const c = geom([["M", 0, 50], ["A", 50, 50, 10800000, 21600000], ["Z"]]);
    const cmds = parse(first(c, 300, 100).d);
    for (const [x, y] of sample(cmds, 60)) expect(Math.abs(((x - 150) / 150) ** 2 + ((y - 50) / 50) ** 2 - 1)).toBeLessThan(0.001);
    expect(cmds.filter((k) => k[0] === "C").length).toBe(4);
  });

  it("converts arcTo exactly for a circular quarter", () => {
    const c = geom([["M", 100, 50], ["A", 50, 50, 0, 5400000]]);
    const cmds = parse(first(c, 100, 100).d);
    expect(cmds).toHaveLength(2);
    const [, x1, y1, x2, y2, x, y] = cmds[1]!;
    expect(x).toBeCloseTo(50, 3);
    expect(y).toBeCloseTo(100, 3);
    // the standard quarter circle handle length, 4/3 tan(pi/8)
    const k = 0.5522847498;
    expect(x1).toBeCloseTo(100, 3);
    expect(y1).toBeCloseTo(50 + 50 * k, 3);
    expect(x2).toBeCloseTo(50 + 50 * k, 3);
    expect(y2).toBeCloseTo(100, 3);
  });

  it("measures arc angles on the ellipse as drawn (visual angles), counterclockwise for negative sweeps", () => {
    // Start 45 degrees (visual) on an ellipse 200 by 100, sweep 90 clockwise: the end is at 135 degrees visual.
    const c = geom([["M", 100 + 100 * Math.cos(Math.atan2(100 * Math.sin(Math.PI / 4), 50 * Math.cos(Math.PI / 4))), 50 + 50 * Math.sin(Math.atan2(100 * Math.sin(Math.PI / 4), 50 * Math.cos(Math.PI / 4)))], ["A", 100, 50, 2700000, 5400000]], 200, 100);
    const cmds = parse(first(c, 200, 100).d);
    const end = cmds.at(-1)!.slice(-2) as number[];
    const dx = end[0]! - 100;
    const dy = end[1]! - 50;
    expect(Math.abs((dx / 100) ** 2 + (dy / 50) ** 2 - 1)).toBeLessThan(1e-3);
    expect((Math.atan2(dy, dx) * 180) / Math.PI).toBeCloseTo(135, 3);
    const back = geom([["M", 200, 50], ["A", 100, 50, 0, -5400000]], 200, 100);
    const end2 = parse(first(back, 200, 100).d).at(-1)!.slice(-2) as number[];
    expect(end2[0]).toBeCloseTo(100, 3);
    expect(end2[1]).toBeCloseTo(0, 3);
  });

  it("scales when the path's own size differs from the element's", () => {
    const c = geom([["M", 0, 0], ["L", 1000, 0], ["L", 1000, 500], ["Z"]], 1000, 500);
    expect(first(c, 200, 80).d).toBe("M 0 0 L 200 0 L 200 80 Z");
    expect(first(c, 50, 50).d).toBe("M 0 0 L 50 0 L 50 50 Z");
  });

  it("draws a path without a size in the element's own EMU space", () => {
    const c = geom([["M", 0, 0], ["L", 2540000, 1270000]], 0, 0);
    expect(first(c, 200, 100).d).toBe("M 0 0 L 200 100");
  });

  it("turns quadratic curves into the cubics that draw the same curve", () => {
    const c = geom([["M", 0, 0], ["Q", 50, 100, 100, 0]]);
    const [m, k] = parse(first(c, 100, 100).d);
    expect(m).toEqual(["M", 0, 0]);
    expect(k!.slice(1)).toEqual([33.333, 66.667, 66.667, 66.667, 100, 0]);
    // the quadratic's midpoint is (50, 50)
    const mid = sample([m!, k!], 2)[1]!;
    expect(mid[0]).toBeCloseTo(50, 2);
    expect(mid[1]).toBeCloseTo(50, 2);
  });

  it("keeps several paths with their own spaces, fill modes and strokes", () => {
    const c: CustomGeometry = {
      paths: [
        { w: 100, h: 100, commands: [["M", 0, 0], ["L", 100, 0], ["L", 100, 100], ["Z"]] },
        { w: 10, h: 10, fill: "none", commands: [["M", 0, 0], ["L", 10, 10]] },
        { w: 10, h: 10, stroke: false, fill: "darkenLess", commands: [["M", 0, 10], ["L", 10, 10], ["L", 10, 0], ["Z"]] },
      ],
    };
    const out = customPath(c, 200, 50);
    expect(out).toEqual([
      { d: "M 0 0 L 200 0 L 200 50 Z", fill: true, stroke: true },
      { d: "M 0 0 L 200 50", fill: false, stroke: true },
      { d: "M 0 50 L 200 50 L 200 0 Z", fill: true, stroke: false, shade: "darkenLess" },
    ]);
  });

  it("fills paths with several sub-paths by the even-odd rule, so a ring has a hole", () => {
    const ring: CustomGeometry = geom([["M", 0, 50], ["A", 50, 50, 10800000, 21600000], ["Z"], ["M", 25, 50], ["A", 25, 25, 10800000, 21600000], ["Z"]]);
    expect(first(ring, 100, 100).evenOdd).toBe(true);
    expect(first(geom([["M", 0, 0], ["L", 5, 5], ["Z"]]), 10, 10).evenOdd).toBeUndefined();
  });

  it("returns the same outline as SVG and as PDF commands", () => {
    const c: CustomGeometry = {
      paths: [
        { w: 100, h: 100, commands: [["M", 10, 10], ["Q", 50, 90, 90, 10], ["A", 30, 20, 0, 10800000], ["L", 20, 80], ["C", 0, 60, 0, 30, 10, 10], ["Z"]] },
        { w: 4, h: 4, fill: "none", stroke: false, commands: [["M", 0, 0], ["L", 4, 4]] },
      ],
    };
    const svg = customPath(c, 240, 120);
    const pdf = customPdfPath(c, 240, 120);
    expect(pdf).toHaveLength(svg.length);
    svg.forEach((s, i) => {
      const p = pdf[i]!;
      expect(p.fill).toBe(s.fill);
      expect(p.stroke).toBe(s.stroke);
      expect(p.evenOdd).toBe(!!s.evenOdd);
      const fromSvg = parse(s.d);
      expect(p.commands.length).toBe(fromSvg.length);
      p.commands.forEach((cmd, j) => {
        expect(cmd[0]).toBe(fromSvg[j]![0]);
        cmd.slice(1).forEach((v, k) => expect(v as number).toBeCloseTo(fromSvg[j]![k + 1] as number, 2));
      });
    });
  });

  it("starts a stray drawing command at nothing: commands before a move are ignored", () => {
    const c = geom([["L", 10, 10], ["C", 1, 1, 2, 2, 3, 3], ["Z"], ["M", 0, 0], ["L", 10, 10]], 10, 10);
    expect(first(c, 10, 10).d).toBe("M 0 0 L 10 10");
  });
});

describe("guides", () => {
  const at = (custom: CustomGeometry, w = 100, h = 50) => guideResolver(custom, w, h);
  const E = 12700;

  it("knows the built-in names, in EMU", () => {
    const g = at({ paths: [] });
    expect(g("w")).toBe(100 * E);
    expect(g("r")).toBe(100 * E);
    expect(g("h")).toBe(50 * E);
    expect(g("b")).toBe(50 * E);
    expect(g("l")).toBe(0);
    expect(g("hc")).toBe(50 * E);
    expect(g("vc")).toBe(25 * E);
    expect(g("ss")).toBe(50 * E);
    expect(g("ls")).toBe(100 * E);
    expect(g("wd4")).toBe(25 * E);
    expect(g("hd2")).toBe(25 * E);
    expect(g("ssd8")).toBe((50 * E) / 8);
    expect(g("cd4")).toBe(5400000);
    expect(g("3cd4")).toBe(16200000);
    expect(g("cd2")).toBe(10800000);
    expect(g("nonsense")).toBe(0);
    expect(g("wd0")).toBe(0);
  });

  it("evaluates the formula set", () => {
    const f = (fmla: string, extra: CustomGeometry["adjust"] = {}) => at({ paths: [], adjust: extra, guides: [{ name: "x", fmla }] })("x");
    expect(f("val 7")).toBe(7);
    expect(f("*/ 10 3 4")).toBe(7.5);
    expect(f("*/ 10 3 0")).toBe(0);
    expect(f("+- 10 3 4")).toBe(9);
    expect(f("+/ 10 2 4")).toBe(3);
    expect(f("abs -5")).toBe(5);
    expect(f("sqrt 16")).toBe(4);
    expect(f("sqrt -4")).toBe(0);
    expect(f("min 3 9")).toBe(3);
    expect(f("max 3 9")).toBe(9);
    expect(f("mod 3 4 12")).toBe(13);
    expect(f("pin 0 5 10")).toBe(5);
    expect(f("pin 0 -5 10")).toBe(0);
    expect(f("pin 0 50 10")).toBe(10);
    expect(f("?: 1 5 6")).toBe(5);
    expect(f("?: 0 5 6")).toBe(6);
    expect(f("?: -1 5 6")).toBe(6);
    expect(f("cos 100 5400000")).toBeCloseTo(0, 9);
    expect(f("cos 100 0")).toBe(100);
    expect(f("sin 100 5400000")).toBeCloseTo(100, 9);
    expect(f("tan 100 2700000")).toBeCloseTo(100, 9);
    expect(f("at2 1 1")).toBeCloseTo(2700000, 6);
    expect(f("at2 -1 0")).toBeCloseTo(10800000, 6);
    expect(f("cat2 100 1 1")).toBeCloseTo(70.7107, 3);
    expect(f("sat2 100 1 1")).toBeCloseTo(70.7107, 3);
    expect(f("bogus 1 2")).toBe(0);
    expect(f("*/ a 2 2", { a: 8 })).toBe(8);
  });

  it("evaluates guides in terms of other guides, adjust values and the element's size", () => {
    const c: CustomGeometry = {
      paths: [],
      adjust: { adj: 25000 },
      guides: [
        { name: "ss4", fmla: "*/ ss adj 100000" },
        { name: "x1", fmla: "+- l ss4 0" },
        { name: "x2", fmla: "+- r 0 ss4" },
        { name: "loop", fmla: "+- loop 1 0" },
        { name: "a", fmla: "+- b 0 0" },
      ],
    };
    const g = at(c, 200, 80);
    expect(g("ss4")).toBe(80 * E * 0.25);
    expect(g("x1")).toBe(20 * E);
    expect(g("x2")).toBe(180 * E);
    expect(g("loop")).toBe(1);
    expect(g("a")).toBe(80 * E);
  });

  it("draws a path made of guides and honours the element size and text rectangle", () => {
    const c: CustomGeometry = {
      adjust: { adj: 25000 },
      guides: [
        { name: "x1", fmla: "*/ 100 adj 100000" },
        { name: "tx", fmla: "*/ w 1 4" },
      ],
      rect: { l: "tx", t: "t", r: "r", b: "b" },
      paths: [{ w: 100, h: 100, commands: [["M", "x1", 0], ["L", 100, 0], ["L", 100, 100], ["L", 0, 100], ["Z"]] }],
    };
    expect(first(c, 200, 100).d).toBe("M 50 0 L 200 0 L 200 100 L 0 100 Z");
    expect(customTextRect(c, 200, 100)).toEqual({ x: 50, y: 0, w: 150, h: 100 });
    // the text rectangle follows the element's size
    expect(customTextRect(c, 400, 100)).toEqual({ x: 100, y: 0, w: 300, h: 100 });
  });

  it("takes arc angles from guides in 60000ths of a degree", () => {
    const c: CustomGeometry = { guides: [{ name: "swing", fmla: "val 5400000" }], paths: [{ w: 100, h: 100, commands: [["M", 100, 50], ["A", 50, 50, 0, "swing"]] }] };
    const end = parse(first(c, 100, 100).d).at(-1)!.slice(-2);
    expect(end[0]).toBeCloseTo(50, 3);
    expect(end[1]).toBeCloseTo(100, 3);
  });

  it("lists guides that nothing defines", () => {
    const c: CustomGeometry = { guides: [{ name: "g1", fmla: "*/ w typo 2" }], rect: { l: "g1", t: "t", r: "r", b: "missing" }, paths: [{ w: 10, h: 10, commands: [["M", "g1", "wd2"], ["L", "oops", 3]] }] };
    expect(unresolvedGuides(c).sort()).toEqual(["missing", "oops", "typo"]);
    expect(unresolvedGuides({ paths: [{ w: 1, h: 1, commands: [["M", "w", "hd4"]] }] })).toEqual([]);
    // and they draw as zero rather than failing
    expect(() => customPath(c, 100, 100)).not.toThrow();
  });
});

describe("text rectangle", () => {
  it("is the whole box by default and is pinned inside it", () => {
    const c = geom([["M", 0, 0], ["L", 1, 1]]);
    expect(customTextRect(c, 120, 60)).toEqual({ x: 0, y: 0, w: 120, h: 60 });
    const wide = { ...c, rect: { l: -999999999, t: 0, r: 999999999999, b: 635000 } };
    expect(customTextRect(wide, 100, 100)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    // reversed corners give an empty rectangle, not a negative one
    const flipped = { ...c, rect: { l: 1270000, t: 0, r: 0, b: 635000 } };
    expect(customTextRect(flipped, 100, 100)).toMatchObject({ x: 100, w: 0, h: 50 });
  });
});

describe("malformed custom geometry", () => {
  const finiteAll = (s: string) => !/NaN|Infinity|undefined/.test(s);

  it("never throws and always draws something finite", () => {
    const junk: unknown[] = [
      undefined,
      null,
      {},
      { paths: null },
      { paths: [] },
      { paths: [null, 3, "x", {}] },
      { paths: [{ w: 0, h: 0, commands: [] }] },
      { paths: [{ w: NaN, h: Infinity, commands: [["M", NaN, Infinity], ["L", 1e308, -1e308], ["Z"]] }] },
      { paths: [{ w: 10, h: 10, commands: [["A", 0, 0, 0, 0], ["M", 1, 1], ["A", 0, 5, 0, 5400000], ["A", -5, -5, NaN, NaN], ["C", 1], ["Q"], ["Z"], ["Z"], ["X", 1, 2], null, 7, "M"] }] },
      { paths: [{ w: 10, h: 10, commands: [["M", "a", "b"], ["L", {}, []]] }] },
      { paths: [{ w: 10, h: 10, commands: "nope" }] },
      { paths: [{ w: 10, h: 10, commands: [["M", 0, 0], ["A", 50, 50, 0, 1e300]] }] },
      { paths: [{ w: 10, h: 10, commands: [["M", 0, 0], ["L", 1, 1]] }], guides: [{ name: "a", fmla: "" }, { name: "b", fmla: "*/ b b b" }, null, { fmla: "val 1" }], adjust: { x: NaN }, rect: { l: "zz", t: NaN, r: null, b: undefined } },
    ];
    for (const j of junk) {
      for (const [w, h] of [[100, 50], [0, 0], [-5, 10], [NaN, 3], [1e9, 1e9]] as const) {
        const paths = customPath(j as CustomGeometry, w, h);
        expect(paths.length).toBeGreaterThan(0);
        for (const p of paths) expect(finiteAll(p.d), p.d).toBe(true);
        const pdf = customPdfPath(j as CustomGeometry, w, h);
        expect(pdf.length).toBe(paths.length);
        for (const p of pdf) expect(finiteAll(JSON.stringify(p.commands))).toBe(true);
        const r = customTextRect(j as CustomGeometry, w, h);
        for (const v of Object.values(r)) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("falls back to the bounding box when nothing is drawable", () => {
    expect(first({ paths: [] }, 80, 40).d).toBe("M 0 0 L 80 0 L 80 40 L 0 40 Z");
  });
});

describe("custom geometry in the document", () => {
  const circle = geom([["M", 0, 50], ["A", 50, 50, 10800000, 21600000], ["Z"]]);

  it("is plain JSON that serialises, parses and validates", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const sh = s.addShape(slide.id, "custom", { x: 10, y: 10, w: 100, h: 100 }, { custom: circle });
    const img = s.addImage(slide.id, "data:image/png;base64,AAAA", { w: 50, h: 50 }, { x: 0, y: 0 }, { custom: circle });
    const back = parseDeck(serializeDeck(s.deck));
    const els = back.slides[0]!.elements;
    expect(els.find((e) => e.id === sh.id)).toMatchObject({ geometry: "custom", custom: circle });
    expect(els.find((e) => e.id === img.id)).toMatchObject({ custom: circle });
  });

  it("is resolved onto shapes and images, and undone with the element", () => {
    const s = new DeckSession(createDeck());
    const slide = s.deck.slides[0]!;
    const sh = s.addShape(slide.id, "rect", { x: 10, y: 10, w: 100, h: 100 });
    s.updateElement(slide.id, sh.id, { geometry: "custom", custom: circle });
    const img = s.addImage(slide.id, "data:image/png;base64,AAAA", { w: 50, h: 50 }, { x: 0, y: 0 }, { custom: circle });
    const scene = s.scene(slide.id);
    expect(scene.elements.find((e) => e.id === sh.id)!.custom).toEqual(circle);
    expect(scene.elements.find((e) => e.id === img.id)!.custom).toEqual(circle);
    s.undo();
    s.undo();
    expect(s.scene(slide.id).elements.find((e) => e.id === sh.id)!.custom).toBeUndefined();
  });

  it("is rejected by validation when it is not well-formed", () => {
    const base = (custom: unknown) => {
      const s = new DeckSession(createDeck());
      const deck = JSON.parse(JSON.stringify(s.deck));
      deck.slides[0].elements.push({ type: "shape", id: "x1", geometry: "custom", x: 0, y: 0, w: 10, h: 10, custom });
      return deck;
    };
    expect(() => validateDeck(base(circle))).not.toThrow();
    expect(() => validateDeck(base({}))).toThrow(/custom/);
    expect(() => validateDeck(base({ paths: [{ w: 10, h: 10, commands: [["M", NaN, 1]] }] }))).toThrow();
    expect(() => validateDeck(base({ paths: [{ w: 10, h: 10, commands: [["Z", 1]] }] }))).toThrow(/command/);
    expect(() => validateDeck(base({ paths: [{ w: 10, h: 10, commands: [["Q", 1, 2, 3]] }] }))).toThrow(/command/);
    expect(() => validateDeck(base({ paths: [{ w: 10, h: 10, commands: [["M", true, 1]] }] }))).toThrow();
    expect(() => validateDeck(base({ paths: [{ w: -1, h: 10, commands: [] }] }))).toThrow();
    expect(() => validateDeck(base({ paths: [{ w: 10, h: 10, fill: "weird", commands: [] }] }))).toThrow(/fill/);
    expect(() => validateDeck(base({ paths: [], guides: [{ name: "a" }] }))).toThrow(/guide/);
    expect(() => validateDeck(base({ paths: [], adjust: { a: Infinity } }))).toThrow();
    expect(() => validateDeck(base({ paths: [], rect: { l: 0, t: 0, r: 1 } }))).toThrow(/rect/);
    const many = Array.from({ length: 20_001 }, () => ["L", 1, 1]);
    expect(() => validateDeck(base({ paths: [{ w: 10, h: 10, commands: many }] }))).toThrow(/20000/);
    expect(() => validateDeck(base({ paths: [{ w: 10, h: 10, commands: many.slice(0, 20_000) }] }))).not.toThrow();
  });
});
