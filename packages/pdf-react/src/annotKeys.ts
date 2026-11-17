import type { AnnotController, ToolId } from "./annotController";
import { TOOL_INFO, TOOL_KEYS } from "./annotTools";

import { MOD, claimKey, registerShortcuts, type Shortcut } from "./shortcuts";

export { MOD, type Shortcut };

const ALT = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "") ? "⌥" : "Alt+";

/** Every shortcut of the annotation tools. */
export function shortcutTable(): Shortcut[] {
  const tools = (Object.keys(TOOL_INFO) as ToolId[]).map((id) => ({ keys: TOOL_INFO[id].shortcut, action: TOOL_INFO[id].label + " tool" }));
  return [
    ...tools,
    { keys: "Esc", action: "Cancel what you are drawing; then clear the selection; then put the tool down" },
    { keys: "Enter", action: "Finish a polyline or polygon. Edit the selected text box. Open the selected note" },
    { keys: "Delete or Backspace", action: "Delete the selected annotations" },
    { keys: "Arrow keys", action: "Move the selected annotations by 1 point (Shift: 10 points)" },
    { keys: "Shift+click", action: "Add or remove an annotation from the selection" },
    { keys: `${MOD}A`, action: "Select every annotation on the page" },
    { keys: `${MOD}D`, action: "Duplicate the selected annotations" },
    { keys: `${MOD}C, ${MOD}X, ${MOD}V`, action: "Copy, cut and paste annotations (within the document)" },
    { keys: `${MOD}]  ${MOD}[`, action: "Bring forward, send backward" },
    { keys: `${MOD}Shift+]  ${MOD}Shift+[`, action: "Bring to front, send to back" },
    { keys: `${MOD}Z, ${MOD}Shift+Z`, action: "Undo, redo" },
    { keys: `${MOD}Enter`, action: "Send a comment" },
    { keys: `${MOD}${ALT}M`, action: "Comment on the selected text (with no text selected: the Note tool)" },
    { keys: `${MOD}B, ${MOD}I`, action: "Bold, italic for the selected text boxes (also while typing in one)" },
  ];
}

export const isField = (t: EventTarget | null): boolean => t instanceof HTMLElement && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
export const inPanel = (t: EventTarget | null): boolean => t instanceof HTMLElement && !!t.closest("dialog, [role=dialog], [role=menu], [role=listbox], [role=tree], .pli-panel, .pli-popover");
/** Keys of the sidebar (thumbnails, outline), the organise view and the find bar are theirs: a letter there is not a tool. */
export const inOwnArea = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.closest(".pli-pdf")?.hasAttribute("data-organise")) return true;
  return !!t.closest(".pli-pdf-sidebar, .pli-pdf-right, .pli-pdf-find, .pli-pdf-organise");
};
const isButton = (t: EventTarget | null): boolean => t instanceof HTMLElement && !!t.closest("button, a[href], summary, [role=tab], [role=menuitem]");

registerShortcuts("Annotations", shortcutTable);

export interface KeyLike {
  /** The key event, for `claimKey` (undo and redo are shared with the page tools: the first handler to claim the key does it). */
  event?: Event | { nativeEvent: Event };
  key: string;
  /** The physical key (`KeyM`), for keys that a modifier changes the letter of. */
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

const hasTextSelection = (): boolean => {
  try {
    const s = window.getSelection?.();
    return !!s && !s.isCollapsed && s.toString() !== "";
  } catch {
    return false;
  }
};

/**
 * Handles a key of the annotation tools. Returns true when it did something (the caller then stops the key reaching the
 * viewer). Keys typed into fields, menus and dialogs are left alone, apart from Escape.
 */
export function handleAnnotKey(c: AnnotController, e: KeyLike): boolean {
  const key = e.key;
  if (key === "Escape") {
    if (c.editing) return (c.finishEdit(), true);
    if (c.dialog) return false;
    if (isField(e.target) && !c.popover) return false;
    if (c.placing) {
      c.cancelDraft();
      c.placing = null;
      c.setTool("select");
      return true;
    }
    if (c.popover || c.draft || c.preview.size > 0) {
      c.cancelDraft();
      return true;
    }
    if (c.textSelection) {
      c.textSelection = null;
      c.emit();
      return true;
    }
    if (c.selectedIds.length > 0 && !inOwnArea(e.target)) {
      c.clearSelection();
      return true;
    }
    return false;
  }
  if (c.readOnly || isField(e.target) || inPanel(e.target) || inOwnArea(e.target)) return false;
  const mod = e.ctrlKey || e.metaKey;
  const k = key.toLowerCase();
  // Ctrl+Alt+M: comment on the selected text (or put the Note tool down), as in Docs.
  if (mod && e.altKey && !e.shiftKey && (e.code === "KeyM" || k === "m")) return (c.commentOnSelection(), true);
  if (mod && !e.altKey) {
    if ((k === "b" || k === "i") && !e.shiftKey && c.toggleTextStyle(k === "b" ? "bold" : "italic")) return true;
    if (k === "z" || k === "y") {
      if (e.event && !claimKey(e.event)) return false;
      return (k === "y" || e.shiftKey ? c.redo() : c.undo(), true);
    }
    if (k === "d" && c.selectedIds.length > 0) return (c.duplicate(), true);
    if (k === "a" && (c.toolId === "select" || c.selectedIds.length > 0) && !hasTextSelection()) return (c.selectAll(), true);
    if ((k === "c" || k === "x") && c.selectedIds.length > 0 && !hasTextSelection()) return (k === "c" ? c.copy() : c.cut(), true);
    if (k === "v" && c.clipboard) return c.paste();
    if ((key === "]" || key === "[" || key === "}" || key === "{") && c.selectedIds.length > 0) {
      const up = key === "]" || key === "}";
      c.reorder(e.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward");
      return true;
    }
    return false;
  }
  if (e.altKey || mod) return false;
  if (key === "Enter") {
    if (c.draft?.type === "poly") return c.finishPoly();
    if (isButton(e.target)) return false;
    const [only] = c.selected;
    if (c.selected.length === 1 && only) {
      if (only.type === "freetext") return (c.beginEdit(c.pageOf(only.id)!, only, false), true);
      if (only.type === "note" || only.type === "highlight" || only.type === "underline" || only.type === "strikeout" || only.type === "squiggly") return (c.openComment(only.id), true);
    }
    return false;
  }
  if ((key === "Delete" || key === "Backspace") && c.selectedIds.length > 0) return (c.deleteSelected(), true);
  if (key.startsWith("Arrow") && c.selectedIds.length > 0 && !isButton(e.target)) {
    const step = e.shiftKey ? 10 : 1;
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    if (c.selected.some((a) => !a.locked && a.type !== "highlight" && a.type !== "underline" && a.type !== "strikeout" && a.type !== "squiggly")) {
      c.nudge(dx, dy);
      return true;
    }
    return false;
  }
  if (key.length === 1) {
    const tool = TOOL_KEYS[k];
    if (tool && c.tools.has(tool)) {
      c.chooseByKey(tool);
      return true;
    }
  }
  return false;
}
