import {
  applyMarksAll,
  setParagraphProps,
  type Align,
  type DeckSession,
  type Element,
  type Fill,
  type Line,
  type MarksPatch,
  type Paragraph,
  type ResolvedElement,
  type Scene,
  type ShapeElement,
  type TableElement,
} from "@pli.dev/decks";
import type { TextEditApi } from "./TextEditor";
import type { CellRange } from "./SlideCanvas";
import { toggleList, wholeRange, type BulletKind } from "./textedit";

/** Everything a command needs to know about the editor right now. */
export interface CommandContext {
  session: DeckSession;
  owner: string;
  /** Selected element ids. */
  ids: readonly string[];
  scene: Scene;
  cells: CellRange | null;
  text: TextEditApi | null;
}

type ParaPatch = Parameters<typeof setParagraphProps>[2];

function selectedCells(el: TableElement, range: CellRange | null): [number, number][] {
  const cells: [number, number][] = [];
  const r = range ?? { r1: 0, c1: 0, r2: el.rows.length - 1, c2: el.columns.length - 1 };
  for (let ri = r.r1; ri <= r.r2; ri++) for (let ci = r.c1; ci <= r.c2; ci++) if (!el.rows[ri]?.cells[ci]?.covered) cells.push([ri, ci]);
  return cells;
}

function mapCells(el: TableElement, range: CellRange | null, fn: (ps: Paragraph[]) => Paragraph[]): TableElement {
  const keys = new Set(selectedCells(el, range).map(([r, c]) => `${r},${c}`));
  return { ...el, rows: el.rows.map((row, ri) => ({ ...row, cells: row.cells.map((cell, ci) => (keys.has(`${ri},${ci}`) ? { ...cell, paragraphs: fn(cell.paragraphs) } : cell)) })) };
}

const shapesOf = (c: CommandContext): ShapeElement[] => c.ids.map((id) => c.session.element(c.owner, id)).filter((e): e is ShapeElement => e.type === "shape");

/** Character formatting: on the selected text, or on all the text of the selected shapes, tables or cells. */
export function formatMarks(c: CommandContext, patch: MarksPatch): void {
  if (c.text) return c.text.setMarks(patch);
  // placeholders of a layout or master carry their formatting in the text styles slides inherit
  const styled = c.ids.filter((id) => c.session.isTemplateText(c.owner, id));
  if (styled.length) c.session.formatText(c.owner, styled, patch);
  const ops: Element[] = [];
  for (const id of c.ids.filter((x) => !styled.includes(x))) {
    const e = c.session.element(c.owner, id);
    if (e.type === "shape" && e.text) ops.push({ ...e, text: { ...e.text, paragraphs: applyMarksAll(e.text.paragraphs, patch) } });
    else if (e.type === "table") ops.push(mapCells(e, c.cells, (ps) => applyMarksAll(ps, patch)));
  }
  if (ops.length) c.session.updateElements(c.owner, ops.map((e) => e.id), (old) => ops.find((o) => o.id === old.id) ?? old);
}

export function toggleMark(c: CommandContext, key: "bold" | "italic" | "underline" | "strike", current: boolean): void {
  if (c.text) return c.text.toggleMark(key);
  formatMarks(c, { [key]: current ? null : true });
}

export function formatParagraphs(c: CommandContext, patch: ParaPatch): void {
  if (c.text) return c.text.setParagraph(patch);
  const styled = c.ids.filter((id) => c.session.isTemplateText(c.owner, id));
  if (styled.length) c.session.formatParagraphs(c.owner, styled, patch);
  const out: Element[] = [];
  for (const id of c.ids.filter((x) => !styled.includes(x))) {
    const e = c.session.element(c.owner, id);
    if (e.type === "shape" && e.text) out.push({ ...e, text: { ...e.text, paragraphs: setParagraphProps(e.text.paragraphs, wholeRange(e.text.paragraphs), patch) } });
    else if (e.type === "table") out.push(mapCells(e, c.cells, (ps) => setParagraphProps(ps, wholeRange(ps), patch)));
  }
  if (out.length) c.session.updateElements(c.owner, out.map((e) => e.id), (old) => out.find((o) => o.id === old.id) ?? old);
}

export const setAlign = (c: CommandContext, align: Align | null) => formatParagraphs(c, { align });
export const setLineSpacing = (c: CommandContext, lineSpacing: number | null) => formatParagraphs(c, { lineSpacing });
export const setSpaceBefore = (c: CommandContext, v: number | null) => formatParagraphs(c, { spaceBefore: v });
export const setSpaceAfter = (c: CommandContext, v: number | null) => formatParagraphs(c, { spaceAfter: v });

export function setList(c: CommandContext, kind: BulletKind): void {
  if (c.text) return c.text.toggleList(kind);
  const out: Element[] = [];
  for (const el of c.scene.elements.filter((e) => c.ids.includes(e.id))) {
    const e = c.session.element(c.owner, el.id);
    if (e.type === "shape" && e.text && c.session.isTemplateText(c.owner, e.id)) {
      const toggled = toggleList(e.text.paragraphs, wholeRange(e.text.paragraphs), kind, (p) => el.text?.paragraphs[p]);
      c.session.formatTemplateParagraphs(c.owner, e.id, (i) => ({ bullet: toggled[i]?.bullet ?? null, marL: toggled[i]?.marL, indent: toggled[i]?.indent }));
      continue;
    }
    if (e.type === "shape" && e.text) out.push({ ...e, text: { ...e.text, paragraphs: toggleList(e.text.paragraphs, wholeRange(e.text.paragraphs), kind, (p) => el.text?.paragraphs[p]) } });
  }
  if (out.length) c.session.updateElements(c.owner, out.map((e) => e.id), (old) => out.find((o) => o.id === old.id) ?? old);
}

