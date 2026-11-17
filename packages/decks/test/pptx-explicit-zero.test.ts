import { describe, expect, it } from "vitest";
import { DeckSession, fromPptx, toPptx } from "../src";
import { sp, simpleDeck, txBody, xfrm } from "./fixtures/build-pptx";

// A text box whose list style sets letter spacing, caps and a raised baseline, with runs that cancel each with an explicit 0 / none.
const lst = `<a:lstStyle><a:lvl1pPr><a:defRPr sz="1100" spc="300" cap="all" baseline="30000"/></a:lvl1pPr></a:lstStyle>`;
const box = (id: number, runAttrs: string) =>
  sp(id, `Box ${id}`, {
    cNvSpPr: ' txBox="1"',
    spPr: `${xfrm(914400, 914400, 2743200, 457200)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>`,
    tx: txBody(`<a:p><a:r><a:rPr lang="en-US" ${runAttrs}/><a:t>Page 7</a:t></a:r></a:p>`, "<a:bodyPr/>", lst),
  });

describe("explicit zero and none on runs", () => {
  const deck = fromPptx(simpleDeck([box(10, 'spc="0" cap="none" baseline="0"') + box(11, "")])).deck;
  const session = new DeckSession(deck);
  const runs = session.scene(deck.slides[0]!.id).elements.filter((e) => e.text && !e.placeholder).map((e) => e.text!.paragraphs[0]!.runs[0]!);

  it("cancel the letter spacing, caps and baseline a list style gives", () => {
    expect(runs[0]).toMatchObject({ letterSpacing: 0, allCaps: false, baseline: 0 });
  });

  it("leave the inherited ones alone when a run says nothing", () => {
    expect(runs[1]).toMatchObject({ letterSpacing: 3, allCaps: true, baseline: 30 });
  });

  it("survive export and import", () => {
    const back = fromPptx(toPptx(deck, { date: new Date(0) })).deck;
    const again = new DeckSession(back).scene(back.slides[0]!.id).elements.filter((e) => e.text && !e.placeholder).map((e) => e.text!.paragraphs[0]!.runs[0]!);
    expect(again[0]).toMatchObject({ letterSpacing: 0, allCaps: false, baseline: 0 });
    expect(again[1]).toMatchObject({ letterSpacing: 3, allCaps: true });
  });
});
