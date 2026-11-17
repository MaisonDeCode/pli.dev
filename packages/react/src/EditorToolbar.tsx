import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { pageBreak, styleList, type Align, type BlockSpec, type DocumentSession, type MarkKey } from "@pli.dev/docs";
import { PHONE_QUERY, useMediaQuery, useSelectionState } from "./hooks";
import { ColorPicker } from "./ui/ColorPicker";
import { Bar } from "./ui/bar";
import { Icons } from "./ui/icons";
import { FontPicker } from "./ui/fonts";
import { Dropdown, MenuList, keepFocus } from "./ui/primitives";
import { listMenuItems } from "./ui/lists";
import { pictureMenuItems } from "./ui/pictures";
import { ZOOMS } from "./ui/panels";
import { TableGrid, tableMenuItems } from "./ui/tables";

export interface EditorToolbarProps {
  session: DocumentSession;
  /** Called after each action so the editor can take focus back. */
  onAfterAction?: () => void;
  /** Open the link dialog. Hidden if not provided. */
  onLink?: () => void;
  /** Open the image dialog. Hidden if not provided. */
  onImage?: () => void;
  /** Start a comment on the selected text. Hidden if not provided. */
  onComment?: () => void;
  /** Whether a comment can be started now: some text is selected, and the user may comment. */
  commentDisabled?: boolean;
  onPrint?: () => void;
  onToggleOutline?: () => void;
  outlineOpen?: boolean;
  /** Open a dialog for a custom table row height. */
  onRowHeight?: () => void;
  /** Open a dialog for the number a numbered list starts at. */
  onListStart?: () => void;
  /**
   * The layout of the page, so the toolbar's menu can offer it on a phone, where the status bar leaves it out: pages or
   * pageless, and the zoom.
   */
  layout?: { view: "pages" | "continuous"; onView: (view: "pages" | "continuous") => void; zoom: number; onZoom: (zoom: number) => void };
  /** On a phone, the toolbar sits at the bottom of the editor, above the keyboard, instead of at the top. */
  docked?: boolean;
  /** The size of text with no size of its own, in points. 11 for a document body; a header or footer is smaller. */
  baseFontSize?: number;
  className?: string;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";
const ALT = isMac ? "⌥" : "Alt+";

/** The twelve fonts older versions offered. The pickers now list every font of the registry (see `FontPicker`); this is kept for code that used the list. */
export const FONT_FAMILIES = [
  "Arial",
  "Calibri",
  "Cambria",
  "Comic Sans MS",
  "Courier New",
  "Garamond",
  "Georgia",
  "Impact",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

type StyleChoice = "paragraph" | "title" | "subtitle" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote" | "code_block";

const STYLE_OPTIONS: { value: StyleChoice; label: string }[] = [
  { value: "paragraph", label: "Normal text" },
  { value: "title", label: "Title" },
  { value: "subtitle", label: "Subtitle" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "h5", label: "Heading 5" },
  { value: "h6", label: "Heading 6" },
  { value: "quote", label: "Quote" },
  { value: "code_block", label: "Code block" },
];

function choiceOf(spec: BlockSpec | null): StyleChoice | "list" | "mixed" {
  if (!spec) return "mixed";
  if (spec.type === "heading") return `h${spec.level}` as StyleChoice;
  if (spec.type === "list_item") return "list";
  return spec.type;
}

function specOfChoice(choice: StyleChoice): BlockSpec {
  if (choice[0] === "h" && choice.length === 2) return { type: "heading", level: Number(choice[1]) as 1 | 2 | 3 | 4 | 5 | 6 };
  return { type: choice } as BlockSpec;
}

/** The size text has when it carries no explicit size, so the size box shows what you see. */
function baseSizeFor(spec: BlockSpec | null, base = 11): number {
  if (!spec) return base;
  switch (spec.type) {
    case "title": return 26;
    case "subtitle": return 15;
    case "heading": return [20, 16, 14, 12, 11, 11][spec.level - 1]!;
    case "code_block": return 10;
    default: return base;
  }
}

/** The full set of formatting controls for a session, in a single toolbar. */
export function EditorToolbar({ session, onAfterAction, onLink, onImage, onComment, commentDisabled, onPrint, onToggleOutline, outlineOpen, onRowHeight, onListStart, layout, docked, baseFontSize, className }: EditorToolbarProps) {
  const state = useSelectionState(session);
  const phone = useMediaQuery(PHONE_QUERY);
  const after = () => onAfterAction?.();

  const run = (action: () => unknown) => () => {
    action();
    after();
  };

  const button = (label: string, icon: ReactNode, action: () => unknown, options: { pressed?: boolean; disabled?: boolean; shortcut?: string } = {}) => (
    <button
      type="button"
      className="pli-tool"
      aria-label={label}
      title={options.shortcut ? `${label} (${options.shortcut})` : label}
      aria-pressed={options.pressed}
      disabled={options.disabled}
      onMouseDown={keepFocus}
      onClick={run(action)}
    >
      {icon}
    </button>
  );

  const mark = (key: MarkKey, label: string, glyph: ReactNode, shortcut: string) =>
    button(label, glyph, () => session.toggleMark(key), { pressed: state.marks[key], shortcut });

  const align = (value: Align, label: string, icon: ReactNode, shortcut: string) =>
    button(label, icon, () => session.setAlign(value), { pressed: state.align === value, shortcut });

  const choice = choiceOf(state.block);
  const customStyles = styleList(session.state, "paragraph");
  const chosenStyle = state.paragraphStyle && session.state.styles?.[state.paragraphStyle]?.kind === "paragraph" ? state.paragraphStyle : null;
  const list = state.block?.type === "list_item" ? state.block.list : null;
  const baseSize = baseSizeFor(state.block, baseFontSize);
  const size = state.fontSize.value ?? baseSize;

  const [sizeText, setSizeText] = useState(String(size));
  useEffect(() => setSizeText(state.fontSize.mixed ? "" : String(size)), [size, state.fontSize.mixed]);
  const applySize = (value: number) => {
    if (Number.isFinite(value) && value >= 1 && value <= 400) session.setMarks({ fontSize: Math.round(value * 2) / 2 });
    after();
  };
  const stepSize = (direction: 1 | -1) => {
    const next = direction > 0 ? FONT_SIZES.find((s) => s > size) : [...FONT_SIZES].reverse().find((s) => s < size);
    if (next) applySize(next);
  };

  const lineHeight = state.format.lineHeight ?? 1.15;
  const spacing = (label: string, value: number) => ({
    label,
    checked: Math.abs(lineHeight - value) < 0.001,
    onSelect: () => { session.setParagraphFormat({ lineHeight: value === 1.15 ? null : value }); after(); },
  });

  const select = (className: string, props: React.SelectHTMLAttributes<HTMLSelectElement>, children: ReactNode) => (
    <span className={`pli-select-wrap ${className}`}>
      <select className="pli-select" {...props}>{children}</select>
      <span className="pli-select-chevron" aria-hidden="true">{Icons.chevron}</span>
    </span>
  );

  return (
    <Bar aria-label="Formatting" className={`${docked ? "pli-toolbar-docked" : ""}${className ? ` ${className}` : ""}`.trim() || undefined}>
      <div className="pli-group" data-group="history">
        {button("Undo", Icons.undo, () => session.undo(), { disabled: !session.canUndo, shortcut: `${MOD}Z` })}
        {button("Redo", Icons.redo, () => session.redo(), { disabled: !session.canRedo, shortcut: isMac ? `${SHIFT}${MOD}Z` : `${MOD}Y` })}
        {onPrint && button("Print", Icons.print, onPrint, { shortcut: `${MOD}P` })}
      </div>

      <div className="pli-group" data-group="style">
        {select(
          "pli-select-style",
          {
            "aria-label": "Paragraph style",
            value: chosenStyle ? `style:${chosenStyle}` : choice,
            onChange: (event: ChangeEvent<HTMLSelectElement>) => {
              const value = event.target.value;
              if (value.startsWith("style:")) session.applyParagraphStyle(value.slice(6));
              else session.setBlockType(specOfChoice(value as StyleChoice));
              after();
            },
          },
          <>
            {choice === "list" && !chosenStyle && <option value="list" disabled>List item</option>}
            {choice === "mixed" && !chosenStyle && <option value="mixed" disabled>Mixed</option>}
            {STYLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {customStyles.length > 0 && (
              <optgroup label="Your styles">
                {customStyles.map(({ id, style }) => <option key={id} value={`style:${id}`}>{style.name}</option>)}
              </optgroup>
            )}
          </>,
        )}
        <FontPicker
          value={state.fontFamily.value ?? undefined}
          mixed={state.fontFamily.mixed}
          defaultLabel="Default"
          onChange={(family) => { session.setMarks({ fontFamily: family }); after(); }}
        />
        <div className="pli-size" role="group" aria-label="Font size">
          <button type="button" className="pli-tool" aria-label="Decrease font size" onMouseDown={keepFocus} onClick={() => stepSize(-1)}>{Icons.minus}</button>
          <input
            className="pli-size-input"
            aria-label="Font size"
            inputMode="decimal"
            value={sizeText}
            onChange={(e) => setSizeText(e.target.value)}
            onBlur={() => sizeText && Number(sizeText) !== size && applySize(Number(sizeText))}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); applySize(Number(sizeText)); }
            }}
          />
          <button type="button" className="pli-tool" aria-label="Increase font size" onMouseDown={keepFocus} onClick={() => stepSize(1)}>{Icons.plus}</button>
        </div>
      </div>

