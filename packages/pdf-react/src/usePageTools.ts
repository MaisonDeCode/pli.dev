/**
 * Wires the page tools, the file commands and the outline editing into a viewer: one set of controllers per session,
 * kept up to date with the props of the viewer. `PliPdf` calls it; a host that builds its own layout can too.
 */
import { createContext, useContext, useEffect, useMemo } from "react";
import type { PdfSession } from "@pli.dev/pdf";
import { FileActions, type FileHooks } from "./fileActions";
import { setSelection } from "./hooks";
import { createOutlineEdit, type OutlineEdit, type OutlineHere } from "./outlineEdit";
import { PageTools } from "./pageTools";
import type { PdfRenderer } from "./renderer";
import { Notices } from "./store";

export interface PageToolsKitOptions {
  session: PdfSession;
  renderer: PdfRenderer;
  readOnly: boolean;
  hooks: FileHooks;
  /** Ask the browser to confirm closing the tab while there are unsaved changes. */
  warnOnUnload?: boolean;
  /** The page shown and how far down it the view is, for "add a bookmark here". */
  here: () => OutlineHere | null;
}

/** The controllers a viewer's page and file UI is made of. */
export interface PageToolsKit {
  notices: Notices;
  tools: PageTools;
  files: FileActions;
  outline: OutlineEdit;
}

const KitContext = createContext<PageToolsKit | null>(null);
export const PageToolsProvider = KitContext.Provider;

/** The page tools and file commands of the viewer this is used in (inside `PliPdf`). Null when they are turned off. */
export function usePageTools(): PageToolsKit | null {
  return useContext(KitContext);
}

export function usePageToolsKit(o: PageToolsKitOptions): PageToolsKit {
  const { session, renderer } = o;
  const hereRef = useMemo(() => ({ current: o.here }), []);
  hereRef.current = o.here;
  const kit = useMemo<PageToolsKit>(() => {
    const notices = new Notices();
    const tools = new PageTools(session, notices);
    const files = new FileActions(session, renderer, notices, () => tools.selected());
    const outline = createOutlineEdit(session, notices, () => hereRef.current());
    return { notices, tools, files, outline };
  }, [session, renderer, hereRef]);
  // The host's callbacks and the read-only flag are read on every call, so they are kept current on each render.
  kit.tools.readOnly = o.readOnly;
  kit.tools.options.download = o.hooks.download;
  kit.tools.options.picker = o.hooks.picker;
  kit.files.readOnly = o.readOnly;
  kit.files.hooks = o.hooks;
  useEffect(
    () => () => {
      kit.tools.dispose();
      kit.files.dispose();
    },
    [kit],
  );

  // `markSaved` is not a change of the document, so nothing would redraw the unsaved dot when the host calls it.
  useEffect(() => {
    const original = session.markSaved;
    session.markSaved = function (this: PdfSession) {
      original.call(this);
      setSelection(this, {});
    };
    return () => {
      session.markSaved = original;
    };
  }, [session]);

  const guard = !!o.warnOnUnload && session.dirty;
  useEffect(() => {
    if (!guard || typeof window === "undefined") return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need a value; current ones show their own text.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [guard]);
  return kit;
}
