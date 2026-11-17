import { PliError } from "@pli.dev/core";
import { readImage } from "./image";
import { cleanLink } from "./link";
import type { Cell, NoteBox, NoteDash, NoteRun } from "./model";

/*
 * What a note is besides its text: runs that give parts of it a look, who wrote it, and the box it is drawn in. The text
 * itself stays `Cell.note` (a plain string), so everything that only knows plain notes keeps working; the extras are
 * `noteRuns`, `noteAuthor` and `noteBox` on the same cell, and are dropped whenever the note goes.
 */

/** The font and size a note's text has unless a run says otherwise (Excel's own for notes). */
export const NOTE_FONT = "Tahoma";
export const NOTE_FONT_SIZE = 9;
/** How far the box of a note is from its cell, and how big it is, when it has no box of its own. Pixels. */
export const NOTE_BOX_DEFAULTS = { width: 144, height: 80, dx: 15, dy: -10 } as const;
export const MIN_NOTE_WIDTH = 32;
export const MIN_NOTE_HEIGHT = 20;
export const MAX_NOTE_SIZE = 2000;
const MAX_OFFSET = 10_000;
export const MAX_AUTHOR_LENGTH = 255;
const COLOR = /^#[0-9a-f]{6}$/i;
/** The colour Excel fills a note's box with unless told otherwise. */
export const NOTE_FILL = "#ffffe1";
/** The weight, in points, of the line round a note's box unless told otherwise. */
export const NOTE_LINE_WEIGHT = 0.75;
export const MAX_NOTE_LINE_WEIGHT = 100;
/** The dash styles of a note's line, as VML names them in lower case. */
export const NOTE_DASHES: readonly NoteDash[] = ["solid", "dot", "dash", "dashDot", "longDash", "longDashDot", "longDashDotDot", "shortDash", "shortDot", "shortDashDot", "shortDashDotDot"];
/** The properties of a note's box that are its look rather than its size and place. */
export const NOTE_LOOK_KEYS = ["fill", "transparency", "picture", "line", "lineWeight", "dash", "shadow"] as const;

/** The look a run can have, with `null` standing for taking one off. */
export interface NoteRunStyle {
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  strike?: boolean | null;
  color?: string | null;
  size?: number | null;
  font?: string | null;
  /** Where the text leads; `null` takes the link off. */
  link?: string | null;
}

/** The look of a note's box that can be changed: `null` takes one off (back to Excel's usual). */
export type NoteLookPatch = { [K in Exclude<(typeof NOTE_LOOK_KEYS)[number], "shadow">]?: NoteBox[K] | null } & { shadow?: boolean | null };

/** What a cell's note has. */
export interface NoteInfo {
  text: string;
  runs?: NoteRun[];
  author?: string;
  box?: NoteBox;
}

/** What `setNote` can be told besides the text. */
export interface SetNoteOptions {
  /** `null` makes the note plain. */
  runs?: NoteRun[] | null;
  /** `null` takes the author off. */
  author?: string | null;
  /** `null` gives the note the usual box. */
  box?: NoteBox | null;
}

const FLAGS = ["bold", "italic", "underline", "strike"] as const;

const bad = (message: string): never => {
  throw new PliError("invalid_operation", message);
};

/** Whether two runs look the same. */
export function sameLook(a: NoteRun, b: NoteRun): boolean {
  return FLAGS.every((k) => !!a[k] === !!b[k]) && (a.color ?? "") === (b.color ?? "") && a.size === b.size && (a.font ?? "") === (b.font ?? "") && (a.link ?? "") === (b.link ?? "");
}

const plain = (r: NoteRun) => !FLAGS.some((k) => r[k]) && r.color === undefined && r.size === undefined && r.font === undefined && r.link === undefined;