      <div className="pli-group" data-group="marks">
        {mark("bold", "Bold", <strong>B</strong>, `${MOD}B`)}
        {mark("italic", "Italic", <em>I</em>, `${MOD}I`)}
        {mark("underline", "Underline", <u>U</u>, `${MOD}U`)}
        <ColorPicker
          label="Text color"
          value={state.color.value}
          mixed={state.color.mixed}
          icon={Icons.textColor}
          noneLabel="Default color"
          onChange={(color) => { session.setMarks({ color }); after(); }}
        />
        <ColorPicker
          label="Highlight color"
          value={state.highlight.value}
          mixed={state.highlight.mixed}
          icon={Icons.highlight}
          noneLabel="No highlight"
          onChange={(color) => { session.setMarks({ highlight: color }); after(); }}
        />
      </div>

      <div className="pli-group" data-group="insert">
        {onLink && button("Insert link", Icons.link, onLink, { pressed: !!state.link.value, shortcut: `${MOD}K` })}
        {onImage && button("Insert image", Icons.image, onImage)}
        {onComment && button("Add comment", Icons.comment, onComment, { disabled: commentDisabled, shortcut: `${MOD}${ALT}M` })}
        {state.image && (
          <Dropdown label="Picture options" align="end" panel={(close) => (
            <MenuList label="Picture options" close={close} items={pictureMenuItems(session, state.image, after)} />
          )}>
            {Icons.wrap}
          </Dropdown>
        )}
        <Dropdown label="Insert table" disabled={!!state.table} panel={(close) => (
          <TableGrid onPick={(rows, columns) => { close(); session.insertTable(rows, columns, { headerRow: true }); after(); }} />
        )}>
          {Icons.table}
        </Dropdown>
      </div>

