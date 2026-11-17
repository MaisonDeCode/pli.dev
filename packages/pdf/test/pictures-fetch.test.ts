// Pictures given as web addresses are fetched at save and drawn; the session's document is not touched.
import { describe, expect, it } from "vitest";
import { pictureAddresses, resolvePictures } from "../src";
import { newSession, solidPng, expectPixel, WHITE } from "./support/annots";
import { parseDataUri } from "../src/annots/util";
import { renderPdf } from "./support/render";

const PAGE = "p:main:0";
const bytesOf = (uri: string): Uint8Array => parseDataUri(uri)!.bytes;

function fakeFetch(files: Record<string, Uint8Array>) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    const bytes = files[url];
    if (!bytes) throw new Error("HTTP 404");
    return { bytes, mime: "application/octet-stream" };
  };
  return { fetch, calls };
}

describe("pictures that are web addresses", () => {
  it("are fetched and drawn, from a copy of the document", async () => {
    const s = await newSession();
    const red = "https://files.example.test/red.png";
    const blue = "https://files.example.test/blue.png";
    s.annots.addStamp(PAGE, { x: 20, y: 100, w: 40, h: 40 }, { picture: { src: red } });
    s.annots.addImage(PAGE, { x: 120, y: 100, w: 40, h: 40 }, { src: blue });
    s.annots.addSignature(PAGE, { x: 20, y: 200, w: 40, h: 40 }, { mode: "image", picture: { src: red } });
    const { fetch, calls } = fakeFetch({ [red]: bytesOf(solidPng([255, 0, 0])), [blue]: bytesOf(solidPng([0, 0, 255])) });
    const before = s.doc;
    const result = await s.saveDetailed({ fetch });
    expect(result.warnings).toEqual([]);
    expect(calls.sort()).toEqual([blue, red]); // each address once
    expect(s.doc).toBe(before);
    expect(pictureAddresses(s.doc).sort()).toEqual([blue, red]);
    const r = await renderPdf(result.bytes, 0, 2);
    expectPixel(r, 40, 120, [255, 0, 0], 10);
    expectPixel(r, 140, 120, [0, 0, 255], 10);
    expectPixel(r, 40, 220, [255, 0, 0], 10);
    expectPixel(r, 90, 120, WHITE, 5);
  });

  it("keep a placeholder and warn with the address when they cannot be fetched", async () => {
    const s = await newSession();
    const missing = "https://files.example.test/missing.png";
    s.annots.addImage(PAGE, { x: 20, y: 100, w: 40, h: 40 }, { src: missing });
    const { fetch } = fakeFetch({});
    const result = await s.saveDetailed({ fetch });
    expect(result.warnings.some((w) => w.includes(missing) && w.includes("404"))).toBe(true);
    const r = await renderPdf(result.bytes, 0, 2);
    expect(r.inkIn(20, 100, 40, 40)).toBeGreaterThan(0); // the placeholder box
  });

  it("warn when the address is not a PNG or JPEG", async () => {
    const s = await newSession();
    const url = "https://files.example.test/page.html";
    s.annots.addImage(PAGE, { x: 20, y: 100, w: 40, h: 40 }, { src: url });
    const result = await s.saveDetailed({ fetch: fakeFetch({ [url]: new TextEncoder().encode("<html>") }).fetch });
    expect(result.warnings.some((w) => w.includes(url) && w.includes("PNG or JPEG"))).toBe(true);
  });

  it("use globalThis.fetch by default", async () => {
    const s = await newSession();
    const url = "https://files.example.test/green.png";
    s.annots.addImage(PAGE, { x: 20, y: 100, w: 40, h: 40 }, { src: url });
    const real = globalThis.fetch;
    const png = bytesOf(solidPng([0, 160, 0]));
    globalThis.fetch = (async () => new Response(png as never, { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
    try {
      const result = await s.saveDetailed();
      expect(result.warnings).toEqual([]);
      expectPixel(await renderPdf(result.bytes, 0, 2), 40, 120, [0, 160, 0], 10);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("are fetched for picture replacements on the page", async () => {
    const s = await newSession();
    const url = "https://files.example.test/x.png";
    const doc = s.doc;
    const edited = { ...doc, pages: doc.pages.map((p) => ({ ...p, edits: [{ id: "e1", type: "image" as const, target: "none", picture: { src: url } }] })) };
    expect(pictureAddresses(edited)).toEqual([url]);
    const { fetch } = fakeFetch({ [url]: bytesOf(solidPng([1, 2, 3])) });
    const out = await resolvePictures(edited, doc, { fetch });
    const e = out.doc.pages[0]!.edits![0] as { picture: { src: string } };
    expect(e.picture.src.startsWith("data:image/png;base64,")).toBe(true);
    expect(edited.pages[0]!.edits![0]).toMatchObject({ picture: { src: url } });
  });
});
