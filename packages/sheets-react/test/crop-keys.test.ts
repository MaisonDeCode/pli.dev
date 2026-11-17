import { describe, expect, it } from "vitest";
import { cropSideOf, cropWords, nudgeCrop, panCrop } from "../src/cropKeys";

const box = { left: 100, top: 40, w: 100, h: 50 };

describe("the arithmetic of cropping with the arrow keys", () => {
  it("cuts a side by the pixels it is given and keeps the opposite edge where it is", () => {
    const left = nudgeCrop(box, undefined, "left", 10)!;
    expect(left.crop.left).toBeCloseTo(0.1, 6);
    expect(left.box).toEqual({ left: 110, top: 40, w: 90, h: 50 });
    expect(left.side).toBe("left");
    const right = nudgeCrop(box, undefined, "right", 10)!;
    expect(right.box.left).toBe(100);
    expect(right.box.w).toBe(90);
    const top = nudgeCrop(box, undefined, "top", 5)!;
    expect(top.box).toEqual({ left: 100, top: expect.closeTo(45, 6), w: 100, h: expect.closeTo(45, 6) });
    const bottom = nudgeCrop(box, undefined, "bottom", 5)!;
    expect(bottom.box.top).toBe(40);
  });

  it("keeps the picture's scale through repeated cuts and gives back what was cut", () => {
    let b = box;
    let crop = undefined as ReturnType<typeof nudgeCrop> extends infer R ? (R extends { crop: infer C } ? C : undefined) : never | undefined;
    for (let i = 0; i < 3; i++) {
      const n = nudgeCrop(b, crop, "left", 10)!;
      b = n.box;
      crop = n.crop;
    }
    expect(b.w).toBeCloseTo(70, 6);
    expect(crop!.left).toBeCloseTo(0.3, 6);
    const back = nudgeCrop(b, crop, "left", -30)!;
    expect(back.box.w).toBeCloseTo(100, 6);
    expect(back.box.left).toBeCloseTo(100, 6);
    expect(back.crop.left).toBeCloseTo(0, 6);
  });

  it("is null when nothing can change: nothing to give back, or less than 5% or 8 pixels would be left", () => {
    expect(nudgeCrop(box, undefined, "left", -10)).toBeNull();
    expect(nudgeCrop({ ...box, w: 5 }, { left: 0.9 }, "right", 1)).toBeNull();
    expect(nudgeCrop({ left: 0, top: 0, w: 10, h: 10 }, undefined, "left", 5)).toBeNull();
    // The cut stops where 5% of the picture is left: of a picture 600 pixels wide, 30.
    const big = nudgeCrop({ left: 0, top: 0, w: 60, h: 50 }, { left: 0.9 }, "right", 400)!;
    expect(big.crop.right).toBeCloseTo(0.05, 6);
    expect(big.box.w).toBeCloseTo(30, 6);
    const some = nudgeCrop({ left: 0, top: 0, w: 300, h: 50 }, { left: 0.7 }, "right", 400)!;
    expect(some.crop.right).toBeCloseTo(0.25, 6);
  });

  it("names the side of a mirrored picture that is on the screen's side", () => {
    expect(cropSideOf("left", { h: true })).toBe("right");
    expect(cropSideOf("right", { h: true })).toBe("left");
    expect(cropSideOf("top", { h: true })).toBe("top");
    expect(cropSideOf("top", { v: true })).toBe("bottom");
    const n = nudgeCrop(box, undefined, "left", 10, { h: true })!;
    expect(n.side).toBe("right");
    expect(n.box.left).toBeCloseTo(110, 6); // the frame's left edge still moves in: the screen's left edge was cut
  });

  it("slides the picture under the frame, within what was cut", () => {
    const c = { left: 0.25, right: 0.25 };
    const slid = panCrop({ ...box, w: 50 }, c, 10, 0)!;
    expect(slid.left).toBeCloseTo(0.15, 6);
    expect(slid.right).toBeCloseTo(0.35, 6);
    expect(panCrop({ ...box, w: 50 }, c, 1000, 0)!.left).toBeCloseTo(0, 6);
    expect(panCrop({ ...box, w: 50 }, { left: 0.25, right: 0.25 }, 0, 10)).toBeNull(); // nothing cut top or bottom
    expect(panCrop({ ...box, w: 50 }, c, 10, 0, { h: true })!.left).toBeCloseTo(0.35, 6);
  });

  it("says in words how much is cut off each side and how big the picture is", () => {
    expect(cropWords({ left: 0.1, bottom: 0.255 }, { ...box, w: 90.4 })).toBe("Cut off: left 10 percent, top 0 percent, right 0 percent, bottom 25.5 percent. The picture is 90 by 50 pixels.");
  });
});
