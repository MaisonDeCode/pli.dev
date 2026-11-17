import { createId, PliError } from "@pli.dev/core";
import { analyzeSessionPage } from "../content/read";
import { planFont, type FontPlan } from "../content/rewrite";
import { overlaps } from "../content/interpreter";
import { buildMatcher, searchPage, type PageImage, type PageText, type SearchHit, type SearchOptions, type TextRun } from "../content/text";
import type { Annotation, PageEdit, PdfPicture, Rect, RedactAnnot } from "../model";
import type { PdfOp } from "../ops";
import type { SaveOptions, SaveResult } from "../save";
import type { PdfSession } from "../session";

/** What can be said about a run before it is edited. */
export interface EditableRun {
  id: string;
  text: string;
  box: Rect;
  editable: boolean;
  /** Why not, in plain words. */
  reason?: string;
  /** `same`: the page's own font can write any text you are likely to type; `substitute`: new text will use another font. */
  font: "simple" | "composite" | "type3";
  embedded: boolean;
}

export interface TextEditOptions {
  family?: string;
  /** In points. */
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fit?: "none" | "shrink";
  /** The page the run is on (otherwise every page whose number in its file matches the run id is tried). */
  page?: string;
}

export interface TextEditPlan {
  /** The font new text would be set in: `same` as before, an `embedded` one given in the save options, or a `standard` PDF font. */
  font: FontPlan;
  /** Width of the new text and of the old, in points. */
  width: number;
  oldWidth: number;
  fits: boolean;
  /** What a save would warn about. */
  warnings: string[];
}

export interface ReplaceAllOptions extends Omit<SearchOptions, "regex"> {
  /** Only count: change nothing. */
  dryRun?: boolean;
  /** Only the match that has this point of a page (page space; `page` is 0-based) under it: "replace this one". */
  at?: { page: number; x: number; y: number };
}

/** What `replaceAll` did (or, with `dryRun`, would do). */
export interface ReplaceAllResult {
  /** Matches replaced. */
  replaced: number;
  /** Pieces of text (runs) that changed: each is one edit. */
  runs: number;
  /** Ids of the pages that got edits. */
  pages: string[];
  /** Matches that were found but left alone. */
  skipped: {
    /** Matches that run across two or more pieces of text, which cannot be replaced one piece at a time. */
    spanning: number;
    /** Matches inside text that cannot be edited faithfully (Type 3 fonts, invisible text, vertical writing). */
    notEditable: number;
  };
}

export interface ApplyRedactionsResult {
  /** Pages that got redactions. */
  pages: string[];
  /** Rectangles applied. */
  rects: number;
  /** Other annotations and comment threads that were under a rectangle and are removed with it. */
  removedAnnotations: number;
}

/** The box of an annotation, for deciding what a redaction covers. */
export function annotBounds(a: Annotation): Rect | null {
  const box = (pts: readonly (readonly [number, number])[], pad = 0): Rect | null => {
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  };
  const union = (rs: readonly Rect[]): Rect | null => {
    if (!rs.length) return null;
    const x = Math.min(...rs.map((r) => r.x));
    const y = Math.min(...rs.map((r) => r.y));
    return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
  };
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "redact":
      return union(a.rects);
    case "ink":
      return box(a.strokes.flat(), a.stroke.width / 2);
    case "square":
    case "circle":
    case "freetext":
    case "stamp":
    case "signature":
    case "image":
    case "link":
      return a.rect;
    case "line":
      return box([a.from, a.to], a.stroke.width / 2);
    case "polygon":
    case "polyline":
      return box(a.points, a.stroke.width / 2);
    case "note":
      return { x: a.x, y: a.y, w: 24, h: 24 };
  }
}

/**
 * Where each match of the file's own text is in the text now, when some of the matches were replaced with other words. The text
 * between the matches is what is left as it was, so it is found again in order; what lies between is what each match became.
 * Null when the text was changed in some other way and the matches cannot be told.
 */
