/**
 * The state of the viewer's frame: whether the sidebar is open, which tab, how wide, and whether the properties panel
 * (the right panel) is open. It is kept per `PdfSession`, so a viewer that is mounted again for the same document (a tab
 * switch, a host that re-renders it from scratch) comes back the way the person left it. The sidebar's width and the
 * choices that are not about one selection are also kept in the browser (`localStorage`, guarded: it may be missing or full)
 * so the next document starts the same.
 *
 * THE PROPERTIES PANEL: open or closed is decided here, from three things.
 * - `key`: what the panel would show now (the selected annotation, field, edit), or `null` when there is nothing to show.
 * - `manual`: the person opened it (the toolbar button, the shortcut). It then stays open until they close it, selection or not.
 * - `closedFor`: the person closed it while `key` was showing. It stays closed until they select something else (the key
 *   changes, or goes to `null` and comes back) or open it again.
 * The panel opens by itself only where there is room for it (a wide viewer): in a narrow one it is a sheet over the page, and
 * a sheet that appears whenever something is touched would be in the way.
 */
import type { PdfSession } from "@pli.dev/pdf";
import { Store } from "./store";

/** How wide the viewer is: a phone (drawers), narrow (the properties panel is a sheet), or wide (everything docked). */
export type ShellSize = "phone" | "narrow" | "wide";

/** Below these widths of the viewer itself (not of the window) the layout changes. */
export const PHONE_WIDTH = 640;
export const NARROW_WIDTH = 900;
/** The width to lay out for where the browser reports none (a test, a hidden host). */
export const DEFAULT_HOST_WIDTH = 1280;

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 400;
export const SIDEBAR_DEFAULT = 240;
export const SIDEBAR_STEP = 16;
/** The sidebar never takes more than this much of the viewer. */
export const SIDEBAR_SHARE = 0.4;

export const sizeOf = (width: number): ShellSize => (width < PHONE_WIDTH ? "phone" : width < NARROW_WIDTH ? "narrow" : "wide");

/** The widest the sidebar may be in a viewer this wide. */
export const sidebarMax = (hostWidth: number): number => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.floor(hostWidth * SIDEBAR_SHARE)));

export const clampSidebar = (width: number, hostWidth: number): number => {
  const w = Number.isFinite(width) ? Math.round(width) : SIDEBAR_DEFAULT;
  return Math.max(SIDEBAR_MIN, Math.min(sidebarMax(hostWidth), w));
};

/** What stands in for "something is selected" when the host's own panel does not say (it always has something to show). */
export const ALWAYS = "*";

const STORAGE_KEY = "pli.pdf.shell";

interface Saved {
  sidebar?: boolean;
  sidebarWidth?: number;
  panel?: boolean;
}

function load(): Saved {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object") return {};
    const o = v as Record<string, unknown>;
    return {
      sidebar: typeof o.sidebar === "boolean" ? o.sidebar : undefined,
      sidebarWidth: typeof o.sidebarWidth === "number" ? o.sidebarWidth : undefined,
      panel: typeof o.panel === "boolean" ? o.panel : undefined,
    };
  } catch {
    return {};
  }
}

function save(patch: Saved): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    // Private windows and full disks: the choice just does not outlive the session.
  }
}

export interface ShellInit {
  /** The sidebar tab to start with. */
  tab?: string;
  /** False: start with the sidebar closed (true leaves it to the size). */
  sidebar?: boolean;
}

export class ShellState extends Store {
  /** True or false once the person has chosen; undefined leaves it to the size (open, except on a phone). */
  sidebar: boolean | undefined;
  tab: string | undefined;
  width: number;
  /** The person opened the properties panel. */
  manual: boolean;
  /** What the panel was showing when the person closed it. */
  closedFor: string | null = null;

  constructor(init: ShellInit = {}) {
    super();
    const saved = load();
    this.sidebar = init.sidebar === false ? false : saved.sidebar;
    this.tab = init.tab;
    this.width = clampSidebar(saved.sidebarWidth ?? SIDEBAR_DEFAULT, 10_000);
    this.manual = saved.panel === true;
  }

  sidebarOpen(size: ShellSize): boolean {
    return this.sidebar ?? size !== "phone";
  }

  /** `remember` is false for a phone, where the sidebar is a drawer that should not reopen by itself next time. */
  setSidebar(open: boolean, remember = true): void {
    if (this.sidebar === open) return;
    this.sidebar = open;
    if (remember) save({ sidebar: open });
    this.emit();
  }

  setTab(id: string): void {
    if (this.tab === id) return;
    this.tab = id;
    this.emit();
  }

  setWidth(width: number, hostWidth = 10_000): void {
    const next = clampSidebar(width, hostWidth);
    if (next === this.width) return;
    this.width = next;
    this.emit();
  }

  /** Remembers the width in the browser (at the end of a drag, not at every step). */
  rememberWidth(): void {
    save({ sidebarWidth: this.width });
  }

  resetWidth(): void {
    this.width = SIDEBAR_DEFAULT;
    save({ sidebarWidth: SIDEBAR_DEFAULT });
    this.emit();
  }

  /** Is the properties panel open, for what it would show (`key`) and the size of the viewer? */
  panelOpen(key: string | null, size: ShellSize): boolean {
    if (this.manual) return true;
    return size === "wide" && key !== null && key !== this.closedFor;
  }

  /** Opens the panel and keeps it open until it is closed. */
  openPanel(): void {
    if (this.manual && this.closedFor === null) return;
    this.manual = true;
    this.closedFor = null;
    save({ panel: true });
    this.emit();
  }

  /** Closes the panel; it stays closed while `key` (what it showed) stays selected. */
  closePanel(key: string | null): void {
    this.manual = false;
    this.closedFor = key;
    save({ panel: false });
    this.emit();
  }

  /** Nothing is selected any more: selecting the same thing again is selecting something new. */
  forgetClosed(): void {
    if (this.closedFor === null) return;
    this.closedFor = null;
    this.emit();
  }
}

const states = new WeakMap<PdfSession, ShellState>();

/** The frame state of a session (made on first use). */
export function shellOf(session: PdfSession, init?: ShellInit): ShellState {
  let s = states.get(session);
  if (!s) states.set(session, (s = new ShellState(init)));
  return s;
}
