/**
 * What the annotation tools add to the menus, described once: the ribbon's buttons and menus are made from the same commands
 * and the same lists, so a tool has one name, one key and one on/off state wherever it is offered.
 */
import type { MenuEntry } from "@pli.dev/react";
import { AnnotIcons as I } from "./annotIcons";
import type { AnnotController, ToolId } from "./annotController";
import { TOOL_INFO } from "./annotTools";
import { MOD } from "./annotKeys";
import { dateStamp } from "./stamps";
import { loadSignatures, removeSignature, type SavedSignature, type SignatureValue } from "./signatures";
import { commandItem, menuGroups, type PdfCommand, type PdfMenus } from "./commands";
import { canMove } from "./annotGeometry";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "");
const ALT = MAC ? "⌥" : "Alt+";

/** A tool as a command: pressing it puts the tool down or takes it up. */
export function toolCommand(c: AnnotController, id: ToolId): PdfCommand {
  const m = TOOL_INFO[id];
  return { id: `tool.${id}`, label: m.label, icon: m.icon, shortcut: m.shortcut, checked: c.toolId === id, disabled: c.readOnly, run: () => c.setTool(c.toolId === id ? null : id) };
}

/** The commands of the annotation tools that are not a tool: a comment on the selection, picture, show links, and what edits a selection. */
export function annotCommands(c: AnnotController): Record<string, PdfCommand> {
  const sel = c.selectedIds.length;
  const ro = c.readOnly;
  const list: PdfCommand[] = [
    { id: "comment", label: "Comment on selection", icon: I.comment, shortcut: `${MOD}${ALT}M`, disabled: ro || !c.tools.has("note"), run: () => void c.commentOnSelection() },
    { id: "picture", label: "Picture", icon: I.image, shortcut: TOOL_INFO.image.shortcut, disabled: ro || !c.tools.has("image") || !c.actions.pickImage, run: () => c.actions.pickImage?.() },
    { id: "showLinks", label: "Show links", icon: I.showLinks, checked: c.showLinks, run: () => ((c.showLinks = !c.showLinks), c.emit()) },
    { id: "cut", label: "Cut", shortcut: `${MOD}X`, disabled: ro || sel === 0, run: () => c.cut() },
    { id: "copy", label: "Copy", shortcut: `${MOD}C`, disabled: sel === 0, run: () => void c.copy() },
    { id: "paste", label: "Paste", shortcut: `${MOD}V`, disabled: ro || !c.clipboard, run: () => void c.paste() },
    { id: "duplicate", label: "Duplicate", shortcut: `${MOD}D`, disabled: ro || sel === 0, run: () => c.duplicate() },
    { id: "delete", label: "Delete", shortcut: "Delete", disabled: ro || sel === 0 || c.selected.every((a) => a.locked), run: () => c.deleteSelected() },
    { id: "selectAll", label: "Select all annotations", shortcut: `${MOD}A`, disabled: ro, run: () => c.selectAll() },
  ];
  return Object.fromEntries(list.map((x) => [x.id, x]));
}

const SHAPES: ToolId[] = ["rectangle", "ellipse", "line", "arrow", "polyline", "polygon"];

/** The shapes the ribbon's Shapes button lists. */
export function shapeIds(c: AnnotController): ToolId[] {
  return SHAPES.filter((id) => c.tools.has(id));
}

/** The shapes menu: choosing one puts its tool down. `chosen` hears which. */
export function shapeItems(c: AnnotController, chosen?: (id: ToolId) => void): MenuEntry[] {
  return shapeIds(c).map((id) => ({ label: TOOL_INFO[id].label, shortcut: TOOL_INFO[id].shortcut, checked: c.toolId === id, onSelect: () => (chosen?.(id), c.setTool(id)) }));
}

export function stampItems(c: AnnotController): MenuEntry[] {
  return [
    ...c.stamps.map((s) => ({ label: s.label, onSelect: () => c.chooseStamp(s) })),
    "separator",
    { label: `Today's date (${dateStamp(c.now()).label})`, onSelect: () => c.chooseStamp(dateStamp(c.now())) },
    { label: "Custom text…", onSelect: () => c.openDialog("stamp-text") },
  ];
}

const summary = (v: SignatureValue): string => (v.mode === "type" ? v.text : v.mode === "draw" ? "Drawn" : "Picture");

