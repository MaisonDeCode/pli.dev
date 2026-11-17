/**
 * The scripted story of the Pli.PDF editor on the site: the sample file the engine makes, and what is done to it.
 *
 *   step 0  the sample file, page 1, untouched
 *   step 1  two highlights and an underline on lines of text (rectangles found by the engine's own text search)
 *   step 2  a hand-drawn loop around the title, a sticky note, the name and the check box of the form filled in, and a signature
 *
 * The story is a list of items. Each knows how to apply itself to a session, how to take itself back and whether it is there,
 * and has a fixed id, so that the state of a step is the same however it was reached. Everything goes through the engine's
 * own commands (`session.annots`, `session.forms`), the way the editor's tools do.
 */
import { makeSamplePdf, openPdf, searchText, type PdfSession, type Pt, type Rect } from "@pli.dev/pdf";

export const PDF_STEPS = 3;
export const YOU = { id: "you", name: "You" } as const;
/** A fixed clock: annotations get the same `created` and `modified` every time, so equal steps are equal documents. */
const CLOCK = Date.UTC(2026, 0, 15, 9, 30);
export const SIGNER = "Sam Rivera";

export interface Item {
  /** The first step that has it. */
  step: number;
  /** A fixed id: the annotation's, or the form field's name. */
  id: string;
  apply(session: PdfSession): void;
  revert(session: PdfSession): void;
  present(session: PdfSession): boolean;
}

export interface Plan {
  pageId: string;
  items: Item[];
}

let sample: Promise<Uint8Array> | undefined;
/** The sample file's bytes, made once (the engine needs no network). */
export const sampleBytes = (): Promise<Uint8Array> => (sample ??= makeSamplePdf());

/** Opens a fresh session on the sample file. */
export async function openSample(): Promise<PdfSession> {
  return openPdf(await sampleBytes(), { name: "sample.pdf", user: YOU, now: () => CLOCK });
}

const round = (n: number) => Math.round(n * 10) / 10;

/** A loop drawn by hand around a box: a little uneven, going round a bit more than once. Deterministic. */
export function loopAround(box: Rect): Pt[] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2 + 14;
  const ry = box.h / 2 + 9;
  const points: Pt[] = [];
  const n = 36;
  for (let i = 0; i <= n; i++) {
    const t = -0.35 + (i / n) * (2 * Math.PI + 0.55);
    const wobble = 1 + 0.035 * Math.sin(3 * t + 0.6) + 0.015 * Math.cos(7 * t);
    const drift = 1 - 0.05 * (i / n);
    points.push([round(cx + rx * wobble * drift * Math.cos(t)), round(cy + ry * wobble * drift * Math.sin(t))]);
  }
  return points;
}

/** A signature scribble in a box of w by h: a tall first letter, a wave and an underline stroke. */
export function scribble(w: number, h: number): Pt[][] {
  const wave: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    wave.push([round(w * (0.12 + 0.62 * u)), round(h * (0.62 - 0.22 * Math.sin(u * 17) * (1 - 0.5 * u)))]);
  }
  return [
    [
      [round(w * 0.2), round(h * 0.18)],
      [round(w * 0.1), round(h * 0.5)],
      [round(w * 0.14), round(h * 0.8)],
      [round(w * 0.24), round(h * 0.55)],
      [round(w * 0.3), round(h * 0.28)],
    ],
    wave,
    [
      [round(w * 0.08), round(h * 0.86)],
      [round(w * 0.45), round(h * 0.78)],
      [round(w * 0.9), round(h * 0.84)],
    ],
  ];
}

/** Finds where `phrase` is on page 1: one rectangle per line. */
async function where(session: PdfSession, phrase: string): Promise<Rect[]> {
  const hits = await searchText(session, phrase, { pages: [0], caseSensitive: true });
  const hit = hits[0];
  if (!hit || hit.rects.length === 0) throw new Error(`The sample file has no "${phrase}" on page 1`);
  return hit.rects;
}

const annotItem = (session: PdfSession, step: number, id: string, add: (id: string) => string): Item => ({
  step,
  id,
  apply: (s) => void (s.annots.get(id) ?? add(id)),
  revert: (s) => s.annots.remove([id]),
  present: (s) => !!s.annots.get(id),
});

/** Makes the story for a session opened with `openSample`: finds the text, and keeps the form's first values to put back. */
export async function planFor(session: PdfSession): Promise<Plan> {
  const pageId = session.doc.pages[0]!.id;
  const made = await where(session, "made in your browser");
  const nothing = await where(session, "Nothing leaves this window");
  const fill = await where(session, "fill in the form below");
  const [title] = await where(session, "Pli.PDF sample");
  const box = title!;
  const field = (name: string) => {
    const f = session.doc.fields.find((x) => x.name === name);
    if (!f) throw new Error(`The sample file has no field "${name}"`);
    return f;
  };
  const nameField = field("name");
  const box2 = field("subscribe");
  const signature = field("signature").widgets[0]!.rect;
  const initial = { name: nameField.value, subscribe: box2.value };
  const quiet = { select: false } as const;

  const items: Item[] = [
    annotItem(session, 1, "site-hl-made", (id) => session.annots.addHighlight(pageId, made, { id, select: false, quote: "made in your browser" })),
    annotItem(session, 1, "site-ul-nothing", (id) => session.annots.addHighlight(pageId, nothing, { id, select: false, type: "underline", quote: "Nothing leaves this window" })),
    annotItem(session, 1, "site-hl-fill", (id) => session.annots.addHighlight(pageId, fill, { id, select: false, color: "#a5d6a7", quote: "fill in the form below" })),
    annotItem(session, 2, "site-ink-title", (id) => session.annots.addInk(pageId, [loopAround(box)], { id, select: false, color: "#e53935", width: 2.2 })),
    annotItem(session, 2, "site-note-title", (id) => session.annots.addNote(pageId, round(box.x + box.w + 34), round(box.y - 2), "Is this title still right for the launch? Shorter might read better.", { id, select: false })),
    {
      step: 2,
      id: "name",
      apply: (s) => s.forms.setValue(nameField.id, SIGNER),
      revert: (s) => s.forms.setValue(nameField.id, initial.name),
      present: (s) => s.doc.fields.find((f) => f.id === nameField.id)?.value === SIGNER,
    },
    {
      step: 2,
      id: "subscribe",
      apply: (s) => s.forms.setValue(box2.id, true),
      revert: (s) => s.forms.setValue(box2.id, initial.subscribe),
      present: (s) => s.doc.fields.find((f) => f.id === box2.id)?.value === true,
    },
    annotItem(session, 2, "site-signature", (id) => {
      const r: Rect = { x: signature.x + 14, y: signature.y + 2, w: Math.min(190, signature.w - 28), h: signature.h - 4 };
      return session.annots.addSignature(pageId, r, { mode: "draw", strokes: scribble(r.w, r.h), color: "#1a237e", width: 1.8 }, { id, ...quiet });
    }),
  ];
  return { pageId, items };
}

/** Brings the session to exactly the state of `step`: what the step has is added (in story order), what it lacks is taken away. */
export function showStep(session: PdfSession, plan: Plan, step: number): void {
  for (const item of [...plan.items].reverse()) if (item.step > step && item.present(session)) item.revert(session);
  for (const item of plan.items) if (item.step <= step && !item.present(session)) item.apply(session);
}

/** The document's content as comparable data: what a step must reproduce. */
export function stateOf(session: PdfSession) {
  return {
    annots: session.doc.pages.map((p) => p.annots),
    fields: session.doc.fields.map((f) => [f.name, f.value] as const),
  };
}
