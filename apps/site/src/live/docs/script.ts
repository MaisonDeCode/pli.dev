import { caret, createDoc, isTextBlock, paragraph, plainText, textLength, type Block, type Doc, type DocumentSession, type Selection, type TextBlock } from "@pli.dev/docs";
import { MAYA, type People } from "./people";

/**
 * The Documents story, written as a list of small edits made through the real session API (`typeText`, `splitBlock`,
 * `setBlockType`, `toggleMark`, `insertTable`, `comment`): what a person at the keyboard would do. The same actions run
 * one by one, with pauses, when a step is played, and all at once when the step is applied instantly (reduced motion, or
 * jumping to a step), so both ways end in the same document.
 *
 *   step 0  the headline and a short intro, typed
 *   step 1  the headline becomes the Title, key words are bold or italic, a "Why now" section and a list of what ships
 *   step 2  a timeline table, a comment from a teammate on one sentence, and her cursor
 */

export const DOC_TITLE = "Compass 2.0 launch plan";
export const INTRO = "Our biggest release of the year: a faster editor, shared workspaces and a mobile app.";
export const INTRO_BOLD = "biggest release of the year";
export const INTRO_ITALIC = "a mobile app";
export const WHY_HEAD = "Why now";
export const WHY_START = "Customers keep asking for speed, sharing and mobile.";
export const WHY_BOLD = "speed, sharing and mobile";
export const WHY_CLAIM = "Early testers say pages open twice as fast.";
export const WHY = `${WHY_START} ${WHY_CLAIM}`;
export const SHIP_HEAD = "What ships";
export const SHIP_ITEMS: readonly [lead: string, rest: string][] = [
  ["Shared workspaces", ": one home for every draft."],
  ["Mobile app", ": read and comment anywhere."],
  ["Faster editor", ": long files open instantly."],
];
export const TIME_HEAD = "Timeline";
export const TIMELINE: readonly (readonly [string, string, string])[] = [
  ["Milestone", "Team", "Date"],
  ["Feature freeze", "Engineering", "Feb 20"],
  ["Public beta", "Product", "Mar 10"],
  ["Launch event", "Marketing", "Apr 2"],
  ["General availability", "Engineering", "Apr 15"],
];
export const COMMENT = "Can we link the beta survey here? Legal will want a source.";

/** One small edit, and how long to wait before the next one when the step is played. */
export interface Action {
  ms: number;
  run(): void;
}
export type Segment = readonly Action[];

/** What the script needs from the page besides the session: the parts of the editor that are not in the document. */
export interface Chrome {
  /** Opens or closes the comments panel. */
  comments(open: boolean): void;
  /** Where the teammate's caret is, or null when she is not in the document. */
  teammate(selection: Selection | null): void;
}

/** A person types about 30ms a key; a step with more text than fits its slot of the tour is typed faster, never slower. */
const TYPE_MS = 30;
const TYPE_MIN_MS = 14;
const STEP_TYPING_MS = 3400;
const wobble = (i: number, per: number) => Math.round((((i * 7) % 5) - 2) * 0.13 * per); // a little uneven, the same every time

/** The document a script starts from: one empty paragraph, a page with room for a one-pager in a small window. */
export function blankDoc(): Doc {
  return {
    ...createDoc("Untitled", [paragraph("")]),
    page: { size: "letter", orientation: "portrait", margins: { top: 0.7, right: 0.9, bottom: 0.7, left: 0.9 } },
  };
}

const textBlocks = (session: DocumentSession): TextBlock[] => session.state.blocks.filter(isTextBlock);

function startingWith(session: DocumentSession, prefix: string): TextBlock {
  const found = textBlocks(session).find((b) => plainText(b.runs).startsWith(prefix));
  if (!found) throw new Error(`The live document has no paragraph starting "${prefix}"`);
  return found;
}

/** Puts the caret at the end of the last paragraph that is not inside a table. */
function toEnd(session: DocumentSession): void {
  const last = textBlocks(session).at(-1);
  if (last) session.select(caret(last.id, textLength(last.runs)));
}

function selectPhrase(session: DocumentSession, prefix: string, phrase: string): void {
  const block = startingWith(session, prefix);
  const at = plainText(block.runs).indexOf(phrase);
  if (at < 0) throw new Error(`"${phrase}" is not in the paragraph starting "${prefix}"`);
  session.select({ anchor: { block: block.id, offset: at }, focus: { block: block.id, offset: at + phrase.length } });
}

