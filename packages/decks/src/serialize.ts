import { PliError } from "@pli.dev/core";
import { animationProblem } from "./animation";
import type { Animation, Deck, Element, Fill, Layout, Master, Slide } from "./model";
import { CHART_TYPES, THEME_SLOTS } from "./model";
import { elementIds } from "./ops";

const FORMAT = "pli.deck";
const VERSION = 1;

function fail(path: string, message: string): never {
  throw new PliError("invalid_document", `${path}: ${message}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function checkFill(path: string, v: unknown): void {
  if (v === undefined || v === null) return;
  if (typeof v === "string") return;
  if (!isObject(v)) fail(path, "expected a colour, gradient or picture");
}

export const MAX_CHART_SERIES = 256;
export const MAX_CHART_POINTS = 200_000;
const MAX_CUSTOM_COMMANDS = 20_000;
const MAX_CUSTOM_PATHS = 512;
const MAX_CUSTOM_GUIDES = 2_000;
const COMMAND_ARGS: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, A: 4, Z: 0 };

function checkRef(path: string, v: unknown): void {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) fail(path, "expected a finite number");
  } else if (typeof v !== "string" || v === "" || v.length > 64) fail(path, "expected a number or a guide name");
}

/** Checks custom geometry: plain JSON, finite numbers, known commands and capped sizes. */
function checkCustom(path: string, v: unknown): void {
  if (v === undefined) return;
  if (!isObject(v) || !Array.isArray(v.paths)) fail(path, "expected custom geometry with paths");
  if (v.paths.length > MAX_CUSTOM_PATHS) fail(`${path}.paths`, `at most ${MAX_CUSTOM_PATHS} paths`);
  let commands = 0;
  (v.paths as unknown[]).forEach((p, i) => {
    const at = `${path}.paths[${i}]`;
    if (!isObject(p) || !Array.isArray(p.commands)) fail(at, "expected a path with commands");
    for (const k of ["w", "h"] as const) if (typeof p[k] !== "number" || !Number.isFinite(p[k] as number) || (p[k] as number) < 0) fail(`${at}.${k}`, "expected a size of zero or more");
    if (p.fill !== undefined && !["norm", "none", "lighten", "lightenLess", "darken", "darkenLess"].includes(p.fill as string)) fail(`${at}.fill`, "unknown fill mode");
    if (p.stroke !== undefined && typeof p.stroke !== "boolean") fail(`${at}.stroke`, "expected true or false");
    commands += p.commands.length;
    if (commands > MAX_CUSTOM_COMMANDS) fail(`${path}.paths`, `at most ${MAX_CUSTOM_COMMANDS} commands`);
    (p.commands as unknown[]).forEach((c, j) => {
      const cat = `${at}.commands[${j}]`;
      const n = Array.isArray(c) && typeof c[0] === "string" ? COMMAND_ARGS[c[0]] : undefined;
      if (!Array.isArray(c) || n === undefined || c.length !== n + 1) fail(cat, "expected a drawing command (M, L, C, Q, A or Z) with its numbers");
      for (let k = 1; k <= n; k++) checkRef(`${cat}[${k}]`, c[k]);
    });
  });
  if (v.adjust !== undefined) {
    if (!isObject(v.adjust)) fail(`${path}.adjust`, "expected values by name");
    for (const [k, n] of Object.entries(v.adjust)) if (typeof n !== "number" || !Number.isFinite(n)) fail(`${path}.adjust.${k}`, "expected a finite number");
  }
  if (v.guides !== undefined) {
    if (!Array.isArray(v.guides) || v.guides.length > MAX_CUSTOM_GUIDES) fail(`${path}.guides`, `expected a list of at most ${MAX_CUSTOM_GUIDES} guides`);
    (v.guides as unknown[]).forEach((g, i) => {
      if (!isObject(g) || typeof g.name !== "string" || g.name === "" || typeof g.fmla !== "string" || g.fmla.length > 400) fail(`${path}.guides[${i}]`, "expected a guide with a name and a formula");
    });
  }
  if (v.rect !== undefined) {
    if (!isObject(v.rect)) fail(`${path}.rect`, "expected l, t, r and b");
    for (const k of ["l", "t", "r", "b"]) checkRef(`${path}.rect.${k}`, (v.rect as Record<string, unknown>)[k]);
  }
}

/** Checks a chart's data: known type, finite numbers, and capped sizes. */
function checkChart(path: string, e: Record<string, unknown>): void {
  if (typeof e.chartType !== "string" || !(CHART_TYPES as readonly string[]).includes(e.chartType)) fail(`${path}.chartType`, `expected one of ${CHART_TYPES.join(", ")}`);
  if (!Array.isArray(e.categories) || e.categories.some((c) => typeof c !== "string")) fail(`${path}.categories`, "expected a list of category names");
  if (!Array.isArray(e.series) || e.series.length > MAX_CHART_SERIES) fail(`${path}.series`, `expected a list of at most ${MAX_CHART_SERIES} series`);
  let points = (e.categories as unknown[]).length;
  (e.series as unknown[]).forEach((s, i) => {
    const at = `${path}.series[${i}]`;
    if (!isObject(s) || typeof s.name !== "string" || !Array.isArray(s.values)) fail(at, "expected a series with a name and values");
    if ((s.values as unknown[]).some((v) => v !== null && (typeof v !== "number" || !Number.isFinite(v)))) fail(`${at}.values`, "expected numbers (or null for a blank)");
    if (s.x !== undefined && (!Array.isArray(s.x) || s.x.some((v) => typeof v !== "number" || !Number.isFinite(v)))) fail(`${at}.x`, "expected numbers");
    if (s.type !== undefined && !["column", "line", "area"].includes(s.type as string)) fail(`${at}.type`, "expected column, line or area");
    points += (s.values as unknown[]).length;
    if (points > MAX_CHART_POINTS) fail(path, `at most ${MAX_CHART_POINTS} data points`);
  });
  for (const k of ["gapWidth", "overlap", "holeSize", "firstSliceAngle", "textSize", "titleSize"] as const) if (e[k] !== undefined && (typeof e[k] !== "number" || !Number.isFinite(e[k] as number))) fail(`${path}.${k}`, "expected a number");
  if (e.grouping !== undefined && !["clustered", "stacked", "percentStacked"].includes(e.grouping as string)) fail(`${path}.grouping`, "expected clustered, stacked or percentStacked");
}

function checkElement(path: string, e: unknown, ids: Set<string>): void {
  if (!isObject(e)) fail(path, "expected an element");
  if (typeof e.id !== "string" || e.id === "") fail(`${path}.id`, "expected an id");
  if (ids.has(e.id)) fail(`${path}.id`, `duplicate id "${e.id}"`);
  ids.add(e.id);
  for (const k of ["x", "y", "w", "h", "rotation"] as const) if (e[k] !== undefined && (typeof e[k] !== "number" || !Number.isFinite(e[k] as number))) fail(`${path}.${k}`, "expected a number");
  switch (e.type) {
    case "shape":
      if (typeof e.geometry !== "string") fail(`${path}.geometry`, "expected a geometry name");
      checkFill(`${path}.fill`, e.fill);
      checkCustom(`${path}.custom`, e.custom);
      if (e.text !== undefined) {
        if (!isObject(e.text) || !Array.isArray(e.text.paragraphs)) fail(`${path}.text`, "expected a text body");
        (e.text.paragraphs as unknown[]).forEach((p, i) => {
          if (!isObject(p) || !Array.isArray(p.runs)) fail(`${path}.text.paragraphs[${i}]`, "expected a paragraph with runs");
          (p.runs as unknown[]).forEach((r, j) => {
            if (!isObject(r) || typeof r.text !== "string") fail(`${path}.text.paragraphs[${i}].runs[${j}]`, "expected a run with text");
          });
        });
      }
      break;
    case "image":
      if (typeof e.src !== "string") fail(`${path}.src`, "expected a picture source");
      checkCustom(`${path}.custom`, e.custom);
      break;
    case "table":
      if (!Array.isArray(e.columns) || !Array.isArray(e.rows)) fail(path, "expected columns and rows");
      (e.rows as unknown[]).forEach((r, i) => {
        if (!isObject(r) || !Array.isArray(r.cells) || r.cells.length !== (e.columns as unknown[]).length) fail(`${path}.rows[${i}]`, "every row needs one cell per column");
      });
      break;
    case "chart":
      checkChart(path, e);
      break;
    case "group":
      if (!Array.isArray(e.children)) fail(`${path}.children`, "expected children");
      (e.children as unknown[]).forEach((c, i) => checkElement(`${path}.children[${i}]`, c, ids));
      break;
    default:
      fail(`${path}.type`, `unknown element type "${String(e.type)}"`);
  }
}

/** Checks that a value is a deck the engine can use, and returns it. Throws a `PliError` that says where it isn't. */
export function validateDeck(value: unknown): Deck {
  if (!isObject(value) || value.type !== "deck") fail("deck", "expected a deck");
  const d = value as Record<string, unknown>;
  if (typeof d.title !== "string") fail("title", "expected a string");
  const size = d.size;
  if (!isObject(size) || typeof size.width !== "number" || typeof size.height !== "number" || !(size.width > 0) || !(size.height > 0)) fail("size", "expected a width and height");
  if (!Array.isArray(d.masters) || d.masters.length === 0) fail("masters", "a deck needs at least one master");
  if (!Array.isArray(d.slides)) fail("slides", "expected a list of slides");
  const layoutIds = new Set<string>();
  (d.masters as unknown[]).forEach((m, i) => {
    const at = `masters[${i}]`;
    if (!isObject(m)) fail(at, "expected a master");
    if (typeof m.id !== "string") fail(`${at}.id`, "expected an id");
    const theme = m.theme;
    if (!isObject(theme) || !isObject(theme.colors) || !isObject(theme.fonts)) fail(`${at}.theme`, "expected colours and fonts");
    for (const slot of THEME_SLOTS) if (typeof (theme.colors as Record<string, unknown>)[slot] !== "string") fail(`${at}.theme.colors.${slot}`, "expected a colour");
    if (!Array.isArray(m.elements) || !Array.isArray(m.layouts) || m.layouts.length === 0 || !isObject(m.textStyles)) fail(at, "expected elements, text styles and at least one layout");
    const ids = new Set<string>();
    (m.elements as unknown[]).forEach((e, j) => checkElement(`${at}.elements[${j}]`, e, ids));
    (m.layouts as unknown[]).forEach((l, j) => {
      if (!isObject(l) || typeof l.id !== "string" || !Array.isArray(l.elements)) fail(`${at}.layouts[${j}]`, "expected a layout with an id and elements");
      if (layoutIds.has(l.id as string)) fail(`${at}.layouts[${j}].id`, `duplicate layout id "${l.id}"`);
      layoutIds.add(l.id as string);
      const lids = new Set<string>();
      (l.elements as unknown[]).forEach((e, k) => checkElement(`${at}.layouts[${j}].elements[${k}]`, e, lids));
    });
  });
  if (d.comments !== undefined) {
    if (!isObject(d.comments)) fail("comments", "expected comment threads by id");
    for (const [id, t] of Object.entries(d.comments)) {
      if (!isObject(t) || t.id !== id || !Array.isArray(t.comments) || t.comments.some((c) => !isObject(c) || typeof c.id !== "string" || typeof c.author !== "string" || typeof c.body !== "string")) fail(`comments.${id}`, "expected a thread with its comments");
    }
  }
  const slideIds = new Set<string>();
  (d.slides as unknown[]).forEach((s, i) => {
    const at = `slides[${i}]`;
    if (!isObject(s) || typeof s.id !== "string") fail(at, "expected a slide with an id");
    if (slideIds.has(s.id as string)) fail(`${at}.id`, `duplicate slide id "${s.id}"`);
    slideIds.add(s.id as string);
    if (typeof s.layout !== "string" || !layoutIds.has(s.layout)) fail(`${at}.layout`, "expected the id of one of the layouts");
    if (typeof s.notes !== "string") fail(`${at}.notes`, "expected notes text");
    if (!Array.isArray(s.elements)) fail(`${at}.elements`, "expected a list");
    const ids = new Set<string>();
    (s.elements as unknown[]).forEach((e, j) => checkElement(`${at}.elements[${j}]`, e, ids));
    if (s.animations !== undefined) {
      if (!Array.isArray(s.animations)) fail(`${at}.animations`, "expected a list");
      const tops = new Set((s.elements as { id: string }[]).map((e) => e.id));
      const seen = new Set<string>();
      (s.animations as unknown[]).forEach((a, j) => {
        const where = `${at}.animations[${j}]`;
        if (!isObject(a) || typeof a.id !== "string" || typeof a.target !== "string") fail(where, "expected an animation with an id and a target");
        if (seen.has(a.id)) fail(`${where}.id`, `duplicate animation id "${a.id}"`);
        seen.add(a.id);
        if (!tops.has(a.target)) fail(`${where}.target`, `no element "${a.target}" on the slide`);
        const problem = animationProblem(a as unknown as Animation);
        if (problem) fail(where, problem);
      });
    }
  });
  return value as unknown as Deck;
}

/** The deck as JSON text, with a format tag and version so that later releases can read old files. */
export function serializeDeck(deck: Deck): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, deck });
}

/** Reads text written by `serializeDeck` (or a bare deck object). Throws a `PliError` if it isn't a deck. */
export function parseDeck(text: string): Deck {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PliError("invalid_document", "Not valid JSON");
  }
  if (isObject(value) && value.format === FORMAT) {
    if (typeof value.version !== "number" || value.version > VERSION) fail("version", `this file is from a newer version (${String(value.version)})`);
    return validateDeck(value.deck);
  }
  return validateDeck(value);
}

export type { Slide, Master, Layout, Element, Fill };
export { elementIds };
