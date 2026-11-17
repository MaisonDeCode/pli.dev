// @vitest-environment jsdom
// Align and distribute: selected annotations, and fields in Prepare form.
import { describe, expect, it } from "vitest";
import { act } from "react";
import { click, key, mount, q, qa, run, useAnnotHost, round } from "./annotHarness";
import * as forms from "./formsHarness";

useAnnotHost();

const P0 = "p:test:0";
const button = (label: string) => q<HTMLButtonElement>(`.pli-pdf-props button[aria-label='${label}']`);

describe("align and distribute annotations", () => {
  async function three() {
    const m = await mount();
    const page = m.session.doc.pages[0]!.id;
    const ids = await run(() => [
      m.session.annots.add(page, { type: "square", rect: { x: 20, y: 30, w: 40, h: 20 }, stroke: { color: "#000000", width: 0 } } as never, { select: false }),
      m.session.annots.add(page, { type: "square", rect: { x: 100, y: 120, w: 60, h: 30 }, stroke: { color: "#000000", width: 0 } } as never, { select: false }),
      m.session.annots.add(page, { type: "square", rect: { x: 300, y: 200, w: 20, h: 50 }, stroke: { color: "#000000", width: 0 } } as never, { select: false }),
    ]);
    const rects = () => m.session.doc.pages[0]!.annots.map((a) => (a.type === "square" ? { x: round(a.rect.x), y: round(a.rect.y), w: a.rect.w, h: a.rect.h } : null));
    return { m, ids, page, rects };
  }

  it("shows the buttons for two or more selected annotations only, and Distribute needs three", async () => {
    const { m, ids } = await three();
    await run(() => m.c().select([ids[0]!]));
    expect(qa(".pli-pdf-arrange")).toHaveLength(0);
    await run(() => m.c().select([ids[0]!, ids[1]!]));
    expect(qa(".pli-pdf-arrange")).toHaveLength(1);
    expect(button("Align left").disabled).toBe(false);
    expect(button("Distribute horizontally").disabled).toBe(true);
    await run(() => m.c().select(ids));
    expect(button("Distribute horizontally").disabled).toBe(false);
  });

  it("aligns to the box round the selection, in one undo step", async () => {
    const { m, ids, rects } = await three();
    await run(() => m.c().select(ids));
    await click(button("Align left"));
    expect(rects().map((r) => r!.x)).toEqual([20, 20, 20]);
    expect(rects().map((r) => r!.y)).toEqual([30, 120, 200]); // only along x
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(rects().map((r) => r!.x)).toEqual([20, 100, 300]);
    await click(button("Align right"));
    expect(rects().map((r) => r!.x + r!.w)).toEqual([320, 320, 320]);
    await click(button("Align centre"));
    expect(rects().map((r) => r!.x + r!.w / 2)).toEqual([290, 290, 290]);
    await click(button("Align top"));
    expect(rects().map((r) => r!.y)).toEqual([30, 30, 30]);
    await click(button("Align bottom"));
    expect(rects().map((r) => r!.y + r!.h)).toEqual([80, 80, 80]);
    await click(button("Align middle"));
    expect(rects().map((r) => r!.y + r!.h / 2)).toEqual([55, 55, 55]);
    expect(m.c().live).toContain("Align middle");
  });

  it("distributes with equal gaps and keeps the outer two", async () => {
    const { m, ids, rects } = await three();
    await run(() => m.c().select(ids));
    await click(button("Distribute horizontally"));
    const r = rects() as { x: number; y: number; w: number; h: number }[];
    expect(r[0]!.x).toBe(20);
    expect(r[2]!.x).toBe(300);
    expect(round(r[1]!.x - (r[0]!.x + r[0]!.w))).toBe(round(r[2]!.x - (r[1]!.x + r[1]!.w)));
    await click(button("Distribute vertically"));
    const v = rects() as { x: number; y: number; w: number; h: number }[];
    expect(round(v[1]!.y - (v[0]!.y + v[0]!.h))).toBe(round(v[2]!.y - (v[1]!.y + v[1]!.h)));
    expect(v[0]!.y).toBe(30);
    expect(v[2]!.y).toBe(200);
  });

  it("leaves locked annotations and text markup where they are", async () => {
    const { m, ids, rects, page } = await three();
    await run(() => m.c().setLocked([ids[1]!], true));
    const hl = await run(() => m.session.annots.addHighlight(page, [{ x: 200, y: 400, w: 50, h: 12 }]));
    await run(() => m.c().select([...ids, hl]));
    await click(button("Align left"));
    expect(rects().slice(0, 3).map((r) => r!.x)).toEqual([20, 100, 20]); // the locked one stayed
    expect(m.session.doc.pages[0]!.annots.find((a) => a.id === hl)).toMatchObject({ rects: [{ x: 200, y: 400, w: 50, h: 12 }] });
  });

  it("is not offered when the viewer cannot edit", async () => {
    const m = await mount({ kit: { readOnly: true } });
    expect(qa(".pli-pdf-arrange")).toHaveLength(0);
    expect(m.session.doc.pages.length).toBeGreaterThan(0);
  });
});