      <div className="pli-group" data-group="align">
        {align("left", "Align left", Icons.left, `${SHIFT}${MOD}L`)}
        {align("center", "Align center", Icons.center, `${SHIFT}${MOD}E`)}
        {align("right", "Align right", Icons.right, `${SHIFT}${MOD}R`)}
        {align("justify", "Justify", Icons.justify, `${SHIFT}${MOD}J`)}
      </div>

      <div className="pli-group" data-group="list">
        {button("Bulleted list", Icons.bullets, () => session.toggleBlockType({ type: "list_item", list: "bullet" }), { pressed: list === "bullet", shortcut: `${SHIFT}${MOD}8` })}
        {button("Numbered list", Icons.numbers, () => session.toggleBlockType({ type: "list_item", list: "ordered" }), { pressed: list === "ordered", shortcut: `${SHIFT}${MOD}7` })}
        {state.list && (
          <Dropdown label="List style and numbering" panel={(close) => (
            <MenuList label="List style and numbering" close={close} items={listMenuItems(session, state.list, after, { onStartAt: onListStart })} />
          )}>
            {Icons.chevron}
          </Dropdown>
        )}
        {button("Decrease indent", Icons.outdent, () => session.outdent(), { disabled: !state.canOutdent, shortcut: `${MOD}[` })}
        {button("Increase indent", Icons.indent, () => session.indent(), { disabled: !state.canIndent, shortcut: `${MOD}]` })}
      </div>

