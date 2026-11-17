import { describe, expect, it } from "vitest";
import { iconSvg, type IconSetName } from "../src";
import { svgPathCommands, svgToPdfItems } from "../src/print-pdf-vector";

const SETS: [IconSetName, number][] = [["3Arrows", 3], ["5ArrowsGray", 5], ["3Flags", 3], ["4TrafficLights", 4], ["3Signs", 3], ["3Symbols", 3], ["3Symbols2", 3], ["5Rating", 5], ["5Quarters", 5], ["3Stars", 3], ["3Triangles", 3], ["5Boxes", 5]];

describe("icons as vectors in the PDF", () => {
  it("turns every icon of every set into paths inside its box", () => {
    for (const [set, count] of SETS) {
      for (let i = 0; i < count; i++) {
        const items = svgToPdfItems(iconSvg(set, i, count, 16), { x: 100, y: 50, width: 10, height: 10 });
        expect(items.length, `${set} ${i}`).toBeGreaterThan(0);
        for (const it of items) {
          if (it.type !== "path") continue;
          for (const c of it.d) for (let k = 1; k < c.length; k += 2) {
            expect(c[k] as number, `${set} ${i} x`).toBeGreaterThan(95);
            expect(c[k] as number, `${set} ${i} x`).toBeLessThan(115);
          }
        }
      }
    }
  });
  it("reads relative and absolute path commands, implicit repeats and arcs", () => {
    expect(svgPathCommands("M1 2 3 4Z")).toEqual([["M", 1, 2], ["L", 3, 4], ["Z"]]);
    expect(svgPathCommands("m1 2 3 4h2v1z")).toEqual([["M", 1, 2], ["L", 4, 6], ["L", 6, 6], ["L", 6, 7], ["Z"]]);
    const arcs = svgPathCommands("M0 0A5 5 0 0 1 10 0");
    expect(arcs[0]).toEqual(["M", 0, 0]);
    expect(arcs.length).toBeGreaterThan(1);
    const last = arcs[arcs.length - 1]!;
    expect(last[0]).toBe("C");
    expect(Math.round(last[5] as number)).toBe(10);
    expect(Math.abs(Math.round(last[6] as number))).toBe(0);
  });
  it("rotates an arrow about its centre and keeps a half star's clip", () => {
    const up = svgToPdfItems(iconSvg("3Arrows", 2, 3, 16), { x: 0, y: 0, width: 16, height: 16 });
    const down = svgToPdfItems(iconSvg("3Arrows", 0, 3, 16), { x: 0, y: 0, width: 16, height: 16 });
    const ys = (items: typeof up) => (items[0] as unknown as { d: [string, number, number][] }).d.map((c) => c[2]);
    expect(Math.min(...ys(up).filter(Boolean))).toBeLessThan(3);
    expect(Math.max(...ys(down).filter(Boolean))).toBeGreaterThan(13);
    const half = svgToPdfItems(iconSvg("3Stars", 1, 3, 16), { x: 0, y: 0, width: 16, height: 16 });
    expect(half.some((i) => i.type === "path" && i.clip && i.clip.width === 8)).toBe(true);
  });
});
