/** The engine pieces the editor draws and files with, gathered in one place. */
import {
  BUILTIN_THEMES,
  deckToPdf,
  type DeckPdfOptions,
  PRESET_GROUPS,
  builtinTheme,
  fromPptx,
  importTemplate as readTemplate,
  customPath as customPaths,
  customTextRect as customRect,
  presetAdjustDefaults as adjustDefaults,
  presetPath as presetPaths,
  presetTextRect as textRect,
  toPotx,
  toPptx,
  type Deck,
  type Master,
  type ResolvedElement,
  type PresetPath,
  type SlideSize,
} from "@pli.dev/decks";

export type { PresetPath };

export interface TextRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The sub-paths of a preset shape in a `w` by `h` box. */
export const presetSubPaths = (geometry: string, w: number, h: number, adjust?: Record<string, number>): PresetPath[] => presetPaths(geometry, w, h, adjust);

/** One SVG path string for the whole outline (icons and clips). */
export const presetPath = (geometry: string, w: number, h: number, adjust?: Record<string, number>): string => presetPaths(geometry, w, h, adjust).map((p) => p.d).join(" ");

export const presetTextRect = (geometry: string, w: number, h: number, adjust?: Record<string, number>): TextRect => textRect(geometry, w, h, adjust);
export const presetAdjustDefaults = adjustDefaults;

/** The sub-paths of an element's outline: its custom (freeform) geometry if it has one, else its preset. */
export const elementSubPaths = (el: Pick<ResolvedElement, "geometry" | "adjust" | "custom">, w: number, h: number): PresetPath[] => (el.custom ? customPaths(el.custom, w, h) : presetPaths(el.geometry, w, h, el.adjust));

/** The rectangle an element's text goes in. */
export const elementTextRect = (el: Pick<ResolvedElement, "geometry" | "adjust" | "custom" | "w" | "h">): TextRect => (el.custom ? customRect(el.custom, el.w, el.h) : textRect(el.geometry, el.w, el.h, el.adjust));

export interface PresetEntry {
  name: string;
  label?: string;
}
export interface PresetGroupView {
  label: string;
  presets: PresetEntry[];
}
export const presetGroups = (): PresetGroupView[] => PRESET_GROUPS.map((g) => ({ label: g.label, presets: g.shapes.map((s) => ({ name: s.geometry, label: s.label })) }));

export interface ThemeEntry {
  id: string;
  name: string;
}
export const builtinThemes = (): ThemeEntry[] => BUILTIN_THEMES.map((t) => ({ id: t.id, name: t.name }));
export const builtinThemeMaster = (id: string, size: SlideSize): Master | undefined => (BUILTIN_THEMES.some((t) => t.id === id) ? builtinTheme(id, size) : undefined);

export const canImportTemplate = true;
export const canPptx = true;
export const canPotx = true;
export const canReadPptx = true;

export interface ImportedTemplate {
  masters: Master[];
  warnings: string[];
  size?: SlideSize;
}

/** Reads a .pptx/.potx (or a Google Slides export) for its masters and layouts. */
export async function importTemplate(bytes: Uint8Array): Promise<ImportedTemplate> {
  const r = readTemplate(bytes);
  return { masters: r.masters, warnings: r.warnings, size: r.size };
}

export interface OpenedDeck {
  deck: Deck;
  warnings: string[];
}
export async function openPptx(bytes: Uint8Array): Promise<OpenedDeck> {
  return fromPptx(bytes);
}
export async function makePptx(deck: Deck): Promise<Uint8Array> {
  return toPptx(deck);
}
/** The deck's masters and layouts as a template (.potx). */
export async function makePotx(deck: Deck): Promise<Uint8Array> {
  return toPotx(deck);
}

export type PdfOptions = DeckPdfOptions;
export const canPdf = true;
/** The deck as a PDF file; warnings are things the file approximated (a picture it could not read…). */
export async function makePdf(deck: Deck, options?: PdfOptions): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  return await deckToPdf(deck, { title: deck.title, ...options });
}
