import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  SYSTEM_FONTS,
  createFonts,
  fontFileFormat,
  fontStack,
  fontsourceCdn,
  fontsourceNpm,
  googleFonts,
  inUnicodeRange,
  lookupFont,
  nearestWeight,
  officeHint,
  officeSubstitute,
  parseFontFaceCss,
  staticSource,
  toTrueType,
  widthFactor,
  woffToSfnt,
  type FontEnv,
  type FontFaceSpec,
  type FontSource,
} from "../src";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(join(here, "fixtures/fonts", name)));

/** An environment that records what is asked of it. */
function fakeEnv(opts: { installed?: string[]; fail?: boolean; delay?: number } = {}) {
  const registered: FontFaceSpec[] = [];
  const loads: { font: string; text: string }[] = [];
  const listeners = new Set<() => void>();
  const env: FontEnv = {
    canLoad: true,
    register: (spec) => void registered.push(spec),
    load: async (font, text) => {
      loads.push({ font, text });
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      return !opts.fail;
    },
    isInstalled: (family) => (opts.installed ?? []).includes(family),
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
  };
  return { env, registered, loads, fire: () => listeners.forEach((l) => l()) };
}

describe("the catalogue", () => {
  it("has the Office fonts and a few thousand Google families, most popular first", () => {
    const google = googleFonts();
    expect(google.length).toBeGreaterThan(1500);
    expect(google[0]!.family).toBe("Roboto");
    expect(new Set(google.map((f) => f.family)).size).toBe(google.length);
    expect(SYSTEM_FONTS.map((f) => f.family)).toEqual(expect.arrayContaining(["Arial", "Calibri", "Cambria", "Georgia", "Times New Roman", "Courier New", "Verdana"]));
    for (const f of google) {
      expect(f.weights.length).toBeGreaterThan(0);
      expect(["sans-serif", "serif", "monospace", "display", "handwriting"]).toContain(f.category);
      expect(f.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("keeps the twelve fonts the pickers had, so old documents still find them", () => {
    for (const name of ["Arial", "Calibri", "Cambria", "Comic Sans MS", "Courier New", "Garamond", "Georgia", "Impact", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"]) {
      expect(lookupFont(name)?.origin, name).toBe("system");
    }
  });

  it("finds families by any case, quotes and the older names files use", () => {
    expect(lookupFont("  lora ")?.family).toBe("Lora");
    expect(lookupFont('"Open Sans"')?.family).toBe("Open Sans");
    expect(lookupFont("ArialMT")?.family).toBe("Arial");
    expect(lookupFont("TimesNewRomanPSMT")?.family).toBe("Times New Roman");
    expect(lookupFont("Calibri (Body)")?.family).toBe("Calibri");
    expect(lookupFont("No Such Font Anywhere")).toBeUndefined();
  });

  it("keeps a system font when a Google family has the same name", () => {
    expect(lookupFont("Arial")?.origin).toBe("system");
  });
});

describe("stacks and estimates", () => {
  it("always ends with a generic family, and puts the metric-compatible twin after an Office font", () => {
    expect(fontStack("Calibri")).toMatch(/^Calibri, Carlito, .*sans-serif$/);
    expect(fontStack("Georgia")).toMatch(/^Georgia, Gelasio, .*serif$/);
    expect(fontStack("Lora")).toBe("Lora, serif");
    expect(fontStack("JetBrains Mono")).toBe('"JetBrains Mono", monospace');
    expect(fontStack("Totally Unknown Script")).toBe('"Totally Unknown Script", cursive'.replace("cursive", "cursive"));
    expect(fontStack("Mystery Mono")).toMatch(/monospace$/);
    expect(fontStack("Lora", ["Georgia"])).toBe("Lora, Georgia, serif");
  });

  it("never lets a quote in a name break out of the CSS value", () => {
    expect(fontStack('Evil"; color: red; "')).not.toContain('"; color');
  });

  it("estimates widths by category and name until the real font is there", () => {
    expect(widthFactor("Arial")).toBe(1);
    expect(widthFactor("Lora")).toBeLessThan(1);
    expect(widthFactor("Roboto Condensed")).toBeLessThan(0.9);
    expect(widthFactor("Archivo Expanded")).toBeGreaterThan(1.1);
  });

  it("works out the nearest weight as CSS does", () => {
    expect(nearestWeight([400, 700], 400)).toBe(400);
    expect(nearestWeight([300, 700], 400)).toBe(300);
    expect(nearestWeight([400, 700], 500)).toBe(400);
    expect(nearestWeight([400, 700], 600)).toBe(700);
    expect(nearestWeight([100, 400], 900)).toBe(400);
    expect(nearestWeight([], 600)).toBe(600);
  });
});

describe("Office hints", () => {
  it("tells Office what kind of font a name is, so a computer without it picks a similar one", () => {
    expect(officeHint("Lora")).toMatchObject({ docxFamily: "roman", xlsxFamily: 1, pptxPitchFamily: 18 });
    expect(officeHint("Roboto")).toMatchObject({ docxFamily: "swiss", xlsxFamily: 2, pptxPitchFamily: 34 });
    expect(officeHint("Roboto Mono")).toMatchObject({ docxFamily: "modern", docxPitch: "fixed", xlsxFamily: 3, pptxPitchFamily: 49 });
    expect(officeHint("Pacifico")).toMatchObject({ docxFamily: "script", xlsxFamily: 4 });
    expect(officeHint("Bungee")).toMatchObject({ docxFamily: "decorative", xlsxFamily: 5 });
  });

  it("maps a font Office doesn't have to one it does", () => {
    expect(officeSubstitute("Arial")).toBe("Arial");
    expect(officeSubstitute("Carlito")).toBe("Calibri");
    expect(officeSubstitute("Lora")).toBe("Georgia");
    expect(officeSubstitute("Roboto Mono")).toBe("Consolas");
    expect(officeSubstitute("Some Unknown Face")).toBe("Arial");
    expect(officeSubstitute("Unknown Mono Face")).toBe("Courier New");
  });
});

describe("unicode ranges and CSS", () => {
  it("tests a code point against a unicode-range", () => {
    const latin = "U+0000-00FF,U+0131,U+0152-0153,U+2000-206F";
    expect(inUnicodeRange(latin, 0x41)).toBe(true);
    expect(inUnicodeRange(latin, 0x131)).toBe(true);
    expect(inUnicodeRange(latin, 0x2014)).toBe(true);
    expect(inUnicodeRange(latin, 0x416)).toBe(false);
    expect(inUnicodeRange("U+04??", 0x416)).toBe(true);
  });

  it("reads @font-face rules", () => {
    const faces = parseFontFaceCss(`
      /* latin */
      @font-face { font-family: 'Lora'; font-style: italic; font-weight: 700; src: url(https://fonts.gstatic.com/s/lora/a.woff2) format('woff2'); unicode-range: U+0000-00FF; }
      @font-face { font-family: "Lora"; font-style: normal; font-weight: 400; src: url("/b.ttf"); }`);
    expect(faces).toEqual([
      { family: "Lora", weight: 700, style: "italic", url: "https://fonts.gstatic.com/s/lora/a.woff2", format: "woff2", unicodeRange: "U+0000-00FF" },
      { family: "Lora", weight: 400, style: "normal", url: "/b.ttf", format: "truetype" },
    ]);
  });
});

describe("sources", () => {
  const lora = lookupFont("Lora")!;

  it("lays out Fontsource CDN and npm files, a face per script with its range", async () => {
    const cdn = await fontsourceCdn({ version: "5.3.0" }).faces(lora, { weight: 400, style: "normal" });
    expect(cdn.length).toBeGreaterThanOrEqual(2);
    const latin = cdn.find((f) => f.subset === "latin")!;
    expect(latin.url).toBe("https://cdn.jsdelivr.net/fontsource/fonts/lora@5.3.0/latin-400-normal.woff2");
    expect(latin.unicodeRange).toMatch(/^U\+0000-00FF/);
    expect(cdn.every((f) => f.family === "Lora" && f.weight === 400)).toBe(true);
    const npm = await fontsourceNpm({ base: "/fonts/" }).faces(lora, { weight: 700, style: "italic" });
    expect(npm[0]!.url).toBe(`/fonts/lora-${npm[0]!.subset}-700-italic.woff2`);
  });

  it("uses the nearest weight and slants a family without italics instead of asking for files it hasn't", async () => {
    const jp = lookupFont("Lato")!;
    const faces = await fontsourceNpm({ base: "/f" }).faces(jp, { weight: 500, style: "italic" });
    expect(faces.every((f) => f.weight === 400)).toBe(true);
    const upright = lookupFont("Oswald")!;
    const normal = await fontsourceNpm({ base: "/f" }).faces(upright, { weight: 400, style: "italic" });
    expect(normal.every((f) => f.style === "normal")).toBe(true);
  });

  it("asks for the slices of a Japanese family from the API", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ unicodeRange: { "[0]": "U+3000-3003", "[1]": "U+4e00-4e10", latin: "U+0000" } }), arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" }));
    const jp = lookupFont("Noto Sans JP")!;
    const faces = await fontsourceCdn({ fetch }).faces(jp, { weight: 400, style: "normal" });
    expect(fetch).toHaveBeenCalledWith("https://api.fontsource.org/v1/fonts/noto-sans-jp");
    expect(faces.filter((f) => f.url.includes("/0-400-normal")).length).toBe(1);
    expect(faces.find((f) => f.url.includes("/1-400-normal"))?.unicodeRange).toBe("U+4e00-4e10");
  });

  it("serves a host's own families", async () => {
    const source = staticSource({ "Acme Sans": [{ weight: 400, url: "/a-400.woff2" }, { weight: 700, url: "/a-700.woff" }, { weight: 400, style: "italic", url: "/a-400i.ttf" }] });
    const acme = { family: "Acme Sans", category: "sans-serif" as const, origin: "custom" as const, weights: [400, 700], italic: true, subsets: [], fallbacks: [] };
    expect(await source.faces(acme, { weight: 600, style: "normal" })).toEqual([{ family: "Acme Sans", weight: 700, style: "normal", url: "/a-700.woff", format: "woff" }]);
    expect((await source.faces(acme, { weight: 400, style: "italic" }))[0]).toMatchObject({ style: "italic", format: "truetype" });
  });
});

describe("the registry", () => {
  it("offers system fonts first and Google by popularity, and can be restricted", () => {
    const all = createFonts({ env: fakeEnv().env, storage: null });
    expect(all.list()[0]!.origin).toBe("system");
    expect(all.list().length).toBeGreaterThan(1500);
    const few = createFonts({ env: fakeEnv().env, storage: null, only: ["Lora", "arial", "Nope"] });
    expect(few.list().map((f) => f.family)).toEqual(["Lora", "Arial"]);
    expect(few.offers("Georgia")).toBe(false);
    expect(few.find("Georgia")?.family).toBe("Georgia"); // an old document's font still resolves
    const offline = createFonts({ env: fakeEnv().env, storage: null, noGoogle: true });
    expect(offline.list().every((f) => f.origin === "system")).toBe(true);
    const serifOnly = createFonts({ env: fakeEnv().env, storage: null, only: (f) => f.category === "monospace" && f.origin === "google" });
    expect(serifOnly.list().every((f) => f.category === "monospace")).toBe(true);
  });

  it("adds a host's own families on top", () => {
    const fonts = createFonts({
      env: fakeEnv().env,
      storage: null,
      extra: [{ family: "Acme Sans", category: "sans-serif", origin: "custom", weights: [400], italic: false, subsets: [], fallbacks: ["Arial"] }],
    });
    expect(fonts.list()[0]!.family).toBe("Acme Sans");
    expect(fonts.stack("Acme Sans")).toBe('"Acme Sans", Arial, sans-serif');
  });

  it("searches by name, category and script", () => {
    const fonts = createFonts({ env: fakeEnv().env, storage: null });
    expect(fonts.search({ query: "roboto" }).every((f) => /roboto/i.test(f.family))).toBe(true);
    expect(fonts.search({ category: "monospace" }).every((f) => f.category === "monospace")).toBe(true);
    const cyr = fonts.search({ subset: "cyrillic", category: "serif" });
    expect(cyr.length).toBeGreaterThan(5);
    expect(cyr.every((f) => f.origin === "system" || f.subsets.includes("cyrillic"))).toBe(true);
    expect(fonts.search({ query: "zzzzzz" })).toEqual([]);
  });

  it("loads a family when asked, with its scripts as faces and only the text's characters fetched", async () => {
    const { env, registered, loads } = fakeEnv();
    const fonts = createFonts({ env, storage: null, source: fontsourceNpm({ base: "/f" }) });
    expect(fonts.status("Lora")).toBe("idle");
    const done = fonts.load("Lora", { weight: 700, text: "Привет" });
    expect(fonts.status("Lora")).toBe("loading");
    expect(await done).toBe("ready");
    expect(fonts.status("lora")).toBe("ready");
    expect(registered.some((r) => r.subset === "cyrillic" && r.weight === 700)).toBe(true);
    expect(loads[0]).toEqual({ font: '700 16px "Lora"', text: "Привет" });
    // Asking again for what is in costs no new files, but a new weight does.
    const before = registered.length;
    await fonts.load("Lora", { weight: 700 });
    expect(registered.length).toBe(before);
    await fonts.load("Lora", { weight: 400 });
    expect(registered.length).toBeGreaterThan(before);
  });

  it("tells listeners when a font changes, so text is measured again", async () => {
    const { env, fire } = fakeEnv();
    const fonts = createFonts({ env, storage: null, source: fontsourceNpm({ base: "/f" }) });
    const seen: number[] = [];
    const stop = fonts.subscribe(() => seen.push(fonts.version()));
    await fonts.load("Lora");
    expect(seen.length).toBeGreaterThanOrEqual(2); // loading, then ready
    const n = seen.length;
    fire(); // the page finished loading some file
    expect(seen.length).toBe(n + 1);
    stop();
    fire();
    expect(seen.length).toBe(n + 1);
  });

  it("fails softly: the stack still has fallbacks, status says failed, and nothing throws", async () => {
    const { env } = fakeEnv({ fail: true });
    const fonts = createFonts({ env, storage: null, source: fontsourceNpm({ base: "/f" }) });
    expect(await fonts.load("Lora")).toBe("failed");
    expect(fonts.status("Lora")).toBe("failed");
    expect(fonts.stack("Lora")).toBe("Lora, serif");
    const broken: FontSource = { name: "broken", faces: () => Promise.reject(new Error("offline")) };
    const f2 = createFonts({ env: fakeEnv().env, storage: null, source: broken });
    expect(await f2.load("Lato")).toBe("failed");
    const empty: FontSource = { name: "empty", faces: () => [] };
    expect(await createFonts({ env: fakeEnv().env, storage: null, source: empty }).load("Lato")).toBe("failed");
  });

  it("gives up on a slow font after the timeout, then turns ready when the file arrives", async () => {
    const { env } = fakeEnv({ delay: 60 });
    const fonts = createFonts({ env, storage: null, source: fontsourceNpm({ base: "/f" }), timeoutMs: 10 });
    expect(await fonts.load("Lora")).toBe("failed");
    await new Promise((r) => setTimeout(r, 120));
    expect(fonts.status("Lora")).toBe("ready");
  });

  it("can be tried again after a failure", async () => {
    let attempts = 0;
    const flaky: FontSource = { name: "flaky", faces: (f, w) => (++attempts === 1 ? Promise.reject(new Error("x")) : fontsourceNpm({ base: "/f" }).faces(f, w)) };
    const fonts = createFonts({ env: fakeEnv().env, storage: null, source: flaky });
    expect(await fonts.load("Lora")).toBe("failed");
    expect(await fonts.load("Lora")).toBe("ready");
  });

  it("loads nothing without a source or a browser, and reports it", async () => {
    const offline = createFonts({ env: fakeEnv().env, storage: null, source: null });
    expect(await offline.load("Lora")).toBe("idle");
    expect(await offline.load("Georgia")).toBe("system");
    expect(await offline.load("Not In The Catalogue")).toBe("unknown");
    const noBrowser = createFonts({ storage: null }); // Node: no document
    expect(await noBrowser.load("Lora")).toBe("idle");
    expect(noBrowser.status("Arial")).toBe("system");
  });

  it("loads the open twin of an Office font that isn't installed, and nothing when it is", async () => {
    const missing = fakeEnv({ installed: [] });
    const a = createFonts({ env: missing.env, storage: null, source: fontsourceNpm({ base: "/f" }) });
    expect(a.status("Calibri")).toBe("idle");
    expect(await a.load("Calibri")).toBe("ready");
    expect(missing.registered.every((r) => r.family === "Carlito")).toBe(true);
    const present = fakeEnv({ installed: ["Calibri"] });
    const b = createFonts({ env: present.env, storage: null, source: fontsourceNpm({ base: "/f" }) });
    expect(b.status("Calibri")).toBe("system");
    expect(await b.load("Calibri")).toBe("system");
    expect(present.registered).toEqual([]);
    const off = fakeEnv();
    const c = createFonts({ env: off.env, storage: null, source: fontsourceNpm({ base: "/f" }), substituteOffice: false });
    expect(await c.load("Calibri")).toBe("system");
    expect(off.registered).toEqual([]);
  });

  it("remembers recently used families", () => {
    const store = new Map<string, string>();
    const storage = { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => void store.set(k, v) };
    const fonts = createFonts({ env: fakeEnv().env, storage });
    fonts.use("Lora");
    fonts.use("arial");
    fonts.use("Lora");
    fonts.use("Not A Font");
    expect(fonts.recent()).toEqual(["Lora", "Arial"]);
    expect(createFonts({ env: fakeEnv().env, storage }).recent()).toEqual(["Lora", "Arial"]);
    for (const n of ["Roboto", "Lato", "Oswald", "Poppins", "Inter", "Raleway", "Merriweather", "Nunito"]) fonts.use(n);
    expect(fonts.recent()).toHaveLength(8);
    expect(createFonts({ env: fakeEnv().env, storage: { get: () => "not json", set: () => undefined } }).recent()).toEqual([]);
  });
});

describe("font files", () => {
  it("recognises formats", () => {
    expect(fontFileFormat(fixture("lora-latin-400-normal.ttf"))).toBe("ttf");
    expect(fontFileFormat(fixture("lora-latin-400-normal.woff"))).toBe("woff");
    expect(fontFileFormat(fixture("lora-latin-400-normal.woff2"))).toBe("woff2");
    expect(fontFileFormat(new Uint8Array([1, 2, 3, 4, 5]))).toBe("unknown");
  });

  /** Packs a TrueType file as WOFF 1 the way the format says: each table zlib-compressed when that is smaller. */
  const makeWoff = (ttf: Uint8Array): Uint8Array => {
    const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const n = v.getUint16(4);
    const recs = Array.from({ length: n }, (_, i) => {
      const at = 12 + i * 16;
      const data = ttf.subarray(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12));
      const packed = deflateSync(data);
      return { tag: ttf.subarray(at, at + 4), checksum: v.getUint32(at + 4), orig: data.length, data: packed.length < data.length ? packed : data };
    });
    let offset = 44 + 20 * n;
    const parts: Buffer[] = [];
    const head = Buffer.alloc(44 + 20 * n);
    head.write("wOFF", 0, "latin1");
    head.writeUInt32BE(v.getUint32(0), 4);
    head.writeUInt16BE(n, 12);
    recs.forEach((r, i) => {
      const at = 44 + i * 20;
      head.set(r.tag, at);
      head.writeUInt32BE(offset, at + 4);
      head.writeUInt32BE(r.data.length, at + 8);
      head.writeUInt32BE(r.orig, at + 12);
      head.writeUInt32BE(r.checksum, at + 16);
      const padded = Buffer.alloc((r.data.length + 3) & ~3);
      padded.set(r.data);
      parts.push(padded);
      offset += padded.length;
    });
    head.writeUInt32BE(offset, 8);
    return new Uint8Array(Buffer.concat([head, ...parts]));
  };

  it("turns WOFF into the TrueType it holds, table for table", async () => {
    const ttf = fixture("lora-latin-400-normal.ttf");
    const woff = makeWoff(ttf);
    expect(fontFileFormat(woff)).toBe("woff");
    expect(woff.length).toBeLessThan(ttf.length);
    const out = await woffToSfnt(woff);
    expect(fontFileFormat(out)).toBe("ttf");
    const tables = (b: Uint8Array) => {
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const n = v.getUint16(4);
      const map = new Map<string, Uint8Array>();
      for (let i = 0; i < n; i++) {
        const at = 12 + i * 16;
        const tag = String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
        map.set(tag, b.subarray(v.getUint32(at + 8), v.getUint32(at + 8) + v.getUint32(at + 12)));
      }
      return map;
    };
    const want = tables(ttf);
    const got = tables(out);
    expect([...got.keys()].sort()).toEqual([...want.keys()].sort());
    for (const [tag, bytes] of want) expect(Buffer.from(got.get(tag)!).equals(Buffer.from(bytes)), tag).toBe(true);
  });

  it("converts the WOFF a CDN serves, into a font the PDF writer can read", async () => {
    const out = await woffToSfnt(fixture("lora-latin-400-normal.woff"));
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    expect(view.getUint32(0)).toBe(0x00010000);
    expect(view.getUint16(4)).toBeGreaterThan(8);
  });

  it("leaves TrueType alone and refuses what it can't unpack", async () => {
    const ttf = fixture("lora-latin-400-normal.ttf");
    expect(await toTrueType(ttf)).toBe(ttf);
    expect(await toTrueType(fixture("lora-latin-400-normal.woff2"))).toBeNull();
    expect(await toTrueType(new Uint8Array(10))).toBeNull();
  });
});

describe("fonts for PDF", () => {
  const lora = fixture("lora-latin-400-normal.woff");
  const bytesFetch = (map: Record<string, Uint8Array | null>) => async (url: string) => {
    const hit = map[url];
    return { ok: !!hit, status: hit ? 200 : 404, arrayBuffer: async () => (hit ?? new Uint8Array()).buffer.slice(hit?.byteOffset ?? 0, (hit?.byteOffset ?? 0) + (hit?.byteLength ?? 0)) as ArrayBuffer, json: async () => ({}), text: async () => "" };
  };

  it("fetches a family's files under the names the PDF writer looks for, converting WOFF", async () => {
    const fonts = createFonts({
      env: fakeEnv().env,
      storage: null,
      source: fontsourceNpm({ base: "/f", fetch: bytesFetch({ "/f/lora-latin-400-normal.woff": lora, "/f/lora-latin-700-normal.woff": lora, "/f/lora-latin-400-italic.woff": lora }) }),
    });
    const { fonts: out, warnings } = await fonts.pdfFonts(["Lora", "Arial", "lora"], { text: "Hello" });
    expect(Object.keys(out).sort()).toEqual(["Lora", "Lora bold", "Lora italic"]);
    expect(fontFileFormat(out.Lora!)).toBe("ttf");
    expect(warnings).toEqual([]);
  });

  it("names a family it couldn't fetch and carries on", async () => {
    const fonts = createFonts({ env: fakeEnv().env, storage: null, source: fontsourceNpm({ base: "/f", fetch: bytesFetch({}) }) });
    const { fonts: out, warnings } = await fonts.pdfFonts(["Lora"]);
    expect(out).toEqual({});
    expect(warnings[0]).toMatch(/Lora/);
    expect((await createFonts({ env: fakeEnv().env, storage: null, source: null }).pdfFonts(["Lora"])).fonts).toEqual({});
  });
});
