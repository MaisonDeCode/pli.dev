import { PliError, type CommentClient } from "@pli.dev/core";
import {
  CHART_TYPES,
  DeckSession,
  deckEditorSession,
  deckSyncModel,
  createDeck,
  fromPptx,
  paragraphText,
  paragraphsFromText,
  parseDeck,
  serializeDeck,
  toPdf,
  toPptx,
  type Deck,
  type Element,
  type ShapeElement,
} from "@pli.dev/decks";
import { methodsFor } from "../catalogs";
import { utf8Text, type Ctx, type EditorDef } from "../runtime";

const deck = (ctx: Ctx) => ctx.session as DeckSession;
const nil = <T>(value: T | null | undefined): T | undefined => (value === null ? undefined : value);

/** The text of an element: a shape's paragraphs, or nothing. */
function textOf(element: Element): string | null {
  const body = (element as ShapeElement).text;
  return body ? body.paragraphs.map(paragraphText).join("\n") : null;
}

function elementInfo(e: Element) {
  return {
    id: e.id,
    type: e.type,
    name: e.name ?? null,
    x: e.x ?? null,
    y: e.y ?? null,
    w: e.w ?? null,
    h: e.h ?? null,
    rotation: e.rotation ?? null,
    text: textOf(e),
    placeholder: e.placeholder?.type ?? null,
  };
}

function slideInfo(s: DeckSession, id: string) {
  const slide = s.slide(id);
  const title = slide.elements.find((e) => e.placeholder?.type === "title" || e.placeholder?.type === "ctrTitle");
  return { id: slide.id, name: slide.name ?? null, layout: slide.layout, title: title ? textOf(title) : null, notes: slide.notes, skipped: !!slide.skipped, elements: slide.elements.length };
}

const run: EditorDef["run"] = {
  title: (c) => deck(c).deck.title,
  setTitle: (c, [title]) => deck(c).setTitle(title as string),
  size: (c) => deck(c).deck.size,
  setSize: (c, [width, height, scale]) => deck(c).setSize({ width: width as number, height: height as number }, scale as boolean),
  slides: (c) => deck(c).deck.slides.map((s) => slideInfo(deck(c), s.id)),
  layouts: (c) => deck(c).deck.masters.flatMap((m) => m.layouts.map((l) => ({ id: l.id, name: l.name, master: m.id }))),
  elements: (c, [owner]) => deck(c).elementsOf(owner as string).map(elementInfo),
  notes: (c, [slide]) => deck(c).slide(slide as string).notes,
  find: (c, [query, matchCase, notes]) => deck(c).find(query as string, { matchCase: nil(matchCase as boolean | null), notes: nil(notes as boolean | null) }),
  addSlide: (c, [layout, after]) => slideInfo(deck(c), deck(c).addSlide({ layout: nil(layout as string | null), after: nil(after as string | null) }).id),
  duplicateSlides: (c, [ids]) => deck(c).duplicateSlides(ids as string[]).map((s) => s.id),
  deleteSlides: (c, [ids]) => deck(c).deleteSlides(ids as string[]),
  moveSlides: (c, [ids, to]) => deck(c).moveSlides(ids as string[], to as number),
  renameSlide: (c, [slide, name]) => deck(c).renameSlide(slide as string, name as string),
  setNotes: (c, [slide, notes]) => deck(c).setNotes(slide as string, notes as string),
  setSkipped: (c, [ids, skipped]) => deck(c).setSkipped(ids as string[], skipped as boolean),
  setLayout: (c, [slide, layout]) => deck(c).setLayout(slide as string, layout as string),
  setBackground: (c, [ids, fill]) => deck(c).setBackground(ids as string[], (fill as never) ?? null),
  setTransition: (c, [ids, transition]) => deck(c).setTransition(ids as string[], (transition as never) ?? null),
  addTextBox: (c, [owner, x, y, w, h, text]) => deck(c).addTextBox(owner as string, { x: x as number, y: y as number, w: w as number, h: h as number }, text as string).id,
  addShape: (c, [owner, geometry, x, y, w, h]) => deck(c).addShape(owner as string, geometry as string, { x: x as number, y: y as number, w: w as number, h: h as number }).id,
  addImage: (c, [owner, src, width, height, x, y]) =>
    deck(c).addImage(owner as string, src as string, { w: width as number, h: height as number }, x === null || x === undefined || y === null || y === undefined ? undefined : { x: x as number, y: y as number }).id,
  addTable: (c, [owner, rows, columns]) => deck(c).addTable(owner as string, rows as number, columns as number).id,
  addChart: (c, [owner, chartType]) => {
    if (!CHART_TYPES.includes(chartType as never)) throw new PliError("invalid_operation", `A chart is one of ${CHART_TYPES.join(", ")}`);
    return deck(c).addChart(owner as string, chartType as never).id;
  },
  setText: (c, [owner, element, text]) => {
    const s = deck(c);
    const found = s.element(owner as string, element as string) as ShapeElement;
    if (found.type !== "shape") throw new PliError("invalid_operation", "Only a shape has text to set");
    // The first run's look is kept, so replacing the words doesn't strip the formatting.
    const marks = found.text?.paragraphs[0]?.runs[0]?.marks;
    s.setText(owner as string, element as string, paragraphsFromText(text as string, marks));
  },
  formatText: (c, [owner, ids, patch]) => deck(c).formatText(owner as string, ids as string[], patch as never),
  setFrame: (c, [owner, element, x, y, w, h, rotation]) => {
    const frame: Record<string, number> = {};
    for (const [k, v] of Object.entries({ x, y, w, h, rotation })) if (v !== null && v !== undefined) frame[k] = v as number;
    deck(c).setFrame(owner as string, element as string, frame);
  },
  moveBy: (c, [owner, ids, dx, dy]) => deck(c).moveBy(owner as string, ids as string[], dx as number, dy as number),
  setFill: (c, [owner, ids, fill]) => deck(c).setFill(owner as string, ids as string[], (fill as never) ?? null),
  deleteElements: (c, [owner, ids]) => deck(c).deleteElements(owner as string, ids as string[]),
  duplicateElements: (c, [owner, ids]) => deck(c).duplicateElements(owner as string, ids as string[]),
  arrange: (c, [owner, ids, how]) => deck(c).arrange(owner as string, ids as string[], how as never),
  align: (c, [owner, ids, how]) => deck(c).align(owner as string, ids as string[], how as never),
  group: (c, [owner, ids]) => deck(c).group(owner as string, ids as string[]),
  ungroup: (c, [owner, id]) => deck(c).ungroup(owner as string, id as string),
  replaceAll: (c, [query, replacement, matchCase, notes]) => deck(c).replaceAll(query as string, replacement as string, { matchCase: nil(matchCase as boolean | null), notes: nil(notes as boolean | null) }),

  commentOnSlide: (c, [slide, body, mentions]) => deck(c).comments.commentOnSlide(slide as string, body as string, undefined, (mentions as string[] | null) ?? undefined),
  commentOnElement: (c, [slide, element, body, mentions]) => deck(c).comments.commentOnElement(slide as string, element as string, body as string, (mentions as string[] | null) ?? undefined),
  threadsOn(c, [slide, element]) {
    const id = deck(c).slide(slide as string).id;
    return c.comments!.threads.filter((t) => {
      const anchor = t.anchor as { slide?: string; element?: string } | undefined;
      return anchor?.slide === id && (element === null || element === undefined || anchor.element === element);
    });
  },

  undo: (c) => deck(c).undo(),
  redo: (c) => deck(c).redo(),
};