/** Runs without empty ones, with neighbours that look alike joined. */
export function joinRuns(runs: readonly NoteRun[]): NoteRun[] {
  const out: NoteRun[] = [];
  for (const r of runs) {
    if (r.text === "") continue;
    const last = out[out.length - 1];
    if (last && sameLook(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** The text the runs add up to. */
export function runsText(runs: readonly NoteRun[]): string {
  return runs.map((r) => r.text).join("");
}

/** One run after checking: only known properties, with sensible values. Throws on one that is not. */
function checkRun(raw: unknown, at: string): NoteRun {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return bad(`${at} is not a run of text`);
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(r)) if (k !== "text" && k !== "color" && k !== "size" && k !== "font" && k !== "link" && !(FLAGS as readonly string[]).includes(k)) bad(`${at} has "${k}", which is not part of a run`);
  if (typeof r["text"] !== "string") bad(`${at} needs text`);
  const out: NoteRun = { text: r["text"] as string };
  for (const k of FLAGS) {
    if (r[k] === undefined || r[k] === false) continue;
    if (r[k] !== true) bad(`${at}.${k} is true or left out`);
    out[k] = true;
  }
  if (r["color"] !== undefined) {
    if (typeof r["color"] !== "string" || !COLOR.test(r["color"])) bad(`${at}.color is a colour like #rrggbb`);
    out.color = (r["color"] as string).toLowerCase();
  }
  if (r["size"] !== undefined) {
    const n = r["size"];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 409) bad(`${at}.size is a number of points from 1 to 409`);
    out.size = Math.round((n as number) * 2) / 2;
  }
  if (r["font"] !== undefined) {
    if (typeof r["font"] !== "string" || r["font"].trim() === "" || r["font"].length > 64 || /[<>"&;{}]/.test(r["font"])) bad(`${at}.font is a font name`);
    out.font = (r["font"] as string).trim();
  }
  if (r["link"] !== undefined) {
    if (typeof r["link"] !== "string") bad(`${at}.link is an address`);
    out.link = cleanLink({ to: r["link"] as string }).to;
  }
  return out;
}

/** The message of the refusal for runs that don't match the note's text. */
export const RUNS_MISMATCH = "The runs of a note have to add up to its text";

/**
 * The runs of a note after checking them against its text. Runs that don't add up to the text are an error; none, or all
 * of the default look, mean a plain note (undefined).
 */
export function cleanNoteRuns(note: string, runs: unknown): NoteRun[] | undefined {
  if (runs === undefined || runs === null) return undefined;
  if (!Array.isArray(runs)) return bad("The runs of a note are a list");
  const checked = joinRuns(runs.map((r, i) => checkRun(r, `Run ${i + 1}`)));
  if (runsText(checked) !== note) return bad(RUNS_MISMATCH);
  return checked.every(plain) ? undefined : checked;
}

/** The note's runs, or the whole text as one run. */
export function noteRunsOf(cell: Pick<Cell, "note" | "noteRuns">): NoteRun[] {
  return cell.noteRuns ?? (cell.note === undefined || cell.note === "" ? [] : [{ text: cell.note }]);
}

/** Just the look (fill, picture, line, shadow) of a note's box, without its size, place and visibility. */
export function noteLookOf(box: NoteBox | undefined): Partial<NoteBox> {
  const out: Record<string, unknown> = {};
  for (const k of NOTE_LOOK_KEYS) if (box?.[k] !== undefined) out[k] = box[k];
  return out as Partial<NoteBox>;
}

/** A box after checking: whole pixel sizes within limits. Undefined when there is nothing in it. */
export function cleanNoteBox(box: unknown): NoteBox | undefined {
  if (box === undefined || box === null) return undefined;
  if (typeof box !== "object" || Array.isArray(box)) return bad("The box of a note is an object");
  const b = box as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!["width", "height", "dx", "dy", "show", ...NOTE_LOOK_KEYS].includes(k)) bad(`The box of a note has "${k}", which it doesn't use`);
  const out: NoteBox = {};
  const num = (k: "width" | "height" | "dx" | "dy", min: number, max: number) => {
    const v = b[k];
    if (v === undefined) return;
    if (typeof v !== "number" || !Number.isFinite(v)) bad(`The ${k} of a note's box is a number of pixels`);
    out[k] = Math.round(Math.min(max, Math.max(min, v as number)));
  };
  num("width", MIN_NOTE_WIDTH, MAX_NOTE_SIZE);
  num("height", MIN_NOTE_HEIGHT, MAX_NOTE_SIZE);
  num("dx", -MAX_OFFSET, MAX_OFFSET);
  num("dy", -MAX_OFFSET, MAX_OFFSET);
  if (b["show"] !== undefined && b["show"] !== false) {
    if (b["show"] !== true) bad("The show of a note's box is true or left out");
    out.show = true;
  }
  const color = (k: "fill" | "line", allowNone: boolean) => {
    const v = b[k];
    if (v === undefined) return;
    if (typeof v !== "string") return bad(`The ${k} of a note's box is a colour like #rrggbb`);
    if (allowNone && v === "none") out[k] = "none";
    else if (COLOR.test(v)) out[k] = v.toLowerCase();
    else bad(`The ${k} of a note's box is a colour like #rrggbb${allowNone ? " or \"none\"" : ""}`);
  };
  color("fill", false);
  color("line", true);
  if (out.fill === NOTE_FILL) delete out.fill;
  if (b["transparency"] !== undefined) {
    const t = b["transparency"];
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > 100) bad("The transparency of a note's box is a percentage from 0 to 100");
    if ((t as number) > 0) out.transparency = Math.round(t as number);
  }
  if (b["picture"] !== undefined) {
    if (typeof b["picture"] !== "string") bad("The picture of a note's box is a data: address of a PNG, JPEG or GIF");
    readImage(b["picture"] as string);
    out.picture = b["picture"] as string;
  }
  if (b["lineWeight"] !== undefined) {
    const w = b["lineWeight"];
    if (typeof w !== "number" || !Number.isFinite(w) || w <= 0 || w > MAX_NOTE_LINE_WEIGHT) bad(`The line weight of a note's box is a number of points from 0.25 to ${MAX_NOTE_LINE_WEIGHT}`);
    const rounded = Math.max(0.25, Math.round((w as number) * 4) / 4);
    if (rounded !== NOTE_LINE_WEIGHT) out.lineWeight = rounded;
  }
  if (b["dash"] !== undefined) {
    if (typeof b["dash"] !== "string" || !NOTE_DASHES.includes(b["dash"] as NoteDash)) bad(`The dash of a note's line is one of ${NOTE_DASHES.join(", ")}`);
    if (b["dash"] !== "solid") out.dash = b["dash"] as NoteDash;
  }
  if (b["shadow"] !== undefined && b["shadow"] !== true) {
    if (b["shadow"] !== false) bad("The shadow of a note's box is false or left out");
    out.shadow = false;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The author after checking; empty is none. */
export function cleanAuthor(author: unknown): string | undefined {
  if (author === undefined || author === null) return undefined;
  if (typeof author !== "string") return bad("A note's author is text");
  const t = author.replace(/[\u0000-\u001f]/g, " ").trim();
  if (t.length > MAX_AUTHOR_LENGTH) return bad(`A note's author can be at most ${MAX_AUTHOR_LENGTH} characters`);
  return t === "" ? undefined : t;
}

/**
 * Brings the extras of a note into line with its text: they go when the note does, runs that no longer add up to the text
 * are dropped (the text wins), and a box, author or run that isn't valid is an error. Changes the cell in place.
 */
export function cleanNoteExtras(cell: Cell): Cell {
  if (cell.note === undefined) {
    delete cell.noteRuns;
    delete cell.noteAuthor;
    delete cell.noteBox;
    return cell;
  }
  if (cell.noteRuns !== undefined) {
    let runs: NoteRun[] | undefined;
    try {
      runs = cleanNoteRuns(cell.note, cell.noteRuns);
    } catch (e) {
      if (e instanceof PliError && e.message === RUNS_MISMATCH) runs = undefined;
      else throw e;
    }
    if (runs) cell.noteRuns = runs;
    else delete cell.noteRuns;
  }
  if (cell.noteAuthor !== undefined) {
    const a = cleanAuthor(cell.noteAuthor);
    if (a) cell.noteAuthor = a;
    else delete cell.noteAuthor;
  }
  if (cell.noteBox !== undefined) {
    const b = cleanNoteBox(cell.noteBox);
    if (b) cell.noteBox = b;
    else delete cell.noteBox;
  }
  return cell;
}

type Extras = Pick<Cell, "noteRuns" | "noteAuthor" | "noteBox">;

/** The extras of a note, to carry along with `note` when a cell is rebuilt. */
export function noteExtras(cell: Extras): Extras {
  return { ...(cell.noteRuns ? { noteRuns: cell.noteRuns } : {}), ...(cell.noteAuthor ? { noteAuthor: cell.noteAuthor } : {}), ...(cell.noteBox ? { noteBox: cell.noteBox } : {}) };
}

/** Whether two cells' notes differ in anything but their text (protection counts the look, author and box as part of the note). */
export function noteExtrasDiffer(a: Cell | undefined, b: Cell | undefined): boolean {
  return JSON.stringify(noteExtras(a ?? {})) !== JSON.stringify(noteExtras(b ?? {}));
}

/** Gives the characters from `from` to `to` (offsets in the text) the look in `patch`, and joins what looks alike. Undefined when the note is plain again. */
export function styleNoteRuns(note: string, runs: readonly NoteRun[] | undefined, from: number, to: number, patch: NoteRunStyle): NoteRun[] | undefined {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(note.length, Math.max(from, to));
  const source = runs ?? [{ text: note }];
  if (hi <= lo) return runs ? [...runs] : undefined;
  const out: NoteRun[] = [];
  let at = 0;
  for (const run of source) {
    const end = at + run.text.length;
    const a = Math.max(lo, at);
    const b = Math.min(hi, end);
    if (b <= a) {
      out.push({ ...run });
    } else {
      if (a > at) out.push({ ...run, text: run.text.slice(0, a - at) });
      const mid: NoteRun = { ...run, text: run.text.slice(a - at, b - at) };
      for (const k of FLAGS) {
        if (patch[k] === undefined) continue;
        if (patch[k]) mid[k] = true;
        else delete mid[k];
      }
      if (patch.color !== undefined) {
        if (patch.color === null) delete mid.color;
        else mid.color = patch.color.toLowerCase();
      }
      if (patch.size !== undefined) {
        if (patch.size === null) delete mid.size;
        else mid.size = patch.size;
      }
      if (patch.font !== undefined) {
        if (patch.font === null) delete mid.font;
        else mid.font = patch.font;
      }
      if (patch.link !== undefined) {
        if (patch.link === null) delete mid.link;
        else mid.link = cleanLink({ to: patch.link }).to;
      }
      out.push(mid);
      if (b < end) out.push({ ...run, text: run.text.slice(b - at) });
    }
    at = end;
  }
  const joined = joinRuns(out);
  return joined.every(plain) ? undefined : joined;
}

/** The note's text with `insert` (runs, each with its own look) in place of the characters from `from` to `to`. Undefined runs when the result is plain. */
export function spliceNoteRuns(note: string, runs: readonly NoteRun[] | undefined, from: number, to: number, insert: readonly NoteRun[]): { note: string; runs: NoteRun[] | undefined } {
  const lo = Math.max(0, Math.min(from, to, note.length));
  const hi = Math.min(note.length, Math.max(from, to));
  const part = (a: number, b: number): NoteRun[] => {
    const out: NoteRun[] = [];
    let at = 0;
    for (const run of runs ?? [{ text: note }]) {
      const end = at + run.text.length;
      const x = Math.max(a, at);
      const y = Math.min(b, end);
      if (y > x) out.push({ ...run, text: run.text.slice(x - at, y - at) });
      at = end;
    }
    return out;
  };
  const joined = joinRuns([...part(0, lo), ...insert, ...part(hi, note.length)]);
  return { note: runsText(joined), runs: joined.every(plain) ? undefined : joined };
}

/** Whether every character from `from` to `to` has the look. */
export function noteRunsAllHave(note: string, runs: readonly NoteRun[] | undefined, from: number, to: number, flag: (typeof FLAGS)[number]): boolean {
  const source = runs ?? [{ text: note }];
  let at = 0;
  let seen = false;
  for (const run of source) {
    const end = at + run.text.length;
    if (Math.min(to, end) > Math.max(from, at)) {
      seen = true;
      if (!run[flag]) return false;
    }
    at = end;
  }
  return seen;
}

/** A place in a note's text to put other text in, in place of what is there. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * The note after the edits (which must be in order and not overlap). New text takes the look of the run where the text it
 * replaces begins, so a word swapped inside one run keeps that run's look, and the rest of the note keeps its own.
 */
export function editNoteRuns(note: string, runs: readonly NoteRun[] | undefined, edits: readonly TextEdit[]): { note: string; runs: NoteRun[] | undefined } {
  const source = runs ?? [{ text: note }];
  const out: NoteRun[] = [];
  let text = "";
  let pos = 0;
  /** Adds the source characters from `pos` to `to`, run by run. */
  const keep = (to: number) => {
    let at = 0;
    for (const run of source) {
      const end = at + run.text.length;
      const a = Math.max(pos, at);
      const b = Math.min(to, end);
      if (b > a) {
        out.push({ ...run, text: run.text.slice(a - at, b - at) });
        text += run.text.slice(a - at, b - at);
      }
      at = end;
    }
    pos = Math.max(pos, to);
  };
  const lookAt = (i: number): NoteRun => {
    let at = 0;
    for (const run of source) {
      const end = at + run.text.length;
      if (i < end) return run;
      at = end;
    }
    return source[source.length - 1] ?? { text: "" };
  };
  for (const e of edits) {
    keep(e.start);
    if (e.text !== "") out.push({ ...lookAt(e.start), text: e.text });
    text += e.text;
    pos = e.end;
  }
  keep(note.length);
  const joined = joinRuns(out);
  return { note: text, runs: joined.every(plain) ? undefined : joined };
}

/** Where a note's box is in pixels from the sheet's corner, given where its cell's top right corner is. A box never starts above or left of the sheet. */
export function noteBoxPx(cellRight: number, cellTop: number, box: NoteBox | undefined): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.max(0, cellRight + (box?.dx ?? NOTE_BOX_DEFAULTS.dx)),
    top: Math.max(0, cellTop + (box?.dy ?? NOTE_BOX_DEFAULTS.dy)),
    width: box?.width ?? NOTE_BOX_DEFAULTS.width,
    height: box?.height ?? NOTE_BOX_DEFAULTS.height,
  };
}

/** The box that puts a note's box at `px` (from the sheet's corner) for a cell whose top right corner is at `cellRight`, `cellTop`; whatever is the default is left out. */
export function noteBoxFromPx(cellRight: number, cellTop: number, px: { left: number; top: number; width: number; height: number }, show?: boolean): NoteBox | undefined {
  const out: NoteBox = {};
  const def = noteBoxPx(cellRight, cellTop, undefined);
  if (Math.round(px.width) !== NOTE_BOX_DEFAULTS.width) out.width = Math.round(px.width);
  if (Math.round(px.height) !== NOTE_BOX_DEFAULTS.height) out.height = Math.round(px.height);
  if (Math.round(px.left) !== Math.round(def.left)) out.dx = Math.round(px.left - cellRight);
  if (Math.round(px.top) !== Math.round(def.top)) out.dy = Math.round(px.top - cellTop);
  if (show) out.show = true;
  return cleanNoteBox(out);
}
