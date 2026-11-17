import { SUBSET_RANGES } from "./google";
import { toTrueType } from "./sfnt";
import type { FontFaceSpec, FontFamily, FontSource, FontStyle } from "./types";

type Fetch = NonNullable<import("./types").FontRegistryOptions["fetch"]>;
const globalFetch: Fetch = (url) => (globalThis as unknown as { fetch: Fetch }).fetch(url);

/** The weight of a family that comes closest to the one asked for, by CSS's rules (400 and 500 look at each other first). */
export function nearestWeight(available: readonly number[], wanted: number): number {
  if (available.length === 0) return wanted;
  if (available.includes(wanted)) return wanted;
  const lower = available.filter((w) => w < wanted).sort((a, b) => b - a);
  const higher = available.filter((w) => w > wanted).sort((a, b) => a - b);
  if (wanted === 400) return available.includes(500) ? 500 : (lower[0] ?? higher[0]!);
  if (wanted === 500) return available.includes(400) ? 400 : (lower[0] ?? higher[0]!);
  return wanted < 400 ? (lower[0] ?? higher[0]!) : (higher[0] ?? lower[0]!);
}

/** Whether a code point is inside a CSS `unicode-range` value (`U+0000-00FF,U+0131,U+04??`). */
export function inUnicodeRange(range: string, cp: number): boolean {
  for (const part of range.split(",")) {
    const m = /^\s*U\+([0-9a-fA-F?]+)(?:-([0-9a-fA-F]+))?\s*$/.exec(part);
    if (!m) continue;
    if (m[1]!.includes("?")) {
      if (cp >= parseInt(m[1]!.replace(/\?/g, "0"), 16) && cp <= parseInt(m[1]!.replace(/\?/g, "f"), 16)) return true;
    } else {
      const from = parseInt(m[1]!, 16);
      const to = m[2] ? parseInt(m[2], 16) : from;
      if (cp >= from && cp <= to) return true;
    }
  }
  return false;
}

/** The scripts that Fontsource and Google cut into numbered slices, which need the family's own list of slices. */
const SLICED = /^(japanese|korean|chinese-.*)$/;