function alignMatches(original: string, matches: readonly RegExpMatchArray[], now: string): (readonly [number, number])[] | null {
  const spans: (readonly [number, number])[] = [];
  let prevEnd = 0;
  let pos = 0;
  for (let i = 0; i <= matches.length; i++) {
    const m = matches[i];
    const between = original.slice(prevEnd, m ? m.index! : original.length);
    if (m === undefined) {
      // the last piece must be the end of the text
      if (!now.endsWith(between) || now.length - between.length < pos) return null;
      if (spans.length) spans[spans.length - 1] = [spans[spans.length - 1]![0], now.length - between.length];
      return spans;
    }
    if (i === 0) {
      if (!now.startsWith(between)) return null;
      pos = between.length;
    } else {
      const found = now.indexOf(between, pos);
      if (found < 0) return null;
      spans[spans.length - 1] = [spans[spans.length - 1]![0], found];
      pos = found + between.length;
    }
    spans.push([pos, pos]);
    prevEnd = m.index! + m[0].length;
  }
  return spans;
}

/** Commands on what is drawn on the page itself (text, pictures, redaction): `session.content`. */
export class ContentCommands {
  constructor(protected readonly session: PdfSession) {}

  // ---- reading -----------------------------------------------------------------------------------------------------

  /** Everything read from a page: text, runs with glyph boxes, lines, pictures. */
  async text(pageId: string): Promise<PageText> {
    return (await analyzeSessionPage(this.session, pageId)).text;
  }

  /** The runs of text of a page, in reading order. Their ids are the same every time the same file is read. */
  async runs(pageId: string): Promise<TextRun[]> {
    return (await this.text(pageId)).runs;
  }

  /** The pictures of a page (image objects and inline images). */
  async images(pageId: string): Promise<PageImage[]> {
    return (await this.text(pageId)).images;
  }

  /** Which runs can be edited faithfully, and why not for the others (Type 3 fonts, invisible OCR text, vertical writing). */
  async editableRuns(pageId: string): Promise<EditableRun[]> {
    const { analysis } = await analyzeSessionPage(this.session, pageId);
    if (!analysis) return [];
    const fontOf = new Map(analysis.raws.map((r) => [r.id, r.pieces[0]!.op.font]));
    return analysis.text.runs.map((r) => {
      const f = fontOf.get(r.id)!;
      return { id: r.id, text: r.text, box: r.box, editable: r.editable, ...(r.reason ? { reason: r.reason } : {}), font: f.type3 ? "type3" : f.composite ? "composite" : "simple", embedded: f.embedded };
    });
  }

  /** Finds text in the document. Rectangles are in page space; each hit names its page. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    const hits: SearchHit[] = [];
    const pages = this.session.doc.pages;
    for (let i = 0; i < pages.length; i++) {
      if (options.pages && !options.pages.includes(i)) continue;
      const p = pages[i]!;
      if (!p.from) continue;
      for (const h of searchPage((await analyzeSessionPage(this.session, p.id)).text, query, options)) hits.push({ ...h, page: i, pageId: p.id });
    }
    return hits;
  }

  // ---- redaction -------------------------------------------------------------------------------------------------------

  /**
   * Marks rectangles (page space) for redaction: a `redact` annotation, shown as a box until `applyRedactions`.
   * Returns the annotation's id.
   */
  markRedaction(pageId: string, rects: readonly Rect[], options: { fill?: string; overlay?: string } = {}): string {
    if (rects.length === 0) throw new PliError("invalid_operation", "give at least one rectangle to redact");
    const annot: Omit<RedactAnnot, "id"> = { type: "redact", rects: rects.map((r) => ({ ...r })), ...(options.fill ? { fill: options.fill } : {}), ...(options.overlay ? { overlay: options.overlay } : {}) };
    return this.session.annots.add(pageId, annot);
  }