export function indent(c: CommandContext, delta: number): void {
  if (c.text) return c.text.indent(delta);
  const out: Element[] = [];
  for (const el of c.scene.elements.filter((e) => c.ids.includes(e.id))) {
    const e = c.session.element(c.owner, el.id);
    if (e.type === "shape" && e.text && c.session.isTemplateText(c.owner, e.id)) {
      // in the master view an indent moves the level's left margin: the style every paragraph at that level shares
      c.session.formatTemplateParagraphs(c.owner, e.id, (i) => ({ marL: Math.max(0, (el.text?.paragraphs[i]?.marL ?? 0) + delta * 18) }));
      continue;
    }
    if (e.type === "shape" && e.text)
      out.push({
        ...e,
        text: {
          ...e.text,
          paragraphs: e.text.paragraphs.map((p, i) => {
            const rp = el.text?.paragraphs[i];
            const level = Math.min(8, Math.max(0, (rp?.level ?? 0) + delta));
            return { ...p, level: level || undefined, marL: Math.max(0, (rp?.marL ?? 0) + delta * 18) };
          }),
        },
      });
  }
  if (out.length) c.session.updateElements(c.owner, out.map((e) => e.id), (old) => out.find((o) => o.id === old.id) ?? old);
}

export function setVAlign(c: CommandContext, vAlign: "top" | "middle" | "bottom"): void {
  const tables = c.ids.map((id) => c.session.element(c.owner, id)).filter((e): e is TableElement => e.type === "table");
  for (const t of tables) c.session.setTableCells(c.owner, t.id, selectedCells(t, c.cells), { vAlign });
  const shapes = shapesOf(c);
  if (shapes.length) c.session.updateElements(c.owner, shapes.map((s) => s.id), (e) => (e.type === "shape" ? { ...e, text: { paragraphs: [{ runs: [] }], ...e.text, vAlign } } : e));
}

/** Fill of the selected shapes, or of the table cells selected. `undefined` goes back to what the theme gives. */
export function setFill(c: CommandContext, fill: Fill | null | undefined): void {
  for (const id of c.ids) {
    const e = c.session.element(c.owner, id);
    if (e.type === "table") c.session.setTableCells(c.owner, id, selectedCells(e, c.cells), { fill });
  }
  const shapes = shapesOf(c).map((s) => s.id);
  if (shapes.length) c.session.setFill(c.owner, shapes, fill);
}

/** Changes the outline of the selected shapes and pictures (or the borders of table cells). */
export function setLine(c: CommandContext, patch: Partial<Line> | null): void {
  for (const id of c.ids) {
    const e = c.session.element(c.owner, id);
    if (e.type === "table") {
      const b = patch === null ? null : { width: 1, color: "#bfbfbf", ...patch };
      c.session.setTableCells(c.owner, id, selectedCells(e, c.cells), { borders: { top: b, right: b, bottom: b, left: b } });
    }
  }
  const ids = c.ids.filter((id) => {
    const t = c.session.element(c.owner, id).type;
    return t === "shape" || t === "image";
  });
  if (ids.length === 0) return;
  c.session.updateElements(c.owner, ids, (e) => {
    if (e.type !== "shape" && e.type !== "image") return e;
    if (patch === null) return { ...e, line: null };
    const base: Line = e.line ?? { width: 1, color: { theme: "dk1" } };
    // a width of 0 would hide the line: a zero weight asks for no line
    return { ...e, line: { ...base, ...patch } };
  });
}

export function setShadow(c: CommandContext, on: boolean): void {
  c.session.updateElements(c.owner, c.ids.filter((id) => ["shape", "image"].includes(c.session.element(c.owner, id).type)), (e) => (e.type === "shape" || e.type === "image" ? { ...e, shadow: on ? { color: "#00000055", blur: 6, dx: 3, dy: 3 } : null } : e));
}

export function setAlt(c: CommandContext, alt: string): void {
  c.session.updateElements(c.owner, c.ids, { alt: alt || null });
}

export function rotateBy(c: CommandContext, deg: number): void {
  const frames: Record<string, { rotation: number }> = {};
  for (const el of c.scene.elements) if (c.ids.includes(el.id)) frames[el.id] = { rotation: (((el.rotation + deg) % 360) + 360) % 360 };
  if (Object.keys(frames).length) c.session.setFrames(c.owner, frames);
}

export function flip(c: CommandContext, axis: "h" | "v"): void {
  c.session.updateElements(c.owner, c.ids, (e) => (axis === "h" ? { ...e, flipH: !e.flipH } : { ...e, flipV: !e.flipV }) as Element);
}

export const resolvedOf = (c: CommandContext): ResolvedElement[] => c.scene.elements.filter((e) => c.ids.includes(e.id));
