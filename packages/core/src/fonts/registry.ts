import { fontKey, lookupFont, registerFonts } from "./catalogue";
import { browserFontEnv } from "./env";
import { fontStack, widthFactor } from "./metrics";
import { googleFonts } from "./google";
import { SYSTEM_FONTS } from "./office";
import { fontsourceCdn } from "./sources";
import type { FontCategory, FontEnv, FontFamily, FontRegistryOptions, FontSource, FontStatus, FontStyle } from "./types";

/** A sample of the characters a first load fetches when nobody says which text will be shown. */
const SAMPLE = "AaBbCcDdEeFfGgHh 0123456789";
const RECENT_LIMIT = 8;

export interface LoadOptions {
  /** Default 400. */
  weight?: number;
  /** Default `normal`. */
  style?: FontStyle;
  /** The text that will be shown. Only the files that have its characters are fetched; defaults to a Latin sample. */
  text?: string;
}

export interface FontSearch {
  /** Part of a name, in any case. */
  query?: string;
  category?: FontCategory | "all";
  /** Only families with this script (`cyrillic`). */
  subset?: string;
  /** Only families that come in this weight. */
  weight?: number;
}

/** The fonts of one editor: what it offers, what is loaded, and how to ask for more. Made with `createFonts`. */
export interface FontRegistry {
  readonly source: FontSource | null;
  /** The families offered to the user, in the order a picker shows them: your own, then installed ones, then Google's by popularity. */
  list(): readonly FontFamily[];
  search(search?: FontSearch): FontFamily[];
  /** A family by name (aliases and any case), offered or not. */
  find(name: string): FontFamily | undefined;
  /** Whether a pickers shows the family. */
  offers(name: string): boolean;
  /** The CSS `font-family` value for a name: the name, its stand-ins and a generic family. */
  stack(name: string, extra?: readonly string[]): string;
  /** How wide text in the family is compared with Helvetica (an estimate, until the font has loaded). */
  widthFactor(name: string): number;
  /** Where the family is: `system`, `idle`, `loading`, `ready` or `failed`. */
  status(name: string): FontStatus;
  /**
   * Loads a family so documents and previews draw it. Never rejects and never throws: when the files can't be had the
   * answer is `failed`, and everything keeps drawing with `stack`'s fallbacks. Calling it again for a failed family tries again.
   */
  load(name: string, options?: LoadOptions): Promise<FontStatus>;
  /** `load` for several names (a document's fonts); resolves when all have settled. */
  loadAll(names: Iterable<string>, options?: LoadOptions): Promise<void>;
  /**
   * Calls back when a font's state changes (loading started, finished or failed, or a file arrived by any other
   * route): the time to measure text again. Returns how to stop listening.
   */
  subscribe(listener: () => void): () => void;
  /** Goes up whenever `subscribe`'s listeners are called; for `useSyncExternalStore`. */
  version(): number;
  /** The families used last, newest first (kept in `storage` between visits). */
  recent(): string[];
  /** Notes that a family was used (shows up in `recent`). */
  use(name: string): void;
  /**
   * TrueType bytes for PDF files, in the form `toPdf`'s `fonts` takes: `{ "Lora": ..., "Lora bold": ... }`. Families the
   * source has no file for are left out (PDF then draws the nearest standard font) and named in `warnings`.
   */
  pdfFonts(names: Iterable<string>, options?: { text?: string; styles?: readonly ("regular" | "bold" | "italic" | "bold italic")[] }): Promise<{ fonts: Record<string, Uint8Array>; warnings: string[] }>;
}

function matches(f: FontFamily, s: FontSearch): boolean {
  if (s.category && s.category !== "all" && f.category !== s.category) return false;
  if (s.subset && f.origin !== "system" && !f.subsets.includes(s.subset)) return false;
  if (s.weight && !f.weights.includes(s.weight)) return false;
  if (s.query) {
    const q = fontKey(s.query);
    if (!fontKey(f.family).includes(q)) return false;
  }
  return true;
}

function defaultStorage(): FontRegistryOptions["storage"] {
  try {
    const ls = (globalThis as unknown as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } }).localStorage;
    return ls ? { get: (k) => ls.getItem(k), set: (k, v) => ls.setItem(k, v) } : null;
  } catch {
    return null;
  }
}

