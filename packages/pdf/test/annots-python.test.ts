// Optional: annotations we write, looked at by qpdf, pypdf and MuPDF. Set PLI_PDF_PYTHON to a python with pikepdf, pypdf, pymupdf.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Users } from "@pli.dev/core";
import { describe, expect, it } from "vitest";
import { openPdf } from "../src";
import { hex, newSession, solidPng } from "./support/annots";

const python = process.env.PLI_PDF_PYTHON;
const script = new URL("../scripts/annotcheck.py", import.meta.url).pathname;
const dir = python ? mkdtempSync(join(tmpdir(), "pli-annots-")) : "";

interface Check {
  qpdf: string[];
  pypdf: { subtype: string; contents: string; rect: number[] }[];
  mupdf: { type: string; rect: number[]; content: string; title: string; vertices: number[][] }[];
  mupdf_links: { uri?: string; page?: number; kind: number }[];
  pixels: number[][];
}

function check(name: string, bytes: Uint8Array, probes: [number, number][] = []): Check {
  const path = join(dir, name + ".pdf");
  writeFileSync(path, bytes);
  return JSON.parse(execFileSync(python!, [script, path, JSON.stringify(probes)], { encoding: "utf8", maxBuffer: 1 << 26 }));
}

const near = (a: number[], b: [number, number, number], tol = 45) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);

