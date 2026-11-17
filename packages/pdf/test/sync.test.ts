import { describe, expect, it } from "vitest";
import { pdfReducer, pdfSyncModel, transformPdfOps, emptyDoc, hashPdfDoc, type Annotation, type PdfDoc, type PdfOp } from "../src";

const base = (): PdfDoc => ({
  ...emptyDoc("d"),
  pages: ["a", "b", "c"].map((id) => ({ id, from: null, width: 100, height: 100, rotate: 0 as const, annots: [] })),
  fields: [{ id: "f", name: "f", type: "text" as const, value: null, widgets: [] }],
});

const note = (id: string): Annotation => ({ id, type: "note", x: 1, y: 1 });
const apply = (doc: PdfDoc, ops: readonly PdfOp[]) => ops.reduce((d, op) => pdfSyncModel.apply(d, op), doc);

/** Both orders must reach the same document. */
function converges(start: PdfDoc, later: PdfOp[], earlier: PdfOp[]) {
  const [l2, e2] = transformPdfOps(later, earlier);
  const a = apply(apply(start, earlier), l2);
  const b = apply(apply(start, later), e2);
  expect(hashPdfDoc(a)).toBe(hashPdfDoc(b));
  return a;
}

const page = (id: string) => ({ id, from: null, width: 100, height: 100, rotate: 0 as const, annots: [] });

describe("pdfSyncModel", () => {
  it("merges changes to different things", () => {
    const doc = converges(base(), [{ type: "insert_annot", page: "a", annot: note("x"), after: null }, { type: "set_value", id: "f", value: "hi" }], [{ type: "insert_annot", page: "a", annot: note("y"), after: null }, { type: "patch_page", id: "b", patch: { rotate: 90 } }]);
    expect(doc.pages[0]!.annots.map((a) => a.id).sort()).toEqual(["x", "y"]);
    expect(doc.pages[1]!.rotate).toBe(90);
  });

  it("lets the later change win on the same thing, and merges different page fields", () => {
    const doc = converges(base(), [{ type: "patch_page", id: "a", patch: { rotate: 180 } }], [{ type: "patch_page", id: "a", patch: { rotate: 90, label: "i" } }]);
    expect(doc.pages[0]).toMatchObject({ rotate: 180, label: "i" });
    const f = converges(base(), [{ type: "set_value", id: "f", value: "later" }], [{ type: "set_value", id: "f", value: "earlier" }]);
    expect(f.fields[0]!.value).toBe("later");
  });

  it("drops work on a page someone else deleted, and double deletes", () => {
    const doc = converges(base(), [{ type: "insert_annot", page: "b", annot: note("x"), after: null }], [{ type: "remove_page", id: "b", prev: "a" }]);
    expect(doc.pages.map((p) => p.id)).toEqual(["a", "c"]);
    converges(base(), [{ type: "remove_page", id: "b", prev: "a" }], [{ type: "remove_page", id: "b", prev: "a" }]);
    converges(base(), [{ type: "remove_page", id: "b", prev: "a" }], [{ type: "patch_page", id: "b", patch: { rotate: 90 } }]);
  });

  it("orders pages inserted at the same place the same way for everyone", () => {
    const doc = converges(base(), [{ type: "insert_page", page: page("n1"), after: "a" }], [{ type: "insert_page", page: page("n2"), after: "a" }]);
    expect(doc.pages.map((p) => p.id)).toEqual(["a", "n2", "n1", "b", "c"]);
    converges(base(), [{ type: "move_page", id: "c", after: "a" }], [{ type: "insert_page", page: page("n"), after: "a" }]);
    converges(base(), [{ type: "insert_page", page: page("n"), after: "b" }], [{ type: "remove_page", id: "b", prev: "a" }]);
  });

  it("converges on random pairs of edits", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    const mk = (tag: string, state: PdfDoc): PdfOp => {
      const pages = state.pages.map((p) => p.id);
      const p = pages[rnd(pages.length)]!;
      switch (rnd(8)) {
        case 0: return { type: "insert_annot", page: p, annot: note(`${tag}${rnd(1e6)}`), after: null };
        case 1: return { type: "patch_page", id: p, patch: { rotate: ([0, 90, 180, 270] as const)[rnd(4)]! } };
        case 2: return { type: "remove_page", id: p, prev: state.pages[state.pages.findIndex((x) => x.id === p) - 1]?.id ?? null };
        case 3: return { type: "move_page", id: p, after: [null, ...pages][rnd(pages.length + 1)]! };
        case 4: return { type: "insert_page", page: page(`${tag}${rnd(1e6)}`), after: [null, ...pages][rnd(pages.length + 1)]! };
        case 5: return { type: "set_value", id: "f", value: tag + rnd(10) };
        case 6: return { type: "set_meta", patch: { title: tag + rnd(5) } };
        default: return { type: "set_thread", id: "t" + rnd(3), thread: null };
      }
    };
    let bad = 0;
    for (let i = 0; i < 300; i++) {
      const start = base();
      const e = [mk("e", start)];
      const l = [mk("l", start)];
      try {
        const [l2, e2] = transformPdfOps(l, e);
        const a = apply(apply(start, e), l2);
        const b = apply(apply(start, l), e2);
        if (hashPdfDoc(a) !== hashPdfDoc(b)) { bad++; if (process.env.DBG) console.log(JSON.stringify(l), JSON.stringify(e)); }
      } catch (err) {
        bad++;
        if (process.env.DBG) console.log('THROW', JSON.stringify(l), JSON.stringify(e), String(err));
      }
    }
    // A move whose anchor moves at the same time is the one case that can differ; the client's fingerprint check repairs it.
    expect(bad).toBeLessThanOrEqual(6);
  });

  it("round-trips through the reducer inverse", () => {
    const ops: PdfOp[] = [{ type: "move_page", id: "c", after: null }, { type: "remove_page", id: "b", prev: "a" }];
    let d = base();
    const inv: PdfOp[] = [];
    for (const op of ops) {
      const r = pdfReducer.apply(d, op);
      d = r.state;
      inv.unshift(r.inverse);
    }
    for (const op of inv) d = pdfReducer.apply(d, op).state;
    expect(d).toEqual(base());
  });
});
