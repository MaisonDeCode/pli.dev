import { cloneSlide, newId, type Deck, type DeckSession, type ElementClip, type Slide } from "@pli.dev/decks";
import { setSelection } from "./hooks";

// ---- Slides --------------------------------------------------------------------------------------------------------

export const SLIDES_FORMAT = "pli.deck.slides";

export interface SlideClip {
  format: typeof SLIDES_FORMAT;
  slides: Slide[];
}

let internalSlides: SlideClip | null = null;
let internalElements: ElementClip | null = null;

export const lastSlideClip = (): SlideClip | null => internalSlides;
export const lastElementClip = (): ElementClip | null => internalElements;

/** Slides in deck order. */
export function orderedIds(deck: Deck, ids: readonly string[]): string[] {
  return deck.slides.filter((s) => ids.includes(s.id)).map((s) => s.id);
}

export function copySlides(session: DeckSession, ids: readonly string[]): SlideClip {
  const slides = session.deck.slides.filter((s) => ids.includes(s.id)).map((s) => JSON.parse(JSON.stringify(s)) as Slide);
  internalSlides = { format: SLIDES_FORMAT, slides };
  return internalSlides;
}

/** Pastes copied slides after `after` (the shown slide by default). Returns the new slides' ids. */
export function pasteSlides(session: DeckSession, clip: SlideClip, after?: string): string[] {
  const d = session.deck;
  const layouts = new Set(d.masters.flatMap((m) => m.layouts.map((l) => l.id)));
  const fallback = d.masters[0]!.layouts[0]!.id;
  const anchor = after ?? session.selection.slide;
  let index = anchor ? d.slides.findIndex((s) => s.id === anchor) + 1 : d.slides.length;
  if (index <= 0 && anchor) index = d.slides.length;
  const made = clip.slides.map((s): Slide => ({ ...cloneSlide(s), layout: layouts.has(s.layout) ? s.layout : fallback }));
  if (made.length === 0) return [];
  session.transact(made.map((slide, i) => ({ type: "insert_slide" as const, slide, index: index + i })), { after: { slide: made[0]!.id, slides: made.map((s) => s.id), elements: [] } });
  setSelection(session, { slide: made[0]!.id, slides: made.map((s) => s.id), elements: [] });
  return made.map((s) => s.id);
}

export type MoveHow = "up" | "down" | "top" | "bottom";

export function moveSlides(session: DeckSession, ids: readonly string[], how: MoveHow): void {
  const d = session.deck;
  const order = orderedIds(d, ids);
  if (order.length === 0) return;
  const first = d.slides.findIndex((s) => s.id === order[0]);
  const rest = d.slides.length - order.length;
  const to = how === "top" ? 0 : how === "bottom" ? rest : how === "up" ? Math.max(0, first - 1) : Math.min(rest, first + 1);
  session.moveSlides(order, to);
}

// ---- Elements ------------------------------------------------------------------------------------------------------

export function copyElements(session: DeckSession, owner: string, ids: readonly string[]): ElementClip | null {
  if (ids.length === 0) return null;
  internalElements = session.copyElements(owner, ids);
  return internalElements;
}

export const isElementClip = (v: unknown): v is ElementClip => !!v && typeof v === "object" && (v as ElementClip).format === "pli.deck.elements" && Array.isArray((v as ElementClip).elements);
export const isSlideClip = (v: unknown): v is SlideClip => !!v && typeof v === "object" && (v as SlideClip).format === SLIDES_FORMAT && Array.isArray((v as SlideClip).slides);

/** What the clipboard text is: copied elements or slides (JSON with a format tag), or plain text. */
export function parseClip(text: string): ElementClip | SlideClip | null {
  if (!text.startsWith("{")) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return isElementClip(v) ? v : isSlideClip(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeClipboard(text: string): void {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // no clipboard access: the in-memory copy still works inside the editor
  }
}

export async function readClipboardText(): Promise<string | null> {
  try {
    return (await navigator.clipboard?.readText()) ?? null;
  } catch {
    return null;
  }
}

// ---- Pictures ------------------------------------------------------------------------------------------------------

/** Natural size of a picture. A test DOM never loads one, so it answers 4:3 at once. */
export function measureImage(src: string): Promise<{ w: number; h: number }> {
  const jsdom = typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent);
  if (jsdom || typeof Image === "undefined") return Promise.resolve({ w: 640, h: 480 });
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve({ w: 640, h: 480 }), 4000);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ w: img.naturalWidth || 640, h: img.naturalHeight || 480 });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve({ w: 640, h: 480 });
    };
    img.src = src;
  });
}

export function readDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The picture couldn't be read"));
    reader.readAsDataURL(file);
  });
}

export function readBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read"));
    reader.readAsArrayBuffer(file);
  });
}

export function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read"));
    reader.readAsText(file);
  });
}

/**
 * Puts a picture in a placeholder: `uploadImage` can turn the file into a URL first; otherwise it is embedded as a data URI.
 * The picture covers the placeholder's frame and keeps its shape.
 */
export async function fillPicturePlaceholder(session: DeckSession, owner: string, elementId: string, file: File, uploadImage?: (file: File) => Promise<string> | string): Promise<string> {
  // a page that kept an older session object across a hot reload lacks newer methods: say so rather than fail obscurely
  if (typeof (session as Partial<DeckSession>).fillPlaceholderWithPicture !== "function") throw new Error("This editor's session is out of date (the page was updated while it was open). Reload the page to add pictures to placeholders.");
  const src = uploadImage ? await uploadImage(file) : await readDataUri(file);
  const size = await measureImage(src);
  return session.fillPlaceholderWithPicture(owner, elementId, src, size, { alt: file.name.replace(/\.[^.]+$/, "") });
}

/** The empty picture placeholder a picture dropped at a point (or, with no point, the selected one) belongs in. */
export function pictureTarget(session: DeckSession, owner: string, selected: readonly string[], at?: { x: number; y: number }): string | undefined {
  const list = session.scene(owner).elements.filter((r) => r.from === "slide" && r.kind === "shape" && (r.placeholder?.type === "pic" || r.placeholder?.type === "clipArt") && !r.hidden && (!r.text || r.text.paragraphs.every((p) => p.runs.every((x) => x.text === ""))));
  if (at) return [...list].reverse().find((r) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h)?.id;
  return list.find((r) => selected.includes(r.id))?.id;
}

/** Puts a picture on a slide: `uploadImage` can turn the file into a URL first; otherwise it is embedded as a data URI. */
export async function insertPicture(session: DeckSession, owner: string, file: File, at?: { x: number; y: number }, uploadImage?: (file: File) => Promise<string> | string): Promise<string | null> {
  const src = uploadImage ? await uploadImage(file) : await readDataUri(file);
  const size = await measureImage(src);
  const el = session.addImage(owner, src, size, at ? { x: at.x - Math.min(size.w, session.deck.size.width * 0.8) / 2, y: at.y - Math.min(size.h, session.deck.size.height * 0.8) / 2 } : undefined, { alt: file.name.replace(/\.[^.]+$/, "") });
  return el.id;
}
