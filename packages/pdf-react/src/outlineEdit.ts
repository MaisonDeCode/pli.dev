/** Editing the outline (bookmarks) from the sidebar: what the buttons, keys and drags of the outline tree call. */
import { findOutlineItem, type PdfSession } from "@pli.dev/pdf";
import { setSelection } from "./hooks";
import { plainMessage, type Notices } from "./store";

export interface OutlineHere {
  /** The page shown (id) and its position (0-based), and how far down it the view is (page space). */
  pageId: string;
  page: number;
  y?: number;
}

export interface OutlineEdit {
  /** Where "add" and "go to here" point: the page shown. */
  here(): OutlineHere | null;
  /** Adds a bookmark to the page shown (after `near` when given). Returns its id. */
  add(near?: string | null): string | undefined;
  rename(id: string, title: string): void;
  remove(id: string): void;
  /** Puts a bookmark under `parent` (null: top level) at `index` among that parent's other children. */
  move(id: string, parent: string | null, index?: number): void;
  indent(id: string): void;
  outdent(id: string): void;
  /** Makes a bookmark go to the page shown. */
  retarget(id: string): void;
}

const messageOf = plainMessage;

/** The editing commands of the outline for a session. */
export function createOutlineEdit(session: PdfSession, notices: Notices, here: () => OutlineHere | null): OutlineEdit {
  const run = <T>(fn: () => T): T | undefined => {
    try {
      const out = fn();
      setSelection(session, {});
      return out;
    } catch (e) {
      notices.error(messageOf(e));
      return undefined;
    }
  };
  return {
    here,
    add(near) {
      const at = here();
      if (!at) return undefined;
      return run(() => {
        const site = near ? findOutlineItem(session.doc.outline, near) : null;
        const id = session.outline.add(`Page ${session.doc.pages[at.page]?.label ?? at.page + 1}`, at.pageId, { y: at.y === undefined ? undefined : Math.round(at.y), parent: site?.parent?.id ?? null, index: site ? site.index + 1 : undefined });
        notices.announce(`Added a bookmark to page ${at.page + 1}`);
        return id;
      });
    },
    rename(id, title) {
      const next = title.trim();
      if (!next || session.outline.get(id).title === next) return;
      run(() => session.outline.rename(id, next));
    },
    remove(id) {
      const title = session.outline.get(id).title || "Untitled";
      if (
        run(() => {
          session.outline.remove(id);
          return true;
        })
      )
        notices.show(`Bookmark "${title}" deleted`, { action: { label: "Undo", run: () => (session.undo(), setSelection(session, {})) } });
    },
    move(id, parent, index) {
      run(() => session.outline.move(id, parent, index));
    },
    indent(id) {
      run(() => session.outline.indent(id));
    },
    outdent(id) {
      run(() => session.outline.outdent(id));
    },
    retarget(id) {
      const at = here();
      if (!at) return;
      run(() => {
        session.outline.retarget(id, at.pageId, at.y === undefined ? undefined : Math.round(at.y));
        notices.announce(`The bookmark now goes to page ${at.page + 1}`);
      });
    },
  };
}