const formatOf = (url: string): FontFaceSpec["format"] => (/\.woff2(\?|#|$)/i.test(url) ? "woff2" : /\.woff(\?|#|$)/i.test(url) ? "woff" : "truetype");

async function bytesOf(fetchFn: Fetch, url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetchFn(url);
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export interface FontsourceFile {
  id: string;
  subset: string;
  weight: number;
  style: FontStyle;
  format: "woff2" | "woff" | "ttf";
}

export interface FontsourceOptions {
  /** Makes a file's address. */
  url: (file: FontsourceFile) => string;
  name?: string;
  /** Whether `url({ format: "ttf" })` exists, for PDF files. Without it WOFF files are converted. */
  ttf?: boolean;
  /**
   * Where to ask for the numbered slices of the Chinese, Japanese and Korean families (Fontsource's API, or a copy of
   * it). `null` skips those families' other scripts. Default `https://api.fontsource.org`.
   */
  api?: string | null;
  fetch?: Fetch;
}

/** A source for files laid out the way Fontsource lays them out (the `@fontsource/*` npm packages, or its CDN). */
export function fontsourceSource(options: FontsourceOptions): FontSource {
  const fetchFn = options.fetch ?? globalFetch;
  const api = options.api === undefined ? "https://api.fontsource.org" : options.api;
  const slices = new Map<string, Promise<Record<string, string>>>();

  const sliceRanges = (id: string): Promise<Record<string, string>> => {
    let p = slices.get(id);
    if (!p && api) {
      p = fetchFn(`${api.replace(/\/$/, "")}/v1/fonts/${id}`).then(async (res) => (res.ok ? ((await res.json()) as { unicodeRange?: Record<string, string> }).unicodeRange ?? {} : {}));
      slices.set(id, p);
    }
    return p ?? Promise.resolve({});
  };

  const fileFor = (family: FontFamily, subset: string, weight: number, style: FontStyle, format: FontFaceSpec["format"]): FontFaceSpec => ({
    family: family.family,
    weight,
    style,
    subset,
    format,
    url: options.url({ id: family.id!, subset, weight, style, format: format === "truetype" ? "ttf" : format }),
  });

  return {
    name: options.name ?? "fontsource",
    async faces(family, wanted) {
      if (!family.id) return [];
      const weight = nearestWeight(family.weights, wanted.weight);
      const style: FontStyle = wanted.style === "italic" && family.italic ? "italic" : "normal";
      const scripts = family.subsets.filter((s) => !SLICED.test(s));
      const out: FontFaceSpec[] = [];
      // Scripts without a known range load whole; they go first so the ranged faces, declared later, win for the characters both have.
      for (const s of scripts) if (!SUBSET_RANGES[s]) out.push(fileFor(family, s, weight, style, "woff2"));
      for (const s of scripts) if (SUBSET_RANGES[s]) out.push({ ...fileFor(family, s, weight, style, "woff2"), unicodeRange: SUBSET_RANGES[s]! });
      if (family.subsets.some((s) => SLICED.test(s)) && api) {
        // Chinese, Japanese and Korean families are many small slices; the family's page says which characters each has.
        const ranges = await sliceRanges(family.id);
        for (const [key, range] of Object.entries(ranges)) {
          const m = /^\[(\d+)\]$/.exec(key);
          if (m) out.push({ ...fileFor(family, m[1]!, weight, style, "woff2"), unicodeRange: range });
        }
      }
      return out;
    },
    async file(family, wanted) {
      if (!family.id) return null;
      const weight = nearestWeight(family.weights, wanted.weight);
      const style: FontStyle = wanted.style === "italic" && family.italic ? "italic" : "normal";
      // The script file that has most of the text; Latin when there is none.
      const candidates = family.subsets.filter((s) => SUBSET_RANGES[s]);
      const chars = [...new Set([...wanted.text].map((c) => c.codePointAt(0)!).filter((c) => c > 32))];
      let best = family.subsets.includes("latin") ? "latin" : (candidates[0] ?? family.subsets[0] ?? "latin");
      let bestCount = -1;
      const latinFirst = [...candidates].sort((a, b) => (a === "latin" ? -1 : b === "latin" ? 1 : 0));
      for (const s of latinFirst) {
        const range = SUBSET_RANGES[s];
        const count = range ? chars.filter((c) => inUnicodeRange(range, c)).length : 0;
        if (count > bestCount) (best = s), (bestCount = count);
      }
      if (options.ttf) {
        const ttf = await bytesOf(fetchFn, options.url({ id: family.id, subset: best, weight, style, format: "ttf" }));
        if (ttf) return ttf;
      }
      const woff = await bytesOf(fetchFn, options.url({ id: family.id, subset: best, weight, style, format: "woff" }));
      return woff ? toTrueType(woff) : null;
    },
  };
}

/**
 * Fontsource's files on the jsDelivr CDN: free, no sign-in, no cookies, versioned. The files are the same ones the
 * `@fontsource/*` npm packages contain, so a host can switch to `fontsourceNpm` without changing anything else.
 * `version` pins the release (`"5.3.0"`); `"latest"` follows it.
 */
export function fontsourceCdn(options: { base?: string; version?: string; api?: string | null; fetch?: Fetch } = {}): FontSource {
  const base = (options.base ?? "https://cdn.jsdelivr.net/fontsource/fonts").replace(/\/$/, "");
  const version = options.version ?? "latest";
  return fontsourceSource({
    name: "fontsource-cdn",
    ttf: true,
    ...(options.api !== undefined ? { api: options.api } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    url: (f) => `${base}/${f.id}@${version}/${f.subset}-${f.weight}-${f.style}.${f.format}`,
  });
}

/**
 * Files you serve yourself, laid out the way the `@fontsource/*` npm packages lay them out: copy the `files` folder of
 * each package you want to `base` (`/fonts`) and every file is `/fonts/open-sans-latin-400-normal.woff2`. No request
 * leaves your own server, and the editors work without a network.
 */
export function fontsourceNpm(options: { base: string; api?: string | null; fetch?: Fetch }): FontSource {
  const base = options.base.replace(/\/$/, "");
  return fontsourceSource({
    name: "fontsource-npm",
    api: options.api === undefined ? null : options.api,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    url: (f) => `${base}/${f.id}-${f.subset}-${f.weight}-${f.style}.${f.format}`,
  });
}

// ---- Google's own CSS ---------------------------------------------------------------------------------------------

/** The `@font-face` rules in a stylesheet, as faces. */
export function parseFontFaceCss(css: string): FontFaceSpec[] {
  const out: FontFaceSpec[] = [];
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1]!;
    const prop = (name: string) => new RegExp(`${name}\\s*:\\s*([^;]+)`, "i").exec(body)?.[1]?.trim();
    const family = prop("font-family")?.replace(/^["']|["']$/g, "");
    const src = /url\(\s*["']?([^"')]+)["']?\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/i.exec(prop("src") ?? "");
    if (!family || !src) continue;
    const weight = Number(/\d+/.exec(prop("font-weight") ?? "400")?.[0] ?? 400);
    const range = prop("unicode-range");
    const fmt = src[2]?.toLowerCase();
    out.push({
      family,
      weight,
      style: /italic|oblique/i.test(prop("font-style") ?? "") ? "italic" : "normal",
      url: src[1]!,
      format: fmt === "woff2" ? "woff2" : fmt === "woff" ? "woff" : fmt === "truetype" ? "truetype" : formatOf(src[1]!),
      ...(range ? { unicodeRange: range } : {}),
    });
  }
  return out;
}

/**
 * Google's own CSS API (`fonts.googleapis.com/css2`): one request for the stylesheet, then the files from
 * `fonts.gstatic.com`. The visitor's address goes to Google, so many sites need their visitors' consent first (see
 * the fonts page of the docs); prefer `fontsourceCdn` or files you host. Not used for PDF files.
 */
export function googleCssSource(options: { endpoint?: string; fetch?: Fetch } = {}): FontSource {
  const endpoint = options.endpoint ?? "https://fonts.googleapis.com/css2";
  const fetchFn = options.fetch ?? globalFetch;
  return {
    name: "google-css",
    async faces(family, wanted) {
      const weight = nearestWeight(family.weights, wanted.weight);
      const italic = wanted.style === "italic" && family.italic;
      const spec = `${encodeURIComponent(family.family).replace(/%20/g, "+")}:ital,wght@${italic ? 1 : 0},${weight}`;
      const res = await fetchFn(`${endpoint}?family=${spec}&display=swap`);
      if (!res.ok) throw new Error(`Google Fonts answered ${res.status}`);
      return parseFontFaceCss(await res.text()).map((f) => ({ ...f, family: family.family, weight, style: italic ? ("italic" as const) : ("normal" as const) }));
    },
  };
}

// ---- Your own files -----------------------------------------------------------------------------------------------

/** One file of a family you supply. */
export interface StaticFontFile {
  weight?: number;
  style?: FontStyle;
  url: string;
  /** Given for files that are not `.woff2`, `.woff` or `.ttf` by name. */
  format?: FontFaceSpec["format"];
  unicodeRange?: string;
}

/**
 * A source for families of your own (or any you want to serve from fixed addresses): a map of family names to their files.
 * Add the same families to the catalogue with `extra` so that pickers list them.
 */
export function staticSource(files: Record<string, readonly StaticFontFile[]>, options: { fetch?: Fetch } = {}): FontSource {
  const fetchFn = options.fetch ?? globalFetch;
  const lower = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), v]));
  const pick = (family: string, weight: number, style: FontStyle): StaticFontFile[] => {
    const all = lower.get(family.toLowerCase()) ?? [];
    const styled = all.filter((f) => (f.style ?? "normal") === style);
    const pool = styled.length ? styled : all.filter((f) => (f.style ?? "normal") === "normal");
    const w = nearestWeight([...new Set(pool.map((f) => f.weight ?? 400))], weight);
    return pool.filter((f) => (f.weight ?? 400) === w);
  };
  return {
    name: "static",
    faces: (family, wanted) =>
      pick(family.family, wanted.weight, wanted.style).map((f) => ({
        family: family.family,
        weight: f.weight ?? 400,
        style: f.style ?? "normal",
        url: f.url,
        format: f.format ?? formatOf(f.url),
        ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
      })),
    async file(family, wanted) {
      const file = pick(family.family, wanted.weight, wanted.style)[0];
      if (!file) return null;
      const bytes = await bytesOf(fetchFn, file.url);
      return bytes ? toTrueType(bytes) : null;
    },
  };
}
