/**
 * The keyboard shortcuts of the viewer, in one place.
 *
 * Each stage (page tools, annotation tools, forms) lists its shortcuts with `registerShortcuts(group, rows)`. The
 * documentation page and the keyboard help are written from `shortcutGroups()`, so they never drift from the code.
 *
 * `claimKey(event)` says whether a key press is still free: the first handler to call it gets `true`, any later one
 * gets `false`. Two handlers for the same key (undo, say) call it so that the key is handled once.
 */

/** One row of the keyboard table. */
export interface Shortcut {
  keys: string;
  action: string;
}

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
/** The modifier as it is written for this platform: `⌘` or `Ctrl+`. */
export const MOD = MAC ? "⌘" : "Ctrl+";

/** The keys that show and hide the sidebar and the properties panel, as they are written for this platform (Alt+Shift+letter; Option on a Mac). */
export const SIDEBAR_KEYS = MAC ? "⌥⇧S" : "Alt+Shift+S";
export const PROPERTIES_KEYS = MAC ? "⌥⇧P" : "Alt+Shift+P";
/** The same family for the view commands that had a button on the old toolbar: go to a page, fit width, fit page, turn the view, full screen. */
export const GOTO_KEYS = MAC ? "⌥⇧G" : "Alt+Shift+G";
export const FIT_WIDTH_KEYS = MAC ? "⌥⇧W" : "Alt+Shift+W";
export const FIT_PAGE_KEYS = MAC ? "⌥⇧A" : "Alt+Shift+A";
export const ROTATE_VIEW_KEYS = MAC ? "⌥⇧R" : "Alt+Shift+R";
export const FULLSCREEN_KEYS = MAC ? "⌥⇧F" : "Alt+Shift+F";

const groups = new Map<string, () => readonly Shortcut[]>();

/** Adds (or replaces) a named group of shortcuts. Returns a function that takes it out again. */
export function registerShortcuts(group: string, rows: () => readonly Shortcut[]): () => void {
  groups.set(group, rows);
  return () => {
    if (groups.get(group) === rows) groups.delete(group);
  };
}

/** Every registered group with its rows, in the order they were registered. */
export function shortcutGroups(): { group: string; rows: Shortcut[] }[] {
  return [...groups].map(([group, rows]) => ({ group, rows: [...rows()] }));
}

const claimed = new WeakSet<object>();

/** True the first time it is called for a key event, false after that: whoever gets `true` handles the key. */
export function claimKey(event: Event | { nativeEvent: Event }): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  if (claimed.has(native)) return false;
  claimed.add(native);
  return true;
}

/** The shortcuts of the page tools: the thumbnails, the organise view, the outline and the file commands. */
export function pageShortcutTable(): Shortcut[] {
  return [
    { keys: `${MOD}Shift+R`, action: "Turn the selected pages a quarter turn clockwise" },
    { keys: `${MOD}Shift+L`, action: "Turn the selected pages a quarter turn anticlockwise" },
    { keys: `${MOD}Shift+Delete`, action: "Delete the selected pages (asks first when there are several, or they carry annotations)" },
    { keys: `${MOD}Z, ${MOD}Shift+Z, ${MOD}Y`, action: "Undo, redo" },
    { keys: `${MOD}S`, action: "Save" },
    { keys: `${MOD}Shift+S`, action: "Save a copy" },
    { keys: `${MOD}P`, action: "Print" },
    { keys: `${MOD}O`, action: "Open a PDF (when the app allows it)" },
    { keys: "Arrow keys", action: "In the thumbnails and the organise view: go to the next or previous page" },
    { keys: "Shift+Arrow keys", action: "Extend the selection" },
    { keys: `${MOD}A`, action: "Select every page" },
    { keys: "Alt+Arrow keys", action: "Move the selected pages one place" },
    { keys: "Alt+Home, Alt+End", action: "Move the selected pages to the start or the end" },
    { keys: "Delete or Backspace", action: "Delete the selected pages" },
    { keys: "R, Shift+R", action: "Turn the selected pages clockwise, anticlockwise" },
    { keys: `${MOD}D`, action: "Duplicate the selected pages" },
    { keys: "Insert", action: "Insert a blank page after the selected pages" },
    { keys: "Enter", action: "Show the page (in the organise view: close the view and go to it)" },
    { keys: "Context menu key or Shift+F10", action: "Open the page menu" },
    { keys: "Esc", action: "Close the page menu, the organise view or a dialog" },
    { keys: "F2", action: "In the outline: rename the bookmark" },
    { keys: "Delete", action: "In the outline: delete the bookmark" },
    { keys: "Alt+Up, Alt+Down", action: "In the outline: move the bookmark up or down" },
    { keys: "Alt+Shift+Right, Alt+Shift+Left", action: "In the outline: indent, outdent" },
  ];
}


