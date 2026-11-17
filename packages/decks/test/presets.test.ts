import { describe, expect, it } from "vitest";
import { PRESET_GEOMETRIES, PRESET_GROUPS, hasPreset, presetAdjustDefaults, presetPath, presetPdfPath, presetTextRect } from "../src";

type Tok = { cmd: string; nums: number[] };

/** A small SVG path tokenizer: letters followed by numbers. Throws on anything else. */
function tokenize(d: string): Tok[] {
  const out: Tok[] = [];
  const re = /([MLCZ])|(-?\d+(?:\.\d+)?(?:e-?\d+)?)|\s+/gy;
  let m: RegExpExecArray | null;
  let at = 0;
  while (at < d.length) {
    re.lastIndex = at;
    m = re.exec(d);
    if (!m) throw new Error(`bad path data at ${at}: ${d.slice(at, at + 20)}`);
    at = re.lastIndex;
    if (m[1]) out.push({ cmd: m[1], nums: [] });
    else if (m[2]) out[out.length - 1]!.nums.push(Number(m[2]));
  }
  return out;
}

const ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };

/** The sampled extent of all paths. */
function extent(paths: { d: string }[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  };
  for (const p of paths) {
    let cx = 0, cy = 0;
    for (const t of tokenize(p.d)) {
      if (t.cmd === "M" || t.cmd === "L") { add(t.nums[0]!, t.nums[1]!); cx = t.nums[0]!; cy = t.nums[1]!; }
      else if (t.cmd === "C") {
        const [a, b, c, d, e, f] = t.nums as [number, number, number, number, number, number];
        for (let i = 1; i <= 20; i++) {
          const u = i / 20, v = 1 - u;
          add(v * v * v * cx + 3 * v * v * u * a + 3 * v * u * u * c + u * u * u * e, v * v * v * cy + 3 * v * v * u * b + 3 * v * u * u * d + u * u * u * f);
        }
        cx = e; cy = f;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

const CALLOUTS = new Set(["wedgeRectCallout", "wedgeRoundRectCallout", "wedgeEllipseCallout", "cloudCallout"]);
const catalogue = PRESET_GROUPS.flatMap((g) => g.shapes.map((s) => s.geometry));

describe("preset geometries", () => {
  it("has the required catalogue and a menu entry for every one", () => {
    const required = "rect roundRect ellipse triangle rtTriangle diamond parallelogram trapezoid pentagon hexagon octagon plus star4 star5 star6 star8 heart cloud moon sun smileyFace lightningBolt donut noSmoking blockArc arc chord pie can cube bevel frame halfFrame corner rightArrow leftArrow upArrow downArrow leftRightArrow upDownArrow bentArrow uturnArrow chevron homePlate notchedRightArrow stripedRightArrow rightArrowCallout wedgeRectCallout wedgeRoundRectCallout wedgeEllipseCallout cloudCallout flowChartProcess flowChartDecision flowChartTerminator flowChartDocument flowChartData flowChartConnector leftBrace rightBrace leftBracket rightBracket bracePair bracketPair line straightConnector1 curvedConnector3 bentConnector3".split(" ");
    for (const name of required) {
      expect(hasPreset(name), name).toBe(true);
      expect(catalogue, name).toContain(name);
    }
    expect(new Set(catalogue).size).toBe(catalogue.length);
    for (const name of catalogue) expect(hasPreset(name), name).toBe(true);
    expect(PRESET_GROUPS.map((g) => g.label)).toEqual(["Shapes", "Arrows", "Callouts", "Flowchart", "Stars", "Lines"]);
    expect(PRESET_GEOMETRIES.length).toBeGreaterThanOrEqual(catalogue.length);
  });

  it("draws finite, non-empty, in-bounds paths at several sizes (including flat lines)", () => {
    const sizes: [number, number][] = [[100, 100], [300, 120], [60, 200], [1, 1], [120, 0], [0, 80]];
    for (const name of PRESET_GEOMETRIES) {
      for (const [w, h] of sizes) {
        const paths = presetPath(name, w, h);
        expect(paths.length, `${name} ${w}x${h}`).toBeGreaterThan(0);
        for (const p of paths) {
          expect(p.d.length, name).toBeGreaterThan(0);
          const toks = tokenize(p.d);
          expect(toks[0]!.cmd, name).toBe("M");
          for (const t of toks) {
            expect(t.nums.length, `${name} ${t.cmd}`).toBe(ARITY[t.cmd]);
            for (const n of t.nums) expect(Number.isFinite(n), `${name} ${w}x${h}`).toBe(true);
          }
        }
        if (w >= 60 && h >= 60 && !CALLOUTS.has(name)) {
          const e = extent(paths);
          const tol = 0.012 * Math.max(w, h) + 0.5;
          expect(e.x0, `${name} ${w}x${h} left`).toBeGreaterThanOrEqual(-tol);
          expect(e.y0, `${name} ${w}x${h} top`).toBeGreaterThanOrEqual(-tol);
          expect(e.x1, `${name} ${w}x${h} right`).toBeLessThanOrEqual(w + tol);
          expect(e.y1, `${name} ${w}x${h} bottom`).toBeLessThanOrEqual(h + tol);
        }
      }
    }
  });

  it("fills the box for the basic closed shapes", () => {
    for (const name of ["rect", "roundRect", "ellipse", "triangle", "diamond", "hexagon", "octagon", "plus", "star5", "star6", "heart", "cloud", "rightArrow", "upArrow", "chevron", "can", "flowChartTerminator"]) {
      const e = extent(presetPath(name, 200, 120));
      expect(e.x1 - e.x0, name).toBeGreaterThan(190);
      expect(e.y1 - e.y0, name).toBeGreaterThan(110);
    }
  });

  it("falls back to a rectangle for unknown names", () => {
    expect(presetPath("noSuchShape", 50, 30)).toEqual(presetPath("rect", 50, 30));
    expect(presetPath("__proto__", 50, 30)).toEqual(presetPath("rect", 50, 30));
    expect(hasPreset("toString")).toBe(false);
    expect(presetAdjustDefaults("noSuchShape")).toEqual({});
  });

  it("reports PowerPoint's default adjustment values", () => {
    expect(presetAdjustDefaults("roundRect")).toEqual({ adj: 16667 });
    expect(presetAdjustDefaults("rightArrow")).toEqual({ adj1: 50000, adj2: 50000 });
    expect(presetAdjustDefaults("star5")).toEqual({ adj: 19098 });
    expect(presetAdjustDefaults("wedgeRectCallout")).toEqual({ adj1: -20833, adj2: 62500 });
    expect(presetAdjustDefaults("blockArc")).toEqual({ adj1: 10800000, adj2: 0, adj3: 25000 });
    expect(presetAdjustDefaults("rect")).toEqual({});
    presetAdjustDefaults("roundRect").adj = 5; // a copy, not the table
    expect(presetAdjustDefaults("roundRect").adj).toBe(16667);
  });

  it("honours and clamps adjustment values", () => {
    const w = 200, h = 100;
    // roundRect: the corner is ss * adj; the path starts at (0, r)
    expect(presetPath("roundRect", w, h)[0]!.d.startsWith("M 0 16.667")).toBe(true);
    expect(presetPath("roundRect", w, h, { adj: 30000 })[0]!.d.startsWith("M 0 30")).toBe(true);
    expect(presetPath("roundRect", w, h, { adj: 999999 })[0]!.d.startsWith("M 0 50")).toBe(true);
    expect(presetPath("roundRect", w, h, { adj: -5 })[0]!.d.startsWith("M 0 0")).toBe(true);
    expect(presetPath("roundRect", w, h, { adj: Number.NaN })).toEqual(presetPath("roundRect", w, h));
    // different values make different shapes
    expect(presetPath("rightArrow", w, h, { adj2: 20000 })[0]!.d).not.toBe(presetPath("rightArrow", w, h)[0]!.d);
    expect(presetPath("star5", w, h, { adj: 40000 })[0]!.d).not.toBe(presetPath("star5", w, h)[0]!.d);
    // clamped arrow head never longer than the box
    const long = extent(presetPath("rightArrow", w, h, { adj1: 500000, adj2: 5e9 }));
    expect(long.x0).toBeGreaterThanOrEqual(-0.5);
    expect(long.x1).toBeLessThanOrEqual(w + 0.5);
    // text rect of a rounded rectangle grows with the radius
    expect(presetTextRect("roundRect", w, h, { adj: 50000 }).x).toBeGreaterThan(presetTextRect("roundRect", w, h, { adj: 5000 }).x);
    // callout tip follows the adjustment
    const tipLow = extent(presetPath("wedgeRectCallout", w, h, { adj1: 0, adj2: 150000 }));
    expect(tipLow.y1).toBeCloseTo(h * 2, 0);
    const tipLeft = extent(presetPath("wedgeRectCallout", w, h, { adj1: -90000, adj2: 0 }));
    expect(tipLeft.x0).toBeCloseTo(-w * 0.9 + w / 2, 0);
    // flat shapes survive nonsense sizes
    expect(() => presetPath("roundRect", -5, Number.NaN)).not.toThrow();
  });

  it("splits shapes into painted parts: open arcs are stroke only, holes are even-odd", () => {
    const arc = presetPath("arc", 100, 100);
    expect(arc.some((p) => p.stroke && !p.fill)).toBe(true);
    expect(arc.some((p) => p.fill && !p.stroke)).toBe(true);
    const donut = presetPath("donut", 100, 100);
    expect(donut).toHaveLength(1);
    expect(donut[0]!.evenOdd).toBe(true);
    expect((donut[0]!.d.match(/M/g) ?? []).length).toBe(2);
    expect(presetPath("smileyFace", 100, 100)).toHaveLength(4);
    expect(presetPath("smileyFace", 100, 100).filter((p) => !p.fill)).toHaveLength(1);
    for (const name of ["line", "straightConnector1", "curvedConnector3", "bentConnector3"]) {
      const p = presetPath(name, 100, 50);
      expect(p).toHaveLength(1);
      expect(p[0]!.fill).toBe(false);
      expect(p[0]!.stroke).toBe(true);
    }
    expect(presetPath("cube", 100, 100).some((p) => p.shade === "darkenLess")).toBe(true);
    expect(presetPath("rect", 100, 100)).toEqual([{ d: "M 0 0 L 100 0 L 100 100 L 0 100 Z", fill: true, stroke: true }]);
  });

  it("gives PDF commands that match the SVG path data", () => {
    for (const name of PRESET_GEOMETRIES) {
      for (const [w, h] of [[160, 90], [40, 200]] as const) {
        const svg = presetPath(name, w, h, undefined);
        const pdf = presetPdfPath(name, w, h);
        expect(pdf.length, name).toBe(svg.length);
        svg.forEach((s, i) => {
          const toks = tokenize(s.d);
          const cmds = pdf[i]!.commands;
          expect(cmds.length, name).toBe(toks.length);
          expect(cmds.filter((c) => c[0] === "M").length).toBe(toks.filter((t) => t.cmd === "M").length);
          expect(cmds.map((c) => c[0]).join("")).toBe(toks.map((t) => t.cmd).join(""));
          expect(pdf[i]!.fill).toBe(s.fill);
          expect(pdf[i]!.stroke).toBe(s.stroke);
          expect(pdf[i]!.evenOdd).toBe(!!s.evenOdd);
          cmds.forEach((c, k) => {
            for (let j = 0; j < toks[k]!.nums.length; j++) expect(c[j + 1] as number).toBeCloseTo(toks[k]!.nums[j]!, 2);
          });
        });
      }
    }
  });

  it("gives text rectangles inside the box, inset for ellipses and triangles", () => {
    for (const name of PRESET_GEOMETRIES) {
      for (const [w, h] of [[200, 100], [0, 0], [50, 0]] as const) {
        const r = presetTextRect(name, w, h);
        for (const v of [r.x, r.y, r.w, r.h]) expect(Number.isFinite(v), name).toBe(true);
        expect(r.w, name).toBeGreaterThanOrEqual(0);
        expect(r.h, name).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w, name).toBeLessThanOrEqual(w + 1e-6);
        expect(r.y + r.h, name).toBeLessThanOrEqual(h + 1e-6);
      }
    }
    expect(presetTextRect("rect", 200, 100)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    const e = presetTextRect("ellipse", 200, 100);
    expect(e.x).toBeCloseTo(100 - 100 * Math.SQRT1_2, 3);
    expect(e.y).toBeCloseTo(50 - 50 * Math.SQRT1_2, 3);
    expect(e.w).toBeCloseTo(200 * Math.SQRT1_2, 3);
    const t = presetTextRect("triangle", 200, 100);
    expect(t).toEqual({ x: 50, y: 50, w: 100, h: 50 });
    const d = presetTextRect("diamond", 200, 100);
    expect(d).toEqual({ x: 50, y: 25, w: 100, h: 50 });
    const arrow = presetTextRect("rightArrow", 200, 100);
    expect(arrow.x).toBe(0);
    expect(arrow.w).toBeLessThan(200);
    expect(arrow.h).toBe(50);
    const up = presetTextRect("upArrow", 100, 200);
    expect(up.w).toBe(50);
    expect(up.y).toBeGreaterThan(0);
    expect(up.y + up.h).toBe(200);
  });

  it("draws arcs where the angles say", () => {
    // default blockArc is the upper half of a ring: nothing below the middle
    const e = extent(presetPath("blockArc", 200, 200));
    expect(e.y1).toBeLessThanOrEqual(100.5);
    expect(e.y0).toBeCloseTo(0, 0);
    expect(e.x0).toBeCloseTo(0, 0);
    expect(e.x1).toBeCloseTo(200, 0);
    // pie: 270 degrees, missing the top right quadrant, so the box's right edge is reached only at the middle
    const pie = presetPath("pie", 200, 200)[0]!.d;
    expect(pie.startsWith("M 200 100")).toBe(true);
    // pinned angles wrap rather than breaking
    expect(() => presetPath("pie", 200, 200, { adj1: -1e9, adj2: 1e12 })).not.toThrow();
  });
});
