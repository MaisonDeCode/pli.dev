/** How a family looks, in the five groups Google Fonts and CSS both use. */
export type FontCategory = "sans-serif" | "serif" | "monospace" | "display" | "handwriting";

export type FontStyle = "normal" | "italic";

/** Where a family comes from. */
export type FontOrigin =
  /** Installed on most computers (the Office and web-safe fonts). Never downloaded, except for a metric-compatible stand-in. */
  | "system"
  /** One of the open-licence families of Google Fonts, downloaded from the host's `FontSource` when it is used. */
  | "google"
  /** A family the host adds itself (`extra` in `createFonts`). */
  | "custom";

/** One family in the catalogue. */
export interface FontFamily {
  /** The name documents store and CSS uses: `"Lora"`. */
  readonly family: string;
  readonly category: FontCategory;
  readonly origin: FontOrigin;
  /** The weights it comes in (100 to 900). `system` families list the ones their usual installs have. */
  readonly weights: readonly number[];
  /** Whether it has real italics (without, the browser slants it). */
  readonly italic: boolean;
  /** The scripts it covers, by Google's names (`latin`, `cyrillic`...). Empty for `system` families. */
  readonly subsets: readonly string[];
  /** The id the Fontsource files use (`"open-sans"`), for Google families. */
  readonly id?: string;
  /** Where it comes in Google's popularity order (0 is the most popular), for Google families. */
  readonly rank?: number;
  /**
   * Fonts to use in its place when it isn't installed or hasn't loaded, best first: a metric-compatible open font
   * where there is one (Carlito for Calibri), then the families of the same look. They are only names; the CSS stack
   * ends with a generic family (`serif`, `sans-serif`...) so nothing is ever left without a font.
   */
  readonly fallbacks: readonly string[];
  /** Other names the same font goes by in files (`"Arial MT"`, `"ArialMT"`). */
  readonly aliases?: readonly string[];
  /** The Office font to write in a file for people who don't have this one (see `officeSubstitute`). */
  readonly office?: string;
}

/** What a registry knows about a family while it is being used. */
export type FontStatus =
  /** Not in the catalogue: the browser draws it if the computer has it, with the stack's fallbacks otherwise. */
  | "unknown"
  /** Drawn from what is installed; nothing to load. */
  | "system"
  /** Not asked for yet. */
  | "idle"
  | "loading"
  | "ready"
  /** Downloading failed or timed out; the fallbacks are in use. */
  | "failed";

/** One downloadable file of a family: what an `@font-face` rule says. */
export interface FontFaceSpec {
  readonly family: string;
  /** 100 to 900. */
  readonly weight: number;
  readonly style: FontStyle;
  readonly url: string;
  readonly format: "woff2" | "woff" | "truetype";
  /** The characters the file has, as CSS writes them (`U+0000-00FF,U+0131`). Without it the file is for every character. */
  readonly unicodeRange?: string;
  /** The script it is for (`latin`). */
  readonly subset?: string;
}

/** A way to get a family's files: Fontsource's CDN, the host's own server, the files inside the app. */
export interface FontSource {
  readonly name: string;
  /**
   * The files of a family at one weight and style. Called once per family, weight and style that is used, and the
   * answer is kept. May throw or reject: the family is then marked `failed`. An empty list means the source doesn't have it.
   */
  faces(family: FontFamily, wanted: { weight: number; style: FontStyle }): readonly FontFaceSpec[] | Promise<readonly FontFaceSpec[]>;
  /**
   * The bytes of the family's font (TrueType preferred, WOFF accepted) for putting in a PDF. Optional: without it a
   * source's fonts are not embedded and PDF text uses the nearest standard PDF font.
   */
  file?(family: FontFamily, wanted: { weight: number; style: FontStyle; text: string }): Promise<Uint8Array | null>;
}

/**
 * What a registry needs from the page: put a font file in, and ask whether a family is installed. The default uses
 * `FontFace` and `document.fonts` where there are some; without them (Node, a test, a worker) nothing is loaded and
 * every family stays on its fallbacks.
 */
export interface FontEnv {
  /** Makes a face known to CSS (idempotent). The file is only downloaded when text needs it, or when `load` asks. */
  register(spec: FontFaceSpec): void;
  /**
   * Downloads the faces of a CSS font (`'400 16px "Lora"'`) that have the characters of `text`, and resolves once they
   * are in. Resolves `false` (never rejects) when a file could not be loaded.
   */
  load(font: string, text: string): Promise<boolean>;
  /** Whether a family is installed on this computer (found by measuring, as the browser gives no direct answer). */
  isInstalled(family: string): boolean;
  /** Calls back when the page has finished loading some font files, however they were asked for. Returns how to stop. */
  subscribe?(listener: () => void): () => void;
  /** Whether this environment can load files at all. */
  readonly canLoad: boolean;
}

export interface FontRegistryOptions {
  /** Where Google families come from. Default: Fontsource's files on jsDelivr. `null` loads nothing (offline: only installed fonts). */
  source?: FontSource | null;
  /**
   * The families to offer. A list of names keeps just those (in the order given); a function filters the whole
   * catalogue. Default: everything. Fonts a document already uses stay usable even when they are not offered.
   */
  only?: readonly string[] | ((font: FontFamily) => boolean);
  /** Families of your own to add to the catalogue (`origin: "custom"`), usually with a `staticSource` that has their files. */
  extra?: readonly FontFamily[];
  /** Leave the Google catalogue out (only the system fonts and `extra` are offered). Default false. */
  noGoogle?: boolean;
  /** Load Office fonts' open stand-ins (Carlito for Calibri) where the real font isn't installed. Default true. */
  substituteOffice?: boolean;
  /** The scripts to load for a family (the others are skipped). Default: Latin, Cyrillic, Greek, Vietnamese and what the text needs. */
  subsets?: readonly string[];
  /** Gives up on a download after this many milliseconds. Default 8000. */
  timeoutMs?: number;
  /** Replaces the page's font loading; for tests and for hosts with their own loader. */
  env?: FontEnv;
  /** Keeps the recently used list between visits. Default: `localStorage` where there is one. */
  storage?: { get(key: string): string | null; set(key: string, value: string): void } | null;
  /** The key the recently used list is saved under. */
  storageKey?: string;
  /** `fetch` for the sources that need it (the API of a detailed family, PDF files). Default: the global one. */
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<unknown>; text(): Promise<string> }>;
}