describe("align and distribute form fields in Prepare form", () => {
  const frame = (name: string) => document.querySelector<HTMLElement>(`.pli-form-design[data-field-id="${"f:" + name}"]`)!;
  async function prepare() {
    const m = await forms.mount();
    await forms.togglePrepareForm();
    return m;
  }
  const clickWidget = async (name: string, shift: boolean, ctrl = false) => {
    const el = frame(name);
    await act(async () => {
      el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, shiftKey: shift, ctrlKey: ctrl, clientX: 10, clientY: 10 }));
      el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, shiftKey: shift, ctrlKey: ctrl, clientX: 10, clientY: 10 }));
    });
  };
  const fbutton = (label: string) => forms.q<HTMLButtonElement>(`.pli-form-props button[aria-label='${label}']`);
  const rect = (m: forms.Mounted, name: string) => forms.rectOf(m.session, name);

  it("selects several with Shift or Ctrl click, shows no handles, and takes one out again", async () => {
    const m = await prepare();
    await clickWidget("name", false);
    await clickWidget("colour", true);
    await clickWidget("sig", false, true);
    expect(m.c().selectedIds).toHaveLength(3);
    expect(forms.qa(".pli-form-design[data-selected]")).toHaveLength(3);
    expect(forms.qa(".pli-form-handle")).toHaveLength(0);
    expect(forms.q(".pli-form-props").getAttribute("aria-label")).toBe("Selected fields");
    expect(forms.q(".pli-form-props").textContent).toContain("3 fields");
    await clickWidget("colour", true);
    expect(m.c().selectedIds).toHaveLength(2);
    // a plain click goes back to one field, with its properties
    await clickWidget("sig", false);
    expect(m.c().selectedIds).toHaveLength(1);
    expect(forms.q(".pli-form-props").getAttribute("aria-label")).toBe("sig properties");
  });

  it("aligns the selected fields in one undo step", async () => {
    const m = await prepare();
    for (const [n, shift] of [["name", false], ["colour", true], ["send", true]] as const) await clickWidget(n, shift);
    await forms.click(fbutton("Align right"));
    expect(rect(m, "name").x + rect(m, "name").w).toBe(280);
    expect(rect(m, "colour").x + rect(m, "colour").w).toBe(280);
    expect(rect(m, "send").x + rect(m, "send").w).toBe(280);
    expect(rect(m, "colour").y).toBe(200); // not along y
    await forms.key(forms.q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(rect(m, "colour")).toMatchObject({ x: 80, y: 200 });
    expect(rect(m, "send")).toMatchObject({ x: 80, y: 350 });
    expect(rect(m, "name")).toMatchObject({ x: 80, y: 50 });
  });

  it("distributes the selected fields down the page", async () => {
    const m = await prepare();
    for (const [n, shift] of [["name", false], ["colour", true], ["sig", true]] as const) await clickWidget(n, shift);
    await forms.click(fbutton("Distribute vertically"));
    expect(rect(m, "name").y).toBe(50);
    expect(rect(m, "sig").y).toBe(300);
    expect(rect(m, "colour").y).toBe(175); // gaps of 105 between 50..70, 175..195 and 300..330
    expect(rect(m, "colour").x).toBe(80);
  });

  it("Distribute needs three fields; arrow keys and Delete act on all of the selection", async () => {
    const m = await prepare();
    await clickWidget("name", false);
    await clickWidget("sig", true);
    expect(fbutton("Distribute vertically").disabled).toBe(true);
    expect(fbutton("Align left").disabled).toBe(false);
    await forms.press(frame("name"), "ArrowDown", { shiftKey: true });
    expect(rect(m, "name").y).toBe(60);
    expect(rect(m, "sig").y).toBe(310);
    await forms.press(frame("name"), "Delete");
    expect(m.session.forms.byName("name")).toBeUndefined();
    expect(m.session.forms.byName("sig")).toBeUndefined();
    await forms.key(forms.q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(m.session.forms.byName("name")).toBeDefined();
    expect(m.session.forms.byName("sig")).toBeDefined();
  });

  it("works on the fields of the page of the first one", async () => {
    const m = await prepare();
    await clickWidget("name", false);
    await clickWidget("send", true);
    expect(m.c().arrangeable()).toHaveLength(2);
  });
});
