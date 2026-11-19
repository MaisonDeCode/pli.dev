import { describePlaceholder, isTextBlock, locate, placeholderSnippet, textLength, type DocumentSession, type PlaceholderSnippet } from "@pli.dev/docs";
import type { PlaceholderMode } from "../session-context";
import type { MenuEntry } from "./primitives";

/** A choice for an answer that is one of a few: `"team"`, or `{ value: "team", label: "Team plan" }`. */
export type PlaceholderChoice = string | number | { value: string | number; label?: string };

/**
 * An answer the template can ask for, to offer in the Insert menu. A plain string is the name of the answer: `"client.name"`.
 */
export type PlaceholderField =
  | string
  | {
      /** Where the answer is, with a dot for each level: `client.name`. */
      path: string;
      /** What the menu and the chips call it, instead of the name: "Client name". */
      label?: string;
      /** For an answer that is one of a few choices: *Only if…* then offers "is Team", "is Starter". */
      options?: readonly PlaceholderChoice[];
      /** For a list: what each item has (`["name", { path: "fee", label: "Fee" }]`). They are offered under the list, to use between *Repeat for each…* and its end. */
      fields?: readonly PlaceholderField[];
    };

/**
 * Turns on the way `{{ … }}` is shown while editing a template: each tag is drawn as a chip, and Insert gets *Field*, *Only if…* and
 * *Repeat for each…*. `placeholders` on its own (`true`) is the chips and a plain Insert menu; give `fields` and the menu lists your
 * answers by name.
 */
export interface PlaceholderOptions {
  /** The answers to offer: `["client.name", { path: "start", label: "Start date" }]`. `templateFields(doc).fields` gives them for a template that already has some. */
  fields?: readonly PlaceholderField[];
  /**
   * Show each tag by its name in plain words ("Client name", "Only if Plan is team", "End") and hide the code, for people who
   * aren't developers. The text is the same underneath. The caret treats a tag as one character, so Backspace removes the whole tag
   * and the arrow keys jump over it. A tag that can't be read is shown as written, in red. Names come from `fields`, and from the
   * answer's own name for anything not listed (`clientName` is "Client name").
   */
  labels?: boolean;
}

const pathOf = (field: PlaceholderField): string => (typeof field === "string" ? field : field.path);
const labelOf = (field: PlaceholderField): string => (typeof field === "string" ? field : (field.label ?? field.path));
const childrenOf = (field: PlaceholderField): readonly PlaceholderField[] => (typeof field === "string" ? [] : (field.fields ?? []));
const valueOf = (choice: PlaceholderChoice): string | number => (typeof choice === "object" ? choice.value : choice);
const choiceLabel = (choice: PlaceholderChoice): string => (typeof choice === "object" ? (choice.label ?? String(choice.value)) : String(choice));

/** The text of a tag that shows an answer. */
export const valueTag = (path: string): string => `{{ ${path} }}`;

/** How tags are drawn for these options: `false` for none, otherwise whether to show names and which. */
export function placeholderMode(options: boolean | PlaceholderOptions | undefined): PlaceholderMode | false {
  if (!options) return false;
  if (options === true || !options.labels) return {};
  const names: Record<string, string> = {};
  const add = (fields: readonly PlaceholderField[] | undefined) => {
    for (const field of fields ?? []) {
      if (typeof field !== "string" && field.label) names[field.path] ??= field.label;
      add(childrenOf(field));
    }
  };
  add(options.fields);
  return { label: (tag) => describePlaceholder(tag, names) };
}

/** Puts `{{ path }}` at the caret, in place of what is selected. */
export function insertValue(session: DocumentSession, path: string): boolean {
  return session.typeText(valueTag(path));
}

/**
 * Puts a condition or a list at the caret: the opening and closing tag, each in a paragraph of their own, with an empty one between
 * for what goes inside. When the caret is in the middle of a paragraph the paragraph is split first, so the tags never end up in
 * the middle of a line. The caret ends up in the empty paragraph.
 */
export function insertSnippet(session: DocumentSession, kind: PlaceholderSnippet, subject?: string): boolean {
  const { lines } = placeholderSnippet(kind, subject);
  const at = session.selection?.focus;
  const found = at ? locate(session.state, at.block) : null;
  let text = lines.join("\n");
  if (found && isTextBlock(found.block)) {
    const length = textLength(found.block.runs);
    // Text before the caret stays in its own paragraph, and text after it goes in a paragraph below the closing tag.
    if (at!.offset > 0) text = `\n${text}`;
    if (at!.offset < length) text = `${text}\n`;
  }
  return session.pastePlainText(text);
}

/** `plan == "team"`, for the answer and one of its choices. */
const comparison = (path: string, choice: PlaceholderChoice): string => `${path} == ${typeof valueOf(choice) === "number" ? valueOf(choice) : JSON.stringify(valueOf(choice))}`;

/**
 * The entries for Insert when a template is being edited: *Field* (the answers, by name), *Only if…* and *Repeat for each…*. With
 * no `fields`, the last two insert a condition or list with a word to replace.
 */
export function placeholderMenu(session: () => DocumentSession, options: PlaceholderOptions, disabled: boolean, after: () => void): MenuEntry[] {
  const fields = options.fields ?? [];
  const run = (action: (s: DocumentSession) => void) => () => {
    action(session());
    after();
  };
  const field = (f: PlaceholderField, pick: (path: string) => (s: DocumentSession) => void): MenuEntry => ({ label: labelOf(f), onSelect: run(pick(pathOf(f))) });

  // Answers, with a list's items under the list.
  const values = (list: readonly PlaceholderField[]): MenuEntry[] =>
    list.map((f) => {
      const children = childrenOf(f);
      if (children.length === 0) return field(f, (path) => (s) => void insertValue(s, path));
      return {
        label: labelOf(f),
        items: [
          field(f, (path) => (s) => void insertValue(s, path)),
          "separator",
          ...children.map((c) => field({ path: `item.${pathOf(c)}`, label: labelOf(c) }, (path) => (s) => void insertValue(s, path))),
        ],
      } as MenuEntry;
    });

  const conditions = (list: readonly PlaceholderField[]): MenuEntry[] =>
    list.map((f) => {
      const choices = typeof f === "string" ? [] : (f.options ?? []);
      if (choices.length === 0) return field(f, (path) => (s) => void insertSnippet(s, "if", path));
      return {
        label: labelOf(f),
        items: choices.map((c) => ({ label: `is ${choiceLabel(c)}`, onSelect: run((s) => void insertSnippet(s, "if", comparison(pathOf(f), c))) })),
      } as MenuEntry;
    });

  const lists = fields.filter((f) => childrenOf(f).length > 0);
  const repeatable = lists.length > 0 ? lists : fields;
  const plain = (label: string, kind: PlaceholderSnippet): MenuEntry => ({ label, disabled, onSelect: run((s) => void insertSnippet(s, kind)) });
  return [
    ...(fields.length > 0 ? [{ label: "Field", disabled, items: values(fields) } as MenuEntry] : []),
    fields.length > 0 ? { label: "Only if…", disabled, items: conditions(fields) } : plain("Only if…", "if"),
    repeatable.length > 0 ? { label: "Repeat for each…", disabled, items: repeatable.map((f) => field(f, (path) => (s) => void insertSnippet(s, "each", path))) } : plain("Repeat for each…", "each"),
  ];
}