      <div className="pli-group" data-group="more">
        <Dropdown label="More formatting" align="end" panel={(close) => (
          <MenuList
            label="More formatting"
            close={close}
            items={[
              { label: "Strikethrough", shortcut: `${SHIFT}${MOD}X`, checked: state.marks.strike, onSelect: () => { session.toggleMark("strike"); after(); } },
              { label: "Superscript", shortcut: `${MOD}.`, checked: state.marks.superscript, onSelect: () => { session.toggleMark("superscript"); after(); } },
              { label: "Subscript", shortcut: `${MOD},`, checked: state.marks.subscript, onSelect: () => { session.toggleMark("subscript"); after(); } },
              "separator",
              {
                label: "Line and paragraph spacing",
                items: [
                  spacing("Single", 1),
                  spacing("1.15", 1.15),
                  spacing("1.5", 1.5),
                  spacing("Double", 2),
                  "separator",
                  { label: state.format.spaceBefore ? "Remove space before paragraph" : "Add space before paragraph", onSelect: () => { session.setParagraphFormat({ spaceBefore: state.format.spaceBefore ? null : 12 }); after(); } },
                  { label: state.format.spaceAfter !== undefined && state.format.spaceAfter >= 12 ? "Remove space after paragraph" : "Add space after paragraph", onSelect: () => { session.setParagraphFormat({ spaceAfter: state.format.spaceAfter !== undefined && state.format.spaceAfter >= 12 ? null : 12 }); after(); } },
                ],
              },
              "separator",
              { label: "Page break", shortcut: `${MOD}Enter`, onSelect: () => { session.insertBlockAtCaret(pageBreak()); after(); } },
              { label: "Clear formatting", shortcut: `${MOD}\\`, onSelect: () => { session.clearFormatting(); after(); } },
              ...(layout && phone
                ? [
                    "separator" as const,
                    { label: "Pages", checked: layout.view === "pages", onSelect: () => layout.onView("pages") },
                    { label: "Pageless", checked: layout.view === "continuous", onSelect: () => layout.onView("continuous") },
                    {
                      label: "Zoom",
                      items: ZOOMS.map((z) => ({ label: `${Math.round(z * 100)}%`, checked: Math.abs(layout.zoom - z) < 0.001, onSelect: () => layout.onZoom(z) })),
                    },
                  ]
                : []),
            ]}
          />
        )}>
          {Icons.more}
        </Dropdown>
      </div>

      {state.table && (
        <div className="pli-group" data-group="table" role="group" aria-label="Table">
          <Dropdown label="Table options" className="pli-tool-wide" panel={(close) => (
            <MenuList label="Table options" close={close} items={tableMenuItems(session, state.table, after, { onRowHeight })} />
          )}>
            <span className="pli-glyph">{Icons.table}</span>
            <span className="pli-tool-label">Table</span>
            {Icons.chevron}
          </Dropdown>
          {button("Merge cells", Icons.merge, () => session.mergeCells(), { disabled: !state.table.canMerge })}
          {button("Split cell", Icons.split, () => session.splitCells(), { disabled: !state.table.canSplit })}
          <ColorPicker
            label="Cell shading"
            value={state.table.shade}
            icon={Icons.fill}
            noneLabel="No fill"
            onChange={(color) => { session.setCellShade(color); after(); }}
          />
        </div>
      )}

      {onToggleOutline && (
        <div className="pli-group pli-group-end">
          {button("Document outline", Icons.outline, onToggleOutline, { pressed: outlineOpen })}
        </div>
      )}
    </Bar>
  );
}

export { ALT as MODIFIER_ALT, MOD as MODIFIER_MOD, SHIFT as MODIFIER_SHIFT };