  /**
   * Marks every match of `query` for redaction (one annotation per match), all in one undo step. Returns their ids, in the
   * order of the document. Nothing is removed until `applyRedactions`.
   */
  async markSearch(query: string, options: SearchOptions & { fill?: string; overlay?: string } = {}): Promise<string[]> {
    const { fill, overlay, ...search } = options;
    const hits = await this.search(query, search);
    const s = this.session;
    const now = s.now();
    const user = s.options.user;
    const last = new Map<string, string | null>();
    const ops: PdfOp[] = [];
    const ids: string[] = [];
    for (const h of hits) {
      if (h.rects.length === 0) continue;
      const page = s.doc.pages.find((p) => p.id === h.pageId)!;
      const annot: RedactAnnot = {
        id: createId("a_"),
        type: "redact",
        rects: h.rects.map((r) => ({ ...r })),
        ...(fill ? { fill } : {}),
        ...(overlay ? { overlay } : {}),
        created: now,
        modified: now,
        ...(user ? { author: user.id, ...(user.name ? { authorName: user.name } : {}) } : {}),
      };
      ops.push({ type: "insert_annot", page: page.id, annot, after: last.has(page.id) ? last.get(page.id)! : (page.annots[page.annots.length - 1]?.id ?? null) });
      last.set(page.id, annot.id);
      ids.push(annot.id);
    }
    if (ops.length) s.transact(ops, { selection: { annots: [] } });
    return ids;
  }

  /**
   * Turns the redaction marks (of these pages, or all) into content edits: each mark's annotation is removed and an
   * edit takes its place, in one undo step. Annotations and comments under the marks are removed too (a note quoting
   * the covered text would give it away). The content itself is cut when the file is saved: `save` then writes a new
   * file with the covered text, pictures and drawings gone for good.
   */
  applyRedactions(pageIds?: readonly string[]): ApplyRedactionsResult {
    const s = this.session;
    const doc = s.doc;
    const ops: PdfOp[] = [];
    const result: ApplyRedactionsResult = { pages: [], rects: 0, removedAnnotations: 0 };
    for (const page of doc.pages) {
      if (pageIds && !pageIds.includes(page.id)) continue;
      const marks = page.annots.filter((a): a is RedactAnnot => a.type === "redact");
      if (marks.length === 0) continue;
      const edits: PageEdit[] = marks.map((m) => ({ id: createId("e_"), type: "redact", rects: m.rects, ...(m.fill ? { fill: m.fill } : {}), ...(m.overlay ? { overlay: m.overlay } : {}) }));
      const rects = marks.flatMap((m) => m.rects);
      for (const m of marks) ops.push({ type: "remove_annot", page: page.id, id: m.id });
      for (const a of page.annots) {
        if (a.type === "redact") continue;
        const b = annotBounds(a);
        if (b && rects.some((r) => overlaps(b, r))) {
          ops.push({ type: "remove_annot", page: page.id, id: a.id });
          result.removedAnnotations++;
        }
      }
      for (const [id, thread] of Object.entries(doc.comments ?? {})) {
        const at = thread.anchor;
        if (at && at.page === page.id && rects.some((r) => at.x >= r.x && at.x <= r.x + r.w && at.y >= r.y && at.y <= r.y + r.h)) {
          ops.push({ type: "set_thread", id, thread: null });
          result.removedAnnotations++;
        }
      }
      ops.push({ type: "set_edits", page: page.id, edits: [...(page.edits ?? []), ...edits] });
      result.pages.push(page.id);
      result.rects += rects.length;
    }
    // form fields whose buttons or boxes are under a mark go too (their value would be a copy of what was covered)
    const rectsByPage = new Map<string, Rect[]>();
    for (const op of ops) if (op.type === "set_edits") rectsByPage.set(op.page, op.edits.filter((e) => e.type === "redact").flatMap((e) => (e.type === "redact" ? e.rects : [])));
    for (const field of doc.fields) {
      const hit = field.widgets.filter((w) => rectsByPage.get(w.page)?.some((r) => overlaps(w.rect, r)));
      if (hit.length === 0) continue;
      if (hit.length === field.widgets.length) ops.push({ type: "remove_field", id: field.id });
      else ops.push({ type: "replace_field", field: { ...field, widgets: field.widgets.filter((w) => !hit.includes(w)) } });
      result.removedAnnotations++;
    }
    if (ops.length) s.transact(ops, { selection: { annots: [] } });
    return result;
  }

