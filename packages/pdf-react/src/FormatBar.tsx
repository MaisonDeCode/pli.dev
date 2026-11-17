/**
 * The text format bar: font, size, bold, italic, text colour, fill, alignment and border of what is being written. It is the
 * row Docs shows under its menus, and it appears only when there is text to format:
 *
 * - a text box (an annotation) is selected or being typed in, or the Text box tool is on (the next box gets the choices);
 * - the Edit text tool has a piece of the page's text selected (font, size, bold, italic and colour: the file's text has no
 *   fill, border or alignment of its own to set).
 *
 * The controls are the shared ones (`FontPicker`, `ColorPicker`) and every change goes through the same controller commands
 * as the properties panel, so each is one step of undo.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bar as ToolBar, ColorPicker, Dropdown, FontPicker, Icons, MenuList, keepFocus, type MenuEntry } from "@pli.dev/react";
import type { FreeTextAnnot, TextStyle } from "@pli.dev/pdf";
import type { AnnotController } from "./annotController";
import { colorOf, fillOf, widthOf, withFill, withText, withWidth } from "./annotProps";
import type { EditController, EditStyle } from "./editController";
import { styleOfEdit } from "./editController";
import { useSessionRevision } from "./hooks";
import { PdfIcons as I } from "./icons";
import { MOD } from "./shortcuts";

const SIZES = [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96, 144, 200];
const WIDTHS = [0, 0.5, 1, 2, 3, 4, 6, 8];
const STANDARD_FAMILIES = ["Helvetica", "Times", "Courier"];

/** What the bar is about now. */
interface Target {
  /** Where the choices go: a box's text, or the page's text. */
  kind: "box" | "edit";
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: string;
  mixedFont?: boolean;
  align?: "left" | "center" | "right";
  fill?: string;
  width?: number;
  setText(patch: Partial<TextStyle>): void;
  setFill?(color: string | undefined): void;
  setWidth?(width: number): void;
}

function boxTarget(c: AnnotController): Target | null {
  if (c.readOnly) return null;
  const editing = c.editing?.annot;
  const selected = c.selected;
  const boxes = editing ? [editing] : selected.length > 0 && selected.every((a): a is FreeTextAnnot => a.type === "freetext" && !a.locked) ? selected : [];
  if (boxes.length > 0) {
    const first = boxes[0]!;
    const ids = boxes.map((b) => b.id);
    const style = first.style;
    return {
      kind: "box",
      family: style.family,
      size: style.size,
      bold: !!style.bold,
      italic: !!style.italic,
      color: colorOf(first) ?? "#000000",
      mixedFont: boxes.some((b) => b.style.family !== style.family),
      align: style.align ?? "left",
      fill: fillOf(first),
      width: widthOf(first) ?? 0,
      setText: (patch) => (editing ? c.editText({ style: { ...editing.style, ...patch } as TextStyle }) : c.patch(ids, (a) => withText(a, patch), "text")),
      setFill: (color) => (editing ? c.editText({ fill: color } as Partial<FreeTextAnnot>) : c.patch(ids, () => withFill(color), "fill")),
      setWidth: (w) => (editing ? c.editText({ stroke: w > 0 ? { color: editing.stroke?.color ?? style.color, ...editing.stroke, width: w } : undefined } as Partial<FreeTextAnnot>) : c.patch(ids, (a) => withWidth(a, w), "width")),
    };
  }
  // The Text box tool is on and nothing is selected: the choices are for the next box.
  if (c.toolId === "text") {
    const s = c.style("text");
    return {
      kind: "box",
      family: s.family,
      size: s.size,
      bold: s.bold,
      italic: s.italic,
      color: s.color,
      align: s.align,
      fill: s.fill,
      width: s.width,
      setText: (patch) => c.setStyle("text", { ...(patch.family ? { family: patch.family } : {}), ...(patch.size ? { size: patch.size } : {}), ...("bold" in patch ? { bold: !!patch.bold } : {}), ...("italic" in patch ? { italic: !!patch.italic } : {}), ...(patch.color ? { color: patch.color } : {}), ...(patch.align ? { align: patch.align } : {}) }),
      setFill: (color) => c.setStyle("text", { fill: color }),
      setWidth: (w) => c.setStyle("text", { width: w }),
    };
  }
  return null;
}