/** The shortcuts of the viewer itself: zoom, find, moving between pages. */
export function viewerShortcutTable(): Shortcut[] {
  return [
    { keys: `${MOD}Plus, ${MOD}Minus`, action: "Zoom in, zoom out" },
    { keys: `${MOD}0`, action: "Zoom to 100%" },
    { keys: `${MOD}F`, action: "Find in the document" },
    { keys: `${MOD}H`, action: "Find and replace (with the Edit tool on)" },
    { keys: "Enter, Shift+Enter", action: "In the find bar: next match, previous match" },
    { keys: `${MOD}G, ${MOD}Shift+G`, action: "Next match, previous match" },
    { keys: "Page Down, Page Up", action: "Next page, previous page (one screen at a time when the page is taller than the view)" },
    { keys: "Home, End", action: "First page, last page" },
    { keys: "Left, Right", action: "One page back or forward, in the single page and two page layouts" },
    { keys: "Enter, Esc", action: "In the page number box of the status bar: go to the page, give up" },
    { keys: "Esc", action: "Close the organise view, then the find bar, then put the tool down" },
    { keys: `${MOD}/, ?`, action: "Show this list of keys" },
    { keys: SIDEBAR_KEYS, action: "Show or hide the sidebar" },
    { keys: PROPERTIES_KEYS, action: "Show or hide the properties panel" },
    { keys: GOTO_KEYS, action: "Go to a page: puts the cursor in the page box of the status bar" },
    { keys: `${FIT_WIDTH_KEYS}, ${FIT_PAGE_KEYS}`, action: "Zoom to fit the width of the page, or the whole page" },
    { keys: ROTATE_VIEW_KEYS, action: "Turn the view a quarter turn clockwise (the file is not changed)" },
    { keys: FULLSCREEN_KEYS, action: "Full screen on or off" },
    { keys: "Esc", action: "In the properties panel: close it" },
    { keys: "Left, Right, Home, End", action: "On the sidebar's resize handle: make it narrower or wider by 16 pixels, or as narrow or wide as it goes (Shift: 64 pixels)" },
    { keys: "Double click", action: "On the sidebar's resize handle: back to the usual width" },
  ];
}

/** The shortcuts of filling in a form and of Prepare form. */
export function formShortcutTable(): Shortcut[] {
  return [
    { keys: "Tab, Shift+Tab", action: "Next field, previous field, in reading order (also across pages)" },
    { keys: "Enter", action: "In a one-line text box or an editable drop-down: go to the next field. In a text area: a new line" },
    { keys: "Esc", action: "In a text box: put back the text it had when you came to it" },
    { keys: "Arrow keys", action: "In a radio group: choose the next or previous button" },
    { keys: "Shift+Enter", action: "Prepare form, on a field type button: put a field of that type in the middle of the page" },
    { keys: "Enter", action: "Prepare form: finish the radio group you are placing" },
    { keys: "Arrow keys", action: "Prepare form: move the selected field by 1 point (Shift: 10 points)" },
    { keys: "Alt+Arrow keys", action: "Prepare form: make the selected field wider, narrower, taller or shorter by 1 point (Shift: 10 points)" },
    { keys: `${MOD}D`, action: "Prepare form: duplicate the selected field" },
    { keys: "Delete or Backspace", action: "Prepare form: delete the selected field" },
    { keys: "Enter or Space", action: "Prepare form: select the focused field" },
    { keys: "Esc", action: "Prepare form: clear the selection" },
  ];
}

registerShortcuts("Viewer", viewerShortcutTable);
registerShortcuts("Pages and files", pageShortcutTable);
registerShortcuts("Forms", formShortcutTable);