export function signatureItems(c: AnnotController): MenuEntry[] {
  const saved: SavedSignature[] = loadSignatures(c.namespace, c.user?.id);
  return [
    ...saved.map((s, i) => ({ label: `${s.kind === "initials" ? "Initials" : "Signature"} ${i + 1}: ${summary(s.value)}`, onSelect: () => c.chooseSignature(s.value, s.kind === "initials" ? 70 : 150) }) as MenuEntry),
    ...(saved.length ? (["separator"] as MenuEntry[]) : []),
    { label: "Create signature…", onSelect: () => c.openDialog("signature") },
    { label: "Create initials…", onSelect: () => c.openDialog("initials") },
    ...(saved.length
      ? ([
          "separator",
          {
            label: "Forget saved signatures",
            onSelect: () => {
              for (const s of saved) removeSignature(c.namespace, c.user?.id, s.id);
            },
          },
        ] as MenuEntry[])
      : []),
  ];
}

export function redactItems(c: AnnotController): MenuEntry[] {
  const marks = c.redactionCount();
  return [
    { label: "Mark an area", shortcut: TOOL_INFO.redact.shortcut, onSelect: () => c.setTool("redact") },
    {
      label: "Mark selected text",
      onSelect: () => {
        const sel = c.readSelection();
        if (sel.length === 0) c.announce("Select some text first");
        else c.markRedaction(sel);
      },
    },
    "separator",
    { label: marks.marks ? `Apply ${marks.marks} ${marks.marks === 1 ? "redaction" : "redactions"}…` : "Apply redactions…", disabled: marks.marks === 0, onSelect: () => c.openDialog("apply-redactions") },
  ];
}

/** Order, align and distribute: what Format > Arrange offers (and the properties panel). */
export function arrangeItems(c: AnnotController): MenuEntry[] {
  const list = c.selected;
  const movable = list.some(canMove) && !c.readOnly;
  const many = c.arrangeable().length;
  const ro = c.readOnly;
  const align = (how: Parameters<AnnotController["align"]>[0], label: string): MenuEntry => ({ label, disabled: ro || many < 2, onSelect: () => c.align(how) });
  return [
    { label: "Bring to front", shortcut: `${MOD}Shift+]`, disabled: !movable, onSelect: () => c.reorder("front") },
    { label: "Bring forward", shortcut: `${MOD}]`, disabled: !movable, onSelect: () => c.reorder("forward") },
    { label: "Send backward", shortcut: `${MOD}[`, disabled: !movable, onSelect: () => c.reorder("backward") },
    { label: "Send to back", shortcut: `${MOD}Shift+[`, disabled: !movable, onSelect: () => c.reorder("back") },
    "separator",
    { label: "Align horizontally", items: [align("left", "Left"), align("center", "Center"), align("right", "Right")] },
    { label: "Align vertically", items: [align("top", "Top"), align("middle", "Middle"), align("bottom", "Bottom")] },
    { label: "Distribute", items: [{ label: "Horizontally", disabled: ro || many < 3, onSelect: () => c.distribute("horizontal") }, { label: "Vertically", disabled: ro || many < 3, onSelect: () => c.distribute("vertical") }] },
    "separator",
    { label: list.length > 0 && list.every((a) => a.locked) ? "Unlock" : "Lock", disabled: ro || list.length === 0, onSelect: () => c.setLocked(list.map((a) => a.id), !list.every((a) => a.locked)) },
  ];
}

/** What the annotation tools add to the menus. */
export function annotMenus(c: AnnotController): PdfMenus {
  const k = annotCommands(c);
  const t = (id: ToolId) => (c.tools.has(id) ? commandItem(toolCommand(c, id)) : null);
  const markup = (["highlight", "underline", "strikeout", "squiggly"] as ToolId[]).filter((id) => c.tools.has(id));
  const shapes = shapeIds(c);
  return {
    Edit: menuGroups([commandItem(k.cut!), commandItem(k.copy!), commandItem(k.paste!), commandItem(k.duplicate!), commandItem(k.delete!)], [commandItem(k.selectAll!)]),
    View: menuGroups([commandItem(k.showLinks!)]),
    Insert: menuGroups(
      [
        t("text"),
        c.tools.has("image") ? commandItem(k.picture!, "Image…") : null,
        shapes.length ? { label: "Shape", items: shapeItems(c) } : null,
        t("ink") ? { ...t("ink")!, label: "Drawing (pen)" } : null,
        c.tools.has("signature") ? { label: "Signature", items: signatureItems(c) } : null,
        c.tools.has("stamp") ? { label: "Stamp", items: stampItems(c) } : null,
        t("note"),
        c.tools.has("note") ? commandItem(k.comment!, "Comment") : null,
        t("link"),
      ],
      markup.length ? [{ label: "Mark up text", items: markup.map((id) => commandItem(toolCommand(c, id))) }] : null,
    ),
    Format: menuGroups([{ label: "Arrange", items: arrangeItems(c) }]),
    Tools: menuGroups(c.tools.has("redact") ? [{ label: "Redact", items: redactItems(c) }] : null),
  };
}