/** Cell paragraphs of the timeline table, in reading order. */
export function timelineCells(doc: Doc): TextBlock[] {
  const table = doc.blocks.find((b: Block) => b.type === "table");
  if (!table || table.type !== "table") return [];
  return table.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks.filter(isTextBlock)));
}

export function createScript(session: DocumentSession, people: People, chrome: Chrome): readonly [Segment, Segment, Segment] {
  const acts = (typed: readonly string[]): { list: Action[]; at: (ms: number, run: () => void) => void; type: (text: string) => void } => {
    const list: Action[] = [];
    const total = typed.reduce((n, t) => n + t.length, 0);
    const per = Math.max(TYPE_MIN_MS, Math.min(TYPE_MS, Math.floor(STEP_TYPING_MS / Math.max(1, total))));
    return {
      list,
      at: (ms, run) => list.push({ ms, run }),
      type: (text) => [...text].forEach((ch, i) => list.push({ ms: per + wobble(i, per), run: () => void session.typeText(ch) })),
    };
  };

  // Step 0: the headline and an intro.
  const first = acts([DOC_TITLE, INTRO]);
  first.at(0, () => {
    const only = session.state.blocks[0]!;
    session.select(caret(only.id, 0));
    chrome.comments(false);
    chrome.teammate(null);
  });
  first.at(350, () => {});
  first.type(DOC_TITLE);
  first.at(200, () => session.setTitle(DOC_TITLE));
  first.at(80, () => void session.splitBlock());
  first.type(INTRO);
  first.at(400, () => {});

  // Step 1: style it and write the body.
  const second = acts([WHY_HEAD, WHY, SHIP_HEAD, ...SHIP_ITEMS.map(([lead, rest]) => lead + rest)]);
  second.at(0, () => {
    session.select(caret(startingWith(session, DOC_TITLE).id, 0));
    session.setBlockType({ type: "title" });
  });
  second.at(350, () => selectPhrase(session, INTRO, INTRO_BOLD));
  second.at(120, () => void session.toggleMark("bold"));
  second.at(250, () => selectPhrase(session, INTRO, INTRO_ITALIC));
  second.at(120, () => void session.toggleMark("italic"));
  second.at(250, () => {
    toEnd(session);
    session.splitBlock();
  });
  second.type(WHY_HEAD);
  second.at(100, () => void session.setBlockType({ type: "heading", level: 2 }));
  second.at(60, () => void session.splitBlock());
  second.type(WHY);
  second.at(160, () => selectPhrase(session, WHY_START, WHY_BOLD));
  second.at(100, () => void session.toggleMark("bold"));
  second.at(200, () => {
    toEnd(session);
    session.splitBlock();
  });
  second.type(SHIP_HEAD);
  second.at(100, () => void session.setBlockType({ type: "heading", level: 2 }));
  second.at(60, () => {
    session.splitBlock();
    session.setBlockType({ type: "list_item", list: "bullet" });
  });
  SHIP_ITEMS.forEach(([lead, rest], i) => {
    second.type(lead + rest);
    second.at(90, () => {
      selectPhrase(session, lead, lead);
      session.toggleMark("bold");
    });
    second.at(120, () => {
      toEnd(session);
      if (i < SHIP_ITEMS.length - 1) session.splitBlock();
    });
  });
  second.at(300, () => {});

  // Step 2: the timeline, and a teammate.
  const third = acts([TIME_HEAD, ...TIMELINE.flat()]);
  third.at(0, () => {
    toEnd(session);
    session.splitBlock(); // a new, empty item...
    session.splitBlock(); // ...which Enter turns back into a paragraph
  });
  third.type(TIME_HEAD);
  third.at(100, () => void session.setBlockType({ type: "heading", level: 2 }));
  third.at(60, () => {
    session.splitBlock();
    session.insertTable(TIMELINE.length, 3, { headerRow: true });
  });
  TIMELINE.flat().forEach((cell, i, all) => {
    third.type(cell);
    if (i < all.length - 1) third.at(45, () => void session.moveToCell(1));
  });
  third.at(350, () => {
    selectPhrase(session, WHY_START, WHY_CLAIM);
    people.as(MAYA, () => session.comment(COMMENT));
    toEnd(session);
  });
  third.at(250, () => chrome.comments(true));
  third.at(300, () => {
    // Maya's cursor is in the "Launch event" row of the table.
    const cells = timelineCells(session.state);
    const cell = cells.find((c) => plainText(c.runs) === "Launch event");
    if (cell) chrome.teammate(caret(cell.id, textLength(cell.runs)));
  });
  third.at(200, () => {});

  return [first.list, second.list, third.list];
}