function editTarget(e: EditController): Target | null {
  if (e.readOnly || !e.active || e.selected?.kind !== "run") return null;
  const run = e.run(e.selected.page, e.selected.id);
  if (!run || !run.editable) return null;
  const pending = e.textEdit(e.selected.page, run.id);
  const style: EditStyle = e.editing && e.editing.run.id === run.id ? e.editing.style : styleOfEdit(pending);
  const looks = e.looks(run, style);
  return {
    kind: "edit",
    family: looks.family,
    size: looks.size,
    bold: looks.bold,
    italic: looks.italic,
    color: looks.color,
    setText: (patch) => void e.setStyle({ ...(patch.family !== undefined ? { family: patch.family } : {}), ...(patch.size !== undefined ? { size: patch.size } : {}), ...(patch.bold !== undefined ? { bold: !!patch.bold } : {}), ...(patch.italic !== undefined ? { italic: !!patch.italic } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) }),
  };
}

/** The size box with its two step buttons (Docs has the same). */
function SizeBox({ value, onApply }: { value: number; onApply: (size: number) => void }) {
  const [text, setText] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const apply = (n: number) => {
    if (Number.isFinite(n) && n >= 4 && n <= 200) onApply(Math.round(n * 2) / 2);
    else setText(String(Math.round(value * 100) / 100));
  };
  const step = (dir: 1 | -1) => {
    const next = dir > 0 ? SIZES.find((s) => s > value + 0.01) : [...SIZES].reverse().find((s) => s < value - 0.01);
    if (next) apply(next);
  };
  return (
    <div className="pli-size" role="group" aria-label="Font size">
      <button type="button" className="pli-tool" aria-label="Decrease font size" title="Decrease font size" onMouseDown={keepFocus} onClick={() => step(-1)}>
        {Icons.minus}
      </button>
      <input
        className="pli-size-input"
        aria-label="Font size"
        title="Font size"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== "" && Number(text) !== value && apply(Number(text))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            apply(Number(text));
          }
        }}
      />
      <button type="button" className="pli-tool" aria-label="Increase font size" title="Increase font size" onMouseDown={keepFocus} onClick={() => step(1)}>
        {Icons.plus}
      </button>
    </div>
  );
}

function Toggle({ label, shortcut, on, onClick, children }: { label: string; shortcut?: string; on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="pli-tool pli-pdf-tool" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-pressed={on} onMouseDown={keepFocus} onClick={onClick}>
      {children}
    </button>
  );
}

/** What the bar is about now, or null. */
export const formatTarget = (annot: AnnotController | null, edit: EditController | null): Target | null => (annot && boxTarget(annot)) || (edit && editTarget(edit)) || null;

/** Format > Text, Align and Border width: the same choices as the bar, on the same target (disabled when there is no text to format). */
export function formatMenu(annot: AnnotController | null, edit: EditController | null): MenuEntry[] {
  const t = formatTarget(annot, edit);
  const off = !t;
  const bigger = (dir: 1 | -1) => () => {
    if (!t) return;
    const next = dir > 0 ? SIZES.find((s) => s > t.size + 0.01) : [...SIZES].reverse().find((s) => s < t.size - 0.01);
    if (next) t.setText({ size: next });
  };
  return [
    {
      label: "Text",
      items: [
        { label: "Bold", ...(t?.kind === "box" ? { shortcut: `${MOD}B` } : {}), checked: !!t?.bold, disabled: off, onSelect: () => t?.setText({ bold: !t.bold }) },
        { label: "Italic", ...(t?.kind === "box" ? { shortcut: `${MOD}I` } : {}), checked: !!t?.italic, disabled: off, onSelect: () => t?.setText({ italic: !t.italic }) },
        "separator",
        { label: "Increase font size", disabled: off, onSelect: bigger(1) },
        { label: "Decrease font size", disabled: off, onSelect: bigger(-1) },
      ],
    },
    { label: "Align text", disabled: !t?.align, items: (["left", "center", "right"] as const).map((al) => ({ label: al[0]!.toUpperCase() + al.slice(1), checked: t?.align === al, onSelect: () => t?.setText({ align: al }) })) },
    { label: "Border width", disabled: !t?.setWidth, items: WIDTHS.map((w) => ({ label: w === 0 ? "No border" : `${w} pt`, checked: (t?.width ?? 0) === w, onSelect: () => t?.setWidth?.(w) })) },
  ];
}