describe.skipIf(!python)("annotations seen by independent readers", () => {
  it("every type is a valid annotation that MuPDF paints from our appearance", async () => {
    const s = await newSession();
    const P = "p:main:0";
    s.annots.addHighlight(P, [{ x: 20, y: 30, w: 100, h: 20 }, { x: 20, y: 52, w: 60, h: 20 }], { color: "#ffeb3b", contents: "marked" });
    s.annots.addHighlight(P, [{ x: 140, y: 30, w: 60, h: 20 }], { type: "underline", color: "#0000ff" });
    s.annots.addHighlight(P, [{ x: 140, y: 60, w: 60, h: 20 }], { type: "strikeout", color: "#ff0000" });
    s.annots.addHighlight(P, [{ x: 140, y: 90, w: 60, h: 20 }], { type: "squiggly", color: "#00aa00" });
    s.annots.addInk(P, [[[20, 100], [60, 140], [100, 100]]], { color: "#d50000", width: 5 });
    s.annots.addShape(P, "square", { x: 20, y: 160, w: 60, h: 40 }, { color: "#000000", width: 3, fill: "#ffcc00" });
    s.annots.addShape(P, "circle", { x: 100, y: 160, w: 60, h: 40 }, { color: "#0000ff", width: 3, fill: "#00ff00" });
    s.annots.addLine(P, [20, 220], [120, 220], { color: "#6200ea", width: 3, endEnd: "closed-arrow" });
    s.annots.addPoly(P, [[150, 210], [200, 210], [175, 250]], { color: "#000000", width: 2, fill: "#ff8800" });
    s.annots.addPoly(P, [[210, 210], [240, 230], [210, 250]], { closed: false, color: "#00aa00", width: 3 });
    s.annots.addFreeText(P, { x: 20, y: 260, w: 120, h: 40 }, "Free text", { size: 14, fill: "#ccffcc" });
    s.annots.addNote(P, 250, 20, "a note", { icon: "comment", color: "#ffd600" });
    s.annots.addStamp(P, { x: 160, y: 270, w: 120, h: 40 }, "Approved");
    s.annots.addSignature(P, { x: 20, y: 320, w: 80, h: 40 }, { mode: "draw", strokes: [[[5, 30], [30, 8], [55, 30]]], width: 3, color: "#001a80" });
    s.annots.addImage(P, { x: 120, y: 330, w: 40, h: 40 }, { src: solidPng([255, 0, 0]) });
    s.annots.markRedaction(P, [{ x: 180, y: 330, w: 80, h: 20 }], { fill: "#000000", overlay: "X" });
    s.annots.addLink(P, { x: 20, y: 380, w: 100, h: 15 }, { uri: "https://example.com/z" });
    s.annots.addLink(P, { x: 140, y: 380, w: 100, h: 15 }, { page: P, y: 10 });
    const bytes = await s.save();
    const r = check("all", bytes, [[70, 40], [60, 140], [50, 180], [130, 180], [160, 215], [60, 280], [140, 340], [220, 340], [262, 32]]);
    expect(r.qpdf).toEqual([]);
    expect(r.pypdf.map((a) => a.subtype)).toEqual(["/Highlight", "/Underline", "/StrikeOut", "/Squiggly", "/Ink", "/Square", "/Circle", "/Line", "/Polygon", "/PolyLine", "/FreeText", "/Text", "/Stamp", "/Stamp", "/Stamp", "/Redact", "/Link", "/Link"]);
    expect(r.pypdf[0]).toMatchObject({ contents: "marked", rect: [20, 328, 120, 370] });
    expect(r.mupdf.map((a) => a.type)).toEqual(["Highlight", "Underline", "StrikeOut", "Squiggly", "Ink", "Square", "Circle", "Line", "Polygon", "PolyLine", "FreeText", "Text", "Stamp", "Stamp", "Stamp", "Redact"]);
    expect(r.mupdf[0]).toMatchObject({ content: "marked", title: "Test User" });
    // MuPDF reads our quad points as two quads at the places we meant (its y axis is down).
    const quads = r.mupdf[0]!.vertices;
    expect(quads).toHaveLength(8);
    const xs = quads.map((v) => v[0]!);
    const ys = quads.map((v) => v[1]!);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([20, 120, 30, 72]);
    expect(r.mupdf_links.map((l) => l.uri ?? `page ${l.page}`)).toEqual(["https://example.com/z", "page 0"]);
    // The pixels MuPDF paints: yellow highlight, red ink, shapes, arrow, polygon, free text fill, stamp border, image, note.
    const expected: [number, number, number][] = [hex("#ffeb3b"), [213, 0, 0], hex("#ffcc00"), hex("#00ff00"), hex("#ff8800"), hex("#ccffcc"), [255, 0, 0], [0, 0, 0], hex("#ffd600")];
    r.pixels.forEach((p, i) => {
      if (i === 7) return;
      expect(near(p, expected[i]!), `probe ${i}: ${p} vs ${expected[i]}`).toBe(true);
    });
  });

  it("annotations of a file made by another tool survive a change and stay valid", async () => {
    const bytes = new Uint8Array(readFileSync(new URL("./fixtures/annots-mupdf.pdf", import.meta.url)));
    const s = await openPdf(bytes, { user: { id: "u1", name: "Test User" } });
    const before = check("mupdf-before", bytes);
    const hl = s.doc.pages[0]!.annots[0]!;
    s.annots.restyle(hl.id, { color: "#00ff00" });
    s.annots.addNote("p:main:0", 100, 100, "new note");
    const out = await s.save();
    const after = check("mupdf-after", out);
    expect(after.qpdf).toEqual([]);
    expect(after.mupdf.length).toBe(before.mupdf.length + 1);
    expect(after.mupdf.map((a) => a.type).slice(0, before.mupdf.length)).toEqual(before.mupdf.map((a) => a.type));
    expect(after.mupdf_links).toEqual(before.mupdf_links);
    expect(after.pypdf.at(-1)).toMatchObject({ subtype: "/Text", contents: "new note" });
  });

  it("comment threads: replies are text annotations MuPDF and pypdf list, flattening leaves a valid file", async () => {
    const s = await newSession();
    s.comments.enable({ users: new Users({ id: "u1", name: "Test User" }) });
    const thread = s.comments.addNote("p:main:0", 100, 100, "Question?");
    s.comments.client!.reply(thread.id, "Answer.");
    await new Promise((r) => setTimeout(r, 0));
    const bytes = await s.save();
    const r = check("thread", bytes, [[110, 110]]);
    expect(r.qpdf).toEqual([]);
    expect(r.pypdf.map((a) => [a.subtype, a.contents])).toEqual([["/Text", "Question?"], ["/Text", "Answer."]]);
    const flat = check("thread-flat", await s.save({ flatten: "annotations" }), [[110, 110], [100, 100]]);
    expect(flat.qpdf).toEqual([]);
    expect(flat.pypdf).toEqual([]);
    expect(flat.mupdf).toEqual([]);
    expect(flat.pixels[0]).not.toEqual([255, 255, 255]);
  });
});
