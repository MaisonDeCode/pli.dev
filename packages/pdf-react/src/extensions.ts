import { createContext, useContext, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { CollabRoom, CommentClient, Users } from "@pli.dev/core";
import type { Page, PdfAnchor, PdfSession } from "@pli.dev/pdf";
import type { PageFrame, Zoom } from "./geometry";
import type { ViewMode } from "./layout";

/** What a tool, overlay or panel is told about a page. */
export interface PageContext {
  session: PdfSession;
  readOnly: boolean;
  page: Page;
  /** Position of the page in the document. */
  index: number;
  /** The page's size in points, not turned: the overlay's coordinate system. */
  width: number;
  height: number;
  /** Degrees the page is shown turned, and CSS pixels per point. Tools draw in page space and need neither; handles do. */
  rotation: number;
  scale: number;
  frame: PageFrame;
}

/** A pointer event on a page, in page space (points, y down, not turned), whatever the zoom and the turn of the view. */
export interface PagePointerEvent extends PageContext {
  /** Page space. */
  x: number;
  y: number;
  type: "down" | "move" | "up";
  pointerType: string;
  button: number;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  native: ReactPointerEvent;
}

/**
 * A tool of the toolbar (a pen, a highlighter, a text box, a stamp). While it is active each page covers itself with a
 * layer that receives the pointer and calls these functions, and draws `overlay`. The annotation, form and page tools of
 * the later stages are all `PdfTool`s given to `PliPdf`'s `tools` prop.
 */
export interface PdfTool {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  /** The mouse pointer over a page (CSS `cursor`). */
  cursor?: string;
  /** Keep the text of the page selectable while the tool is active (the highlight tool does). */
  selectText?: boolean;
  /** Hide the tool in read-only viewers (default true). */
  needsEdit?: boolean;
  /** Registered but not given a button in the toolbar: the host draws its own (the annotation ribbon does). */
  hidden?: boolean;
  /** One line telling what to do with the tool (shown by hosts that have room; read by screen readers). */
  hint?: string;
  /** Called with pointer events on a page. The pointer is captured from `down` to `up`. */
  onPointer?(e: PagePointerEvent): void;
  /** Called when the tool is deactivated or Escape is pressed. */
  onCancel?(): void;
  /** Drawn on top of every page while the tool is active (SVG in page space). */
  overlay?(ctx: PageContext): ReactNode;
  /** Called when text is selected in a text layer while the tool is active (highlight, underline, strike-out). */
  onTextSelected?(selection: import("./geometry").SelectedText[]): void;
}

/** A panel: a tab of the left sidebar, or the right panel. */
export interface PdfPanel {
  id: string;
  label: string;
  icon?: ReactNode;
  render(ctx: PdfViewContext): ReactNode;
}

/** What the viewer gives to the things plugged into it. */
export interface PdfViewContext {
  session: PdfSession;
  readOnly: boolean;
  user?: { id: string; name?: string };
  /** Collaboration: the room, the people (and the current user), and the comments client (null when comments are off). */
  room?: CollabRoom<PdfAnchor>;
  users?: Users;
  comments?: CommentClient<PdfAnchor> | null;
  /** Position of the page shown, and its id. */
  pageIndex: number;
  pageId: string | null;
  pageCount: number;
  zoom: Zoom;
  /** The zoom as a fraction (1 is 100%) and as CSS pixels per point, with fit modes worked out. */
  zoomValue: number;
  scale: number;
  viewMode: ViewMode;
  /** Degrees the view is turned. */
  viewRotation: number;
  /** The pages selected in the thumbnails. */
  selectedPages: string[];
  tool: string | null;
  /** Go to a page (a position or an id), and to a height on it (page space). */
  goToPage(page: number | string, y?: number): void;
  setZoom(zoom: Zoom): void;
  setViewMode(mode: ViewMode): void;
  rotateView(degrees?: 90 | -90): void;
  setTool(id: string | null): void;
  setSelectedPages(ids: readonly string[]): void;
  /** Opens the find bar, optionally searching for `query`. */
  find(query?: string): void;
  /** The element that shows a page (for anchoring popups). */
  pageElement(id: string): HTMLElement | null;
  /** The scrolling area. */
  scroller(): HTMLElement | null;
}

export const PdfViewContextValue = createContext<PdfViewContext | null>(null);

/** The viewer's state and commands, for components plugged into it. */
export function usePdfView(): PdfViewContext {
  const ctx = useContext(PdfViewContextValue);
  if (!ctx) throw new Error("usePdfView must be used inside <PliPdf>");
  return ctx;
}