/** The bar. Renders nothing when there is no text to format. */
export function FormatBar({ annot, edit }: { annot: AnnotController | null; edit: EditController | null }) {
  return annot || edit ? <Bar annot={annot} edit={edit} /> : null;
}

function Bar({ annot, edit }: { annot: AnnotController | null; edit: EditController | null }) {
  useSyncExternalStore(annot?.subscribe ?? never, annot?.getVersion ?? zero, annot?.getVersion ?? zero);
  useSyncExternalStore(edit?.subscribe ?? never, edit?.getSnapshot ?? zero, edit?.getSnapshot ?? zero);
  useSessionRevision((annot ?? edit)!.session);
  const t = formatTarget(annot, edit);
  if (!t) return null;
  const fonts = t.kind === "edit" ? edit!.options.fonts : annot!.options.fonts;
  const box = t.kind === "box";
  const lineLabel = (w: number) => (w === 0 ? "No border" : `${w} pt`);
  return (
    <ToolBar className="pli-pdf-formatbar" aria-label="Text formatting" data-target={t.kind}>
      <div className="pli-group" data-group="font">
        {fonts === false ? (
          <select className="pli-select" aria-label="Font" title="Font" value={STANDARD_FAMILIES.includes(t.family) ? t.family : ""} onChange={(e) => t.setText({ family: e.target.value })}>
            {!STANDARD_FAMILIES.includes(t.family) && <option value="">{t.family}</option>}
            {STANDARD_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : (
          <FontPicker fonts={fonts} value={t.family} mixed={t.mixedFont} onChange={(family) => family && t.setText({ family })} label="Font" />
        )}
        <SizeBox value={t.size} onApply={(size) => t.setText({ size })} />
      </div>
      <div className="pli-group" data-group="marks">
        <Toggle label="Bold" shortcut={box ? `${MOD}B` : undefined} on={t.bold} onClick={() => t.setText({ bold: !t.bold })}>
          <strong>B</strong>
        </Toggle>
        <Toggle label="Italic" shortcut={box ? `${MOD}I` : undefined} on={t.italic} onClick={() => t.setText({ italic: !t.italic })}>
          <em>I</em>
        </Toggle>
        <ColorPicker label="Text colour" value={t.color} icon={Icons.textColor} noneLabel="Black" onChange={(color) => t.setText({ color: color ?? "#000000" })} />
        {box && t.setFill && <ColorPicker label="Fill colour" value={t.fill} icon={Icons.fill} noneLabel="No fill" onChange={(color) => t.setFill!(color ?? undefined)} />}
      </div>
      {box && (
        <div className="pli-group" data-group="align">
          {(["left", "center", "right"] as const).map((al) => (
            <Toggle key={al} label={`Align ${al}`} on={t.align === al} onClick={() => t.setText({ align: al })}>
              {Icons[al]}
            </Toggle>
          ))}
        </div>
      )}
      {box && t.setWidth && (
        <div className="pli-group" data-group="border">
          <Dropdown label="Border width" panel={(close) => <MenuList label="Border width" close={close} items={WIDTHS.map((w) => ({ label: lineLabel(w), checked: (t.width ?? 0) === w, onSelect: () => t.setWidth!(w) }))} />}>
            {I.borderWidth}
          </Dropdown>
        </div>
      )}
    </ToolBar>
  );
}

const never = () => () => {};
const zero = () => 0;
