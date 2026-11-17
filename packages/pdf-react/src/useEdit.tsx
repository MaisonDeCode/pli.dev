import { useEffect, useLayoutEffect, useMemo, type KeyboardEvent, type ReactNode } from "react";
import { keepFocus } from "@pli.dev/react";
import type { PdfSession } from "@pli.dev/pdf";
import { inOwnArea, inPanel, isField } from "./annotKeys";
import { EDIT_KEY, EDIT_TOOL, EditController, type ContentEditOptions } from "./editController";
import { EditDomLayer, EditPreviewLayer, EditToolOverlay } from "./EditLayer";
import { EditPanel, EditsTab } from "./EditPanel";
import { EditIcons as I } from "./editIcons";
import type { PageContext, PdfPanel, PdfTool, PdfViewContext } from "./extensions";
import { commandItem, commandTitle, type PdfCommand, type PdfMenus } from "./commands";
import { MOD, registerShortcuts, type Shortcut } from "./shortcuts";
import { useStore } from "./store";

/** The keys of the Edit tool, for the keyboard table of the documentation. */
export function editShortcutTable(): Shortcut[] {
  return [
    { keys: EDIT_KEY, action: "Edit text and pictures tool" },
    { keys: "Click", action: "With the tool: edit the text under the pointer, or select a picture" },
    { keys: "Enter", action: "In the text editor: keep the new text" },
    { keys: "Esc", action: "In the text editor: give up the new text. Otherwise: put the tool down" },
    { keys: `${MOD}Z, ${MOD}Shift+Z`, action: "Undo, redo a change of text or picture" },
  ];
}

registerShortcuts("Edit text and pictures", editShortcutTable);

/** The Edit tool: one `PdfTool` for the viewer's `tools`. It is hidden from the toolbar (the ribbon or the toolbar group has the button). */
export function createEditTool(c: EditController): PdfTool {
  let down: { page: string; x: number; y: number; scale: number } | null = null;
  return {
    id: EDIT_TOOL,
    label: "Edit text and pictures",
    icon: I.edit,
    shortcut: EDIT_KEY,
    cursor: "text",
    needsEdit: true,
    hidden: true,
    hint: "Click text to retype it, or a picture to replace or delete it.",
    onPointer(e) {
      if (c.readOnly) return;
      if (e.type === "move") {
        if (e.pointerType === "touch" || down) return;
        c.hoverAt(e.page.id, e.x, e.y, e.scale);
      } else if (e.type === "down") {
        if (e.button !== 0 && e.button !== undefined) return;
        down = { page: e.page.id, x: e.x, y: e.y, scale: e.scale };
        // What was being typed is kept before the click picks something else.
        void c.commit();
      } else {
        const d = down;
        down = null;
        if (d && d.page === e.page.id && Math.hypot(e.x - d.x, e.y - d.y) * d.scale < 6) void c.pick(d.page, e.x, e.y, d.scale);
      }
    },
    onCancel() {
      down = null;
      void c.commit();
    },
    overlay: (ctx: PageContext): ReactNode => <EditToolOverlay ctx={ctx} c={c} />,
  };
}

/** The Edit tool as a command: the ribbon's button and Tools > Edit text and pictures are made from it. */
export function editCommand(c: EditController): PdfCommand {
  return { id: "edit", label: "Edit text and pictures", icon: I.edit, shortcut: EDIT_KEY, checked: c.active, disabled: c.readOnly, run: () => c.setTool(!c.active) };
}

/** The Edit button, for the ribbon or the toolbar, and the live message for screen readers. */
export function EditGroup({ c, view }: { c: EditController; view: PdfViewContext }) {
  c.setView(view);
  useStore(c);
  const cmd = editCommand(c);
  return (
    <div className="pli-group" role="group" aria-label="Edit content">
      <button type="button" className="pli-tool pli-pdf-tool" aria-label={cmd.label} aria-pressed={!!cmd.checked} aria-keyshortcuts={EDIT_KEY} title={commandTitle(cmd)} data-tool={EDIT_TOOL} onMouseDown={keepFocus} onClick={cmd.run}>
        {I.edit}
      </button>
      <div className="pli-pdf-sr" role="status" aria-live="polite" aria-atomic="true">
        {c.live}
      </div>
    </div>
  );
}