export const decksEditor: EditorDef = {
  kind: "decks",
  methods: methodsFor("decks"),
  run,

  open(ctx, input, options) {
    let value: Deck;
    if (input.format === "pptx") {
      const result = fromPptx(input.bytes!);
      value = result.deck;
      ctx.extra.warnings = result.warnings;
    } else if (input.text) value = parseDeck(input.text);
    else value = createDeck({ title: options.title });
    const session = new DeckSession(value);
    ctx.session = session;
    ctx.core = session.core;
    ctx.file = value.id;
  },

  comments: (ctx, _options, store) => deck(ctx).comments.enable({ users: ctx.users, store: store ?? "document" }) as CommentClient<any>,
  editorSession: (ctx) => deckEditorSession(deck(ctx)),
  syncing: (ctx, on) => void (deck(ctx).syncing = on),

  serialize: (ctx) => serializeDeck(deck(ctx).deck),
  parse: (text) => parseDeck(text),
  create: () => createDeck({}),
  model: () => deckSyncModel,
  state: (ctx) => ({ slides: deck(ctx).deck.slides.length, warnings: (ctx.extra.warnings as string[] | undefined) ?? [] }),

  exportFile(ctx, format, options) {
    const d = deck(ctx).deck;
    switch (format) {
      case "pptx":
        return toPptx(d);
      case "json":
        return serializeDeck(d);
      case "pdf": {
        const result = toPdf(d, { slides: Array.isArray(options.slides) ? options.slides : undefined });
        return result.bytes;
      }
      default:
        throw new PliError("unsupported", `Decks export as pptx, pdf or json, not ${format}`);
    }
  },

  importFile(ctx, format, input) {
    const s = deck(ctx);
    let warnings: string[] = [];
    if (format === "pptx") {
      const result = fromPptx(input.bytes!);
      warnings = result.warnings;
      s.load(result.deck);
    } else if (format === "json") s.load(parseDeck(input.text ?? utf8Text(input.bytes!)));
    else throw new PliError("unsupported", `Decks import pptx or json, not ${format}`);
    ctx.file = s.deck.id;
    return { warnings };
  },
};