  // ---- text and pictures -------------------------------------------------------------------------------------------------

  private async findRun(runId: string, pageHint?: string): Promise<{ pageId: string; text: PageText; run: TextRun }> {
    const m = /^r:(\d+):/.exec(runId);
    if (!m) throw new PliError("invalid_operation", `${runId} is not a run id`);
    const index = Number(m[1]);
    const pages = this.session.doc.pages;
    const candidates = pageHint ? pages.filter((p) => p.id === pageHint) : [...pages.filter((p) => p.from?.index === index && p.id === this.session.selection.page), ...pages.filter((p) => p.from?.index === index)];
    for (const p of candidates) {
      const text = (await analyzeSessionPage(this.session, p.id)).text;
      const run = text.runs.find((r) => r.id === runId);
      if (run) return { pageId: p.id, text, run };
    }
    throw new PliError("not_found", `text run ${runId} not found`);
  }

  private setEdit(pageId: string, edit: PageEdit, same: (e: PageEdit) => boolean): void {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    if (!page) throw new PliError("not_found", `page ${pageId} not found`);
    const edits = [...(page.edits ?? []).filter((e) => !same(e)), edit];
    this.session.transact([{ type: "set_edits", page: pageId, edits }]);
  }

  /**
   * Replaces the text of a run. When the file is saved, the old glyphs are cut out of the content and the new text is
   * drawn at the same baseline: in the page's own font when that font can write it, else a font from
   * `SaveOptions.fonts` (`FontRegistry.pdfFonts`) that matches `family`, else the nearest standard PDF font, and the
   * save then warns that the font was substituted. An empty text removes the run. Returns the edit's id.
   * Not faithful for Type 3 fonts, invisible text layers and vertical text: `editableRuns` says which.
   */
  async replaceText(runId: string, text: string, options: TextEditOptions = {}): Promise<string> {
    const { pageId, run } = await this.findRun(runId, options.page);
    if (!run.editable) throw new PliError("unsupported", run.reason ?? "this text cannot be edited");
    const { page: _page, ...rest } = options;
    const edit: PageEdit = { id: createId("e_"), type: "text", run: runId, text, oldText: run.text, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
    this.setEdit(pageId, edit, (e) => e.type === "text" && e.run === runId);
    return edit.id;
  }

  /**
   * Replaces every match of `query` that lies inside one piece of text (a run) with `replacement`, written as literal text. Each
   * run that changes becomes one text edit, like `replaceText` (an earlier edit of the run, with its font and size, is kept and
   * worked on), and the whole replacement is ONE undo step. Matches that cross two runs, and matches in text that cannot be
   * edited faithfully, are counted in `skipped` and left as they are: nothing is guessed. With `dryRun` nothing changes and the
   * result says what would. With `at`, only the match under that point is replaced.
   */
  async replaceAll(query: string, replacement: string, options: ReplaceAllOptions = {}): Promise<ReplaceAllResult> {
    const { dryRun, at, ...search } = options;
    const result: ReplaceAllResult = { replaced: 0, runs: 0, pages: [], skipped: { spanning: 0, notEditable: 0 } };
    if (!buildMatcher(query, search)) return result;
    const doc = this.session.doc;
    const ops: PdfOp[] = [];
    for (let i = 0; i < doc.pages.length; i++) {
      const page = doc.pages[i]!;
      if (!page.from || (search.pages && !search.pages.includes(i)) || (at && at.page !== i)) continue;
      const text = (await analyzeSessionPage(this.session, page.id)).text;
      // Matches of the page as a whole, to tell how many of them no single run holds.
      const whole = searchPage(text, query, search).length;
      let inRuns = 0;
      let edits = [...(page.edits ?? [])];
      let changed = false;
      for (const run of text.runs) {
        const re = buildMatcher(query, search)!;
        const own = [...run.text.matchAll(re)].filter((m) => m[0].length > 0);
        inRuns += own.length;
        if (own.length === 0) continue;
        if (!run.editable) {
          if (!at) result.skipped.notEditable += own.length;
          continue;
        }
        const pending = edits.find((e): e is Extract<PageEdit, { type: "text" }> => e.type === "text" && e.run === run.id);
        const current = pending ? pending.text : run.text;
        let count = 0;
        let next = current;
        if (at) {
          // The match under the point, by the glyph boxes of the file's own text; the text now may have had other matches replaced.
          const k = own.findIndex((m) => run.glyphs.slice(m.index!, m.index! + m[0].length).some((g) => at.x >= g.box.x - 0.5 && at.x <= g.box.x + g.box.w + 0.5 && at.y >= g.box.y - 0.5 && at.y <= g.box.y + g.box.h + 0.5));
          if (k < 0) continue;
          const spans = current === run.text ? own.map((m) => [m.index!, m.index! + m[0].length] as const) : alignMatches(run.text, own, current);
          const span = spans?.[k];
          // Already replaced, or the text was changed some other way: there is nothing to say which match this is.
          if (!span || current.slice(span[0], span[1]) !== own[k]![0]) continue;
          next = current.slice(0, span[0]) + replacement + current.slice(span[1]);
          count = 1;
        } else {
          next = current.replace(buildMatcher(query, search)!, () => (count++, replacement));
        }
        if (count === 0) continue;
        result.replaced += count;
        result.runs++;
        changed = true;
        if (dryRun) continue;
        const kept = pending ? Object.fromEntries(Object.entries(pending).filter(([k]) => !["id", "type", "run", "text", "oldText"].includes(k))) : {};
        const edit: PageEdit = { id: createId("e_"), type: "text", run: run.id, text: next, oldText: run.text, ...kept } as PageEdit;
        edits = [...edits.filter((e) => !(e.type === "text" && e.run === run.id)), edit];
      }
      if (!at) result.skipped.spanning += Math.max(0, whole - inRuns);
      if (changed) {
        result.pages.push(page.id);
        if (!dryRun) ops.push({ type: "set_edits", page: page.id, edits });
      }
    }
    if (ops.length) this.session.transact(ops);
    return result;
  }

  /**
   * What replacing a run's text would do, before you do it: which font would be used, whether the text fits, and what a
   * save would warn about. `fonts` is what you would pass in `SaveOptions.fonts`.
   */
  async planText(runId: string, text: string, options: TextEditOptions = {}, fonts?: Record<string, Uint8Array>): Promise<TextEditPlan> {
    const { pageId } = await this.findRun(runId, options.page);
    const { analysis } = await analyzeSessionPage(this.session, pageId);
    const raw = analysis!.raws.find((r) => r.id === runId)!;
    const op = raw.pieces[0]!.op;
    const font = planFont(op, { text, family: options.family, bold: options.bold, italic: options.italic }, fonts, analysis!.interpreter.used.get(op.font));
    const scale = op.em / (Math.abs(op.size) || 1);
    const size = options.size ? options.size / scale : op.size;
    const width = font.widthEm * Math.abs(size) * op.th * scale;
    const first = op.glyphs[raw.pieces[0]!.from]!;
    const lastPiece = raw.pieces[raw.pieces.length - 1]!;
    const last = lastPiece.op.glyphs[lastPiece.to - 1]!;
    const oldWidth = (last.end_[0] - first.origin[0]) * op.dir[0] + (last.end_[1] - first.origin[1]) * op.dir[1];
    const fits = width <= oldWidth * 1.01 + 0.5;
    return { font, width, oldWidth, fits, warnings: [...font.notes, ...(fits ? [] : [`The new text is wider than the old (${Math.round(width)} pt against ${Math.round(oldWidth)} pt).`])] };
  }

  /**
   * Replaces a picture (see `images`) with another in the same box, or removes it (`null`). `picture.src` is a PNG or JPEG
   * data URI, or a web address: an address is fetched when the file is saved (`SaveOptions.fetch`, by default
   * `globalThis.fetch`) and embedded. If it cannot be fetched or is not a PNG or JPEG, the save warns and the old picture
   * is kept. Otherwise the old picture is gone from the saved file. Returns the edit's id.
   */
  async replaceImage(imageId: string, picture: PdfPicture | null, options: { page?: string; fit?: "contain" | "stretch" } = {}): Promise<string> {
    const pages = this.session.doc.pages;
    const order = options.page ? pages.filter((p) => p.id === options.page) : [...pages.filter((p) => p.id === this.session.selection.page), ...pages.filter((p) => p.id !== this.session.selection.page)];
    for (const p of order) {
      if (!p.from) continue;
      const { text } = await analyzeSessionPage(this.session, p.id);
      if (text.images.some((i) => i.id === imageId)) {
        const edit: PageEdit = { id: createId("e_"), type: "image", target: imageId, picture, ...(options.fit ? { fit: options.fit } : {}) };
        this.setEdit(p.id, edit, (e) => e.type === "image" && e.target === imageId);
        return edit.id;
      }
    }
    throw new PliError("not_found", `picture ${imageId} not found`);
  }

  /** Takes back one staged edit (a text or picture change, or applied redactions) by its id. Does nothing when it is not there. */
  removeEdit(editId: string): void {
    for (const page of this.session.doc.pages) {
      if (!page.edits?.some((e) => e.id === editId)) continue;
      this.session.transact([{ type: "set_edits", page: page.id, edits: page.edits.filter((e) => e.id !== editId) }]);
      return;
    }
  }

  /** Takes back the staged edits of a page (redactions that were applied, text and picture changes). */
  clearEdits(pageId: string): void {
    const page = this.session.doc.pages.find((p) => p.id === pageId);
    if (!page) throw new PliError("not_found", `page ${pageId} not found`);
    if (!page.edits?.length) return;
    this.session.transact([{ type: "set_edits", page: pageId, edits: [] }]);
  }

  /**
   * The font families the staged text edits will need, and all the new text, so a host can fetch them before saving:
   * `const { families, text } = await session.content.editFonts(); const { fonts } = await registry.pdfFonts(families, { text }); await session.save({ fonts })`.
   */
  async editFonts(): Promise<{ families: string[]; text: string }> {
    const families = new Set<string>();
    let text = "";
    for (const page of this.session.doc.pages) {
      const edits = (page.edits ?? []).filter((e): e is Extract<PageEdit, { type: "text" }> => e.type === "text");
      if (!edits.length || !page.from) continue;
      const runs = (await analyzeSessionPage(this.session, page.id)).text.runs;
      for (const e of edits) {
        const family = e.family ?? runs.find((r) => r.id === e.run)?.font.family;
        if (family) families.add(family);
        text += e.text;
      }
    }
    return { families: [...families], text: [...new Set(text)].join("") };
  }

  /**
   * Saves a new file without what identifies the document: information (title, author...), XMP metadata, attached
   * files, JavaScript, thumbnails and private application data. Like `save` with `scrub`, but always a new file.
   */
  async scrubMetadata(options: Omit<SaveOptions, "scrub" | "mode"> = {}): Promise<SaveResult> {
    return this.session.saveDetailed({ ...options, mode: "rewrite", scrub: true });
  }
}