/** What `PliPdf` is given for editing text and pictures, and what goes on the element around it. */
export interface ContentEditKit {
  controller: EditController;
  props: {
    /** The tool (hidden: use `group` for its button). */
    tools: PdfTool[];
    /** The preview of the changes waiting for the save (SVG, in page space). */
    pageOverlay: (ctx: PageContext) => ReactNode;
    /** The in-place editor (HTML, in page space). */
    pageOverlayDom: (ctx: PageContext) => ReactNode;
    /** The Edits tab. Empty in a read-only viewer. */
    sidebar: PdfPanel[];
    /** The panel of the tool: only while the tool is on (leave it out of the props otherwise, so another right panel can show). */
    rightPanel?: (ctx: PdfViewContext) => ReactNode;
    /** What the panel would show (the selected text or picture), or null: the viewer opens the panel when it changes. */
    rightPanelKey?: string | null;
  };
  /** The Edit button for the ribbon or the toolbar. Null in a read-only viewer. */
  group: (ctx: PdfViewContext) => ReactNode;
  /** What the tool adds to the menus (Tools > Edit text and pictures). Empty in a read-only viewer. */
  menus: () => PdfMenus;
  /** The key that chooses the tool: put these on an element that contains the viewer. */
  hostProps: { onKeyDownCapture: (e: KeyboardEvent) => void };
  /** Tell the kit which tool the viewer has on (from `onToolChange`, or the `tool` prop). */
  onToolChange: (id: string | null) => void;
}

/**
 * The Edit text and pictures tool as props for `PliPdf`: click text on the page to retype it (in the page's own font when it
 * can write the new text), choose another font, size and colour, swap or delete a picture, and see the changes on the page
 * and in the Edits tab until the file is saved. Every change is a step of undo.
 *
 *     const edit = useContentEditKit(session, { fonts }, toolId);
 *     <div style={{ display: "contents" }} {...edit.hostProps}><PliPdf session={session} renderer={renderer} {...edit.props} /></div>
 *
 * `PdfEditor` does this for you (turn it off with `edit={false}`).
 */
export function useContentEditKit(session: PdfSession, options: ContentEditOptions = {}, toolId?: string | null): ContentEditKit {
  const controller = useMemo(() => new EditController(session, options), [session]); // eslint-disable-line react-hooks/exhaustive-deps
  Object.assign(controller.options, options);
  useEffect(() => controller.connect(), [controller]);
  useLayoutEffect(() => {
    if (toolId !== undefined) controller.setToolId(toolId);
  }, [controller, toolId]);
  useStore(controller);
  const readOnly = !!options.readOnly;
  const active = controller.active;
  const tool = useMemo(() => createEditTool(controller), [controller]);
  const sel = controller.selected;
  const panelKey = active && sel ? `edit:${sel.page}:${sel.kind}:${sel.id}` : null;

  return useMemo<ContentEditKit>(() => {
    const c = controller;
    return {
      controller: c,
      props: {
        tools: readOnly ? [] : [tool],
        pageOverlay: (ctx) => <EditPreviewLayer ctx={ctx} c={c} />,
        pageOverlayDom: (ctx) => <EditDomLayer ctx={ctx} c={c} />,
        sidebar: readOnly ? [] : [{ id: "edits", label: "Edits", icon: I.list, render: (ctx) => <EditsTab c={c} view={ctx} /> }],
        ...(active && !readOnly ? { rightPanel: (ctx: PdfViewContext) => <EditPanel c={c} view={ctx} />, rightPanelKey: panelKey } : {}),
      },
      group: (ctx) => (readOnly ? null : <EditGroup c={c} view={ctx} />),
      menus: () => (readOnly ? {} : { Tools: [commandItem(editCommand(c))] }),
      hostProps: {
        onKeyDownCapture: (e) => {
          if (readOnly || e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== EDIT_KEY.toLowerCase()) return;
          if (isField(e.target) || inPanel(e.target) || inOwnArea(e.target)) return;
          e.preventDefault();
          e.stopPropagation();
          c.setTool(!c.active);
        },
      },
      onToolChange: (id) => c.setToolId(id),
    };
  }, [controller, tool, readOnly, active, panelKey]);
}