export function createFonts(options: FontRegistryOptions = {}): FontRegistry {
  const source = options.source === undefined ? fontsourceCdn(options.fetch ? { fetch: options.fetch } : {}) : options.source;
  const env: FontEnv = options.env ?? browserFontEnv();
  const timeout = options.timeoutMs ?? 8000;
  const standIns = options.substituteOffice !== false;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const storageKey = options.storageKey ?? "pli.fonts.recent";

  const extra = (options.extra ?? []).map((f) => ({ ...f, origin: "custom" as const }));
  registerFonts(extra);
  const extraIndex = new Map(extra.map((f) => [fontKey(f.family), f]));
  const find = (name: string): FontFamily | undefined => extraIndex.get(fontKey(name)) ?? lookupFont(name);

  // What is offered.
  let offered: readonly FontFamily[];
  const build = (): readonly FontFamily[] => {
    const all = [...extra, ...SYSTEM_FONTS, ...(options.noGoogle ? [] : googleFonts())];
    const only = options.only;
    if (!only) return all;
    if (typeof only === "function") return all.filter(only);
    const out: FontFamily[] = [];
    for (const name of only) {
      const f = find(name);
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
  };
  let offeredNames: Set<string> | undefined;

  // State.
  type Entry = { status: FontStatus; inflight: number; ready: boolean };
  const entries = new Map<string, Entry>();
  const facesAsked = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  let ticks = 0;
  const notify = () => {
    ticks++;
    for (const l of [...listeners]) {
      try {
        l();
      } catch {
        // a listener's mistake must not stop the others
      }
    }
  };
  let unsubscribeEnv: (() => void) | undefined;

  const statusOf = (family: FontFamily): FontStatus => {
    const e = entries.get(fontKey(family.family));
    if (e) return e.status;
    if (family.origin === "system") return standIns && source && env.canLoad && !env.isInstalled(family.family) ? "idle" : "system";
    return "idle";
  };

  /** Resolves with `true` if the time ran out first, `false` once `p` settled in time. */
  const withTimeout = (p: Promise<unknown>): Promise<boolean> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(true), timeout);
      void p.then(() => {
        clearTimeout(timer);
        resolve(false);
      });
    });

  /** Loads one family (not an Office stand-in decision: the caller chose which family to fetch). */
  const fetchFamily = (family: FontFamily, weight: number, style: FontStyle, text: string): Promise<boolean> => {
    if (!source) return Promise.resolve(false);
    const key = `${fontKey(family.family)}|${weight}|${style}`;
    let faces = facesAsked.get(key);
    if (!faces) {
      faces = (async () => {
        const specs = await source.faces(family, { weight, style });
        if (specs.length === 0) throw new Error(`${source.name} has no files for ${family.family}`);
        for (const spec of specs) env.register(spec);
      })();
      facesAsked.set(key, faces);
      faces.catch(() => facesAsked.delete(key)); // a failure can be tried again
    }
    return faces.then(
      () => env.load(`${style === "italic" ? "italic " : ""}${weight} 16px "${family.family.replace(/"/g, "")}"`, text),
      () => false,
    );
  };

  const load = (name: string, o: LoadOptions = {}): Promise<FontStatus> => {
    const family = find(name);
    if (!family) return Promise.resolve("unknown");
    const k = fontKey(family.family);
    const weight = o.weight ?? 400;
    const style = o.style ?? "normal";
    const text = o.text && o.text.length > 0 ? o.text : SAMPLE;
    if (!env.canLoad || !source) {
      return Promise.resolve(family.origin === "system" ? "system" : (entries.get(k)?.status ?? "idle"));
    }
    // Installed Office fonts need nothing. Ones that aren't installed get their metric-compatible twin, if there is one.
    let target: FontFamily | undefined = family;
    if (family.origin === "system") {
      if (!standIns || env.isInstalled(family.family)) return Promise.resolve("system");
      target = family.fallbacks.map((n) => lookupFont(n)).find((f) => f && f.origin === "google");
      if (!target) return Promise.resolve("system");
    }
    const entry: Entry = entries.get(k) ?? { status: "idle", inflight: 0, ready: false };
    entries.set(k, entry);
    if (!entry.ready && entry.status !== "loading") {
      entry.status = "loading";
      notify();
    }
    entry.inflight++;
    const real = fetchFamily(target, weight, style, text).then((ok) => {
      entry.inflight--;
      if (ok) entry.ready = true;
      const next: FontStatus = entry.ready ? "ready" : entry.inflight > 0 ? "loading" : "failed";
      if (next !== entry.status) {
        entry.status = next;
        notify();
      }
      return next;
    });
    // Slow is treated as failed (the fallbacks stay in use) but a file that arrives later still turns it to ready.
    return withTimeout(real).then((late) => {
      if (late && !entry.ready && entry.status === "loading") {
        entry.status = "failed";
        notify();
      }
      return entry.status;
    });
  };

  const recent = (): string[] => {
    try {
      const raw = storage?.get(storageKey);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? list.filter((n): n is string => typeof n === "string").slice(0, RECENT_LIMIT) : [];
    } catch {
      return [];
    }
  };
  let memoryRecent: string[] | undefined;

  const registry: FontRegistry = {
    source,
    list() {
      return (offered ??= build());
    },
    search(s = {}) {
      return registry.list().filter((f) => matches(f, s));
    },
    find,
    offers(name) {
      offeredNames ??= new Set(registry.list().map((f) => fontKey(f.family)));
      const f = find(name);
      return !!f && offeredNames.has(fontKey(f.family));
    },
    stack: (name, more) => fontStack(name, more, find(name)),
    widthFactor,
    status(name) {
      const f = find(name);
      return f ? statusOf(f) : "unknown";
    },
    load,
    async loadAll(names, o) {
      await Promise.all([...new Set(names)].map((n) => load(n, o)));
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && env.subscribe) unsubscribeEnv = env.subscribe(notify);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeEnv?.();
          unsubscribeEnv = undefined;
        }
      };
    },
    version: () => ticks,
    recent: () => memoryRecent ?? recent(),
    use(name) {
      const f = find(name);
      if (!f) return;
      const next = [f.family, ...registry.recent().filter((n) => fontKey(n) !== fontKey(f.family))].slice(0, RECENT_LIMIT);
      memoryRecent = next;
      try {
        storage?.set(storageKey, JSON.stringify(next));
      } catch {
        // private browsing or a full disk: the list lives on in memory
      }
      notify();
    },
    async pdfFonts(names, o = {}) {
      const fonts: Record<string, Uint8Array> = {};
      const warnings: string[] = [];
      const styles = o.styles ?? ["regular", "bold", "italic", "bold italic"];
      for (const name of new Set(names)) {
        const f = find(name);
        if (!f || f.origin === "system" || !source?.file) continue;
        let got = 0;
        for (const style of styles) {
          const bold = style.includes("bold");
          const italic = style.includes("italic");
          if (italic && !f.italic) continue;
          try {
            const bytes = await source.file(f, { weight: bold ? 700 : 400, style: italic ? "italic" : "normal", text: o.text ?? SAMPLE });
            if (bytes) {
              fonts[`${f.family}${bold ? " bold" : ""}${italic ? " italic" : ""}`] = bytes;
              got++;
            }
          } catch {
            // counted below
          }
        }
        if (got === 0) warnings.push(`The font ${f.family} could not be fetched for the PDF; the nearest standard PDF font is used instead.`);
      }
      return { fonts, warnings };
    },
  };
  return registry;
}

let shared: FontRegistry | undefined;

/**
 * The registry editors use when you don't give them one: every font, loaded from Fontsource's CDN on demand. Made on
 * first use. Pass your own (`fonts={createFonts({...})}`) to restrict the list or serve the files yourself.
 */
export function defaultFonts(): FontRegistry {
  return (shared ??= createFonts());
}

/** Replaces what `defaultFonts()` returns (once, at start-up), so every editor on the page shares your configuration. */
export function setDefaultFonts(registry: FontRegistry | undefined): void {
  shared = registry;
}
