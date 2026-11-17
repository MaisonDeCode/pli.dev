import { forwardRef, useEffect, useMemo, useSyncExternalStore, type DragEvent, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import type { PdfSession } from "@pli.dev/pdf";
import { PliPdf, type PliPdfHandle, type PliPdfProps } from "./PliPdf";
import { AnnotationLayer, BlendLayer } from "./AnnotationLayer";
import { AnnotController, presenceFromPeers, type AnnotControllerOptions, type PresenceInfo } from "./annotController";
import { useRoomPeers } from "./collab";
import { useSessionRevision } from "./hooks";
import { type FindState } from "./find";
import { RedactMatches } from "./AnnotRibbon";
import { AnnotIcons as I } from "./annotIcons";
import { handleAnnotKey } from "./annotKeys";
import { createTools } from "./annotTools";
import { pageFrame } from "./annotUi";
import { AnnotRibbon } from "./AnnotRibbon";
import { AnnotationsTab, CommentsTab } from "./AnnotTabs";
import { PropertiesPanel, propertiesKey } from "./PropertiesPanel";
import { annotMenus } from "./annotMenus";
import { mergeMenus, weaveMenus, type PdfMenus } from "./commands";
import { FormatBar, formatMenu } from "./FormatBar";
import { TextEditor } from "./TextEditor";
import { screenToPage } from "./geometry";
import type { PageContext, PdfPanel, PdfTool, PdfViewContext } from "./extensions";
import { PdfIcons } from "./icons";

export interface AnnotationKitOptions extends Omit<AnnotControllerOptions, "session"> {
  /** The viewer is read-only: no ribbon or properties; the Comments and Annotations tabs stay. */
  readOnly?: boolean;
  /** The properties panel on the right. Default true. */
  properties?: boolean;
  /** Other people's selections to draw (from the room's presence). See `presenceFromPeers`. */
  presence?: readonly PresenceInfo[];
}

/** What `PliPdf` is given, and what the element around it is given. */
export interface AnnotationKit {
  controller: AnnotController;
  props: {
    tools: PdfTool[];
    tool: string | null;
    onToolChange: (id: string | null) => void;
    pageOverlay: (ctx: PageContext) => ReactNode;
    pageOverlayDom: (ctx: PageContext) => ReactNode;
    pageOverlayBlend: (ctx: PageContext) => ReactNode;
    ribbon: (ctx: PdfViewContext) => ReactNode;
    /** What the tools add to the menus (Insert, Edit, View, Format, Tools): the `menus` prop of the viewer. */
    menus: (base: PdfMenus, ctx: PdfViewContext) => PdfMenus;
    /** The row for formatting the text of the text box being written. */
    formatBar: (ctx: PdfViewContext) => ReactNode;
    /** Tells when the menus' state changed (the selection, the clipboard, the tool in hand). */
    menusChanged: (listener: () => void) => () => void;
    /** Buttons for the find bar: "Redact all matches…". */
    findActions: (find: FindState, ctx: PdfViewContext) => ReactNode;
    sidebar: PdfPanel[];
    rightPanel?: (ctx: PdfViewContext) => ReactNode;
    /** What the properties panel would show (the selected annotations), or null: the viewer opens the panel when it changes. */
    rightPanelKey?: string | null;
  };
  /** Keyboard shortcuts, paste and drop of pictures: put these on an element that contains the viewer. */
  hostProps: {
    onKeyDownCapture: (e: KeyboardEvent) => void;
    onPaste: (e: ClipboardEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

/** Defaults that are not set must not hide what `annotations` or the controller's own defaults say. */
export const stripUndefined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const isPicture = (f: { type: string }) => /^image\/(png|jpe?g)$/i.test(f.type);

/**
 * The annotation tools as props for `PliPdf`: the tool registry, the SVG layer that draws annotations, the text editor, the
 * ribbon, the Comments and Annotations tabs and the properties panel. `AnnotatedPdf` uses it; use it yourself to put the
 * parts in your own layout.
 *
 *     const kit = useAnnotationKit(session, { user, storage });
 *     <div style={{ display: "contents" }} {...kit.hostProps}><PliPdf session={session} renderer={renderer} {...kit.props} /></div>
 */
export function useAnnotationKit(session: PdfSession, options: Omit<AnnotationKitOptions, "session"> = {}): AnnotationKit {
  const controller = useMemo(() => new AnnotController({ session, ...options }), [session]); // eslint-disable-line react-hooks/exhaustive-deps
  // Options can change between renders (a new storage client, the user signing in).
  Object.assign(controller.options, { ...options, session });
  useEffect(() => controller.connect(), [controller]);
  const presence = options.presence;
  useEffect(() => {
    controller.presence = presence ?? [];
    controller.emit();
  }, [controller, presence]);
  // The host redraws when the tool changes, not on every pointer move.
  const toolId = useSyncExternalStore(controller.subscribe, () => controller.toolId, () => controller.toolId);
  // What the panel would show follows the selection, which the session sets just after it tells its listeners about a change.
  useSessionRevision(session);
  const panelKey = propertiesKey(controller);
  const tools = useMemo(() => createTools(controller), [controller]);
  const readOnly = !!options.readOnly;

  return useMemo<AnnotationKit>(() => {
    const c = controller;
    const sidebar: PdfPanel[] = [
      { id: "comments", label: "Comments", icon: PdfIcons.comment, render: (ctx) => <CommentsTab c={c} view={ctx} /> },
      { id: "annotations", label: "Annotations", icon: I.annotations, render: (ctx) => <AnnotationsTab c={c} view={ctx} /> },
    ];
    return {
      controller: c,
      props: {
        tools,
        tool: toolId,
        onToolChange: (id) => c.setToolId(id),
        pageOverlay: (ctx) => <AnnotationLayer ctx={ctx} controller={c} />,
        pageOverlayDom: (ctx) => <TextEditor ctx={ctx} c={c} />,
        pageOverlayBlend: (ctx) => <BlendLayer ctx={ctx} controller={c} />,
        ribbon: (ctx: PdfViewContext) => <AnnotRibbon c={c} view={ctx} readOnly={readOnly} />,
        menus: (base) => (readOnly ? base : weaveMenus(base, mergeMenus({ Format: formatMenu(c, null) }, annotMenus(c)))),
        formatBar: () => (readOnly ? null : <FormatBar annot={c} edit={null} />),
        menusChanged: c.subscribe,
        findActions: (find) => (readOnly || !c.tools.has("redact") ? null : <RedactMatches c={c} find={find} />),
        sidebar,
        ...(readOnly || options.properties === false ? {} : { rightPanel: (ctx: PdfViewContext) => (c.setView(ctx), (<PropertiesPanel c={c} />)), rightPanelKey: panelKey }),
      },
      hostProps: {
        onKeyDownCapture: (e) => {
          if (handleAnnotKey(c, { event: e, key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, target: e.target })) {
            e.preventDefault();
            e.stopPropagation();
          }
        },
        onPaste: (e) => {
          if (c.readOnly || (e.target instanceof HTMLElement && (/^(input|textarea)$/i.test(e.target.tagName) || e.target.isContentEditable))) return;
          const file = [...(e.clipboardData?.files ?? [])].find(isPicture);
          if (!file) return;
          e.preventDefault();
          void c.insertImage(file, c.view?.pageId ?? c.session.selection.page);
        },
        onDragOver: (e) => {
          if (!c.readOnly && [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) e.preventDefault();
        },
        onDrop: (e) => {
          const file = [...(e.dataTransfer?.files ?? [])].find(isPicture);
          if (!file || c.readOnly) return;
          e.preventDefault();
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-page-id]");
          const pageId = el?.dataset.pageId ?? c.view?.pageId ?? c.session.selection.page;
          const frame = pageId ? pageFrame(c, pageId) : null;
          const at = el && frame ? screenToPage(frame, e.clientX - el.getBoundingClientRect().left, e.clientY - el.getBoundingClientRect().top) : undefined;
          void c.insertImage(file, pageId, at);
        },
      },
    };
  }, [controller, tools, readOnly, options.properties, toolId, panelKey]);
}

/**
 * What the annotation kit takes from the props of the viewer, so `AnnotatedPdf` and `FormsPdf` agree: the person, the file
 * `storage` (pictures), the `fonts` (pickers), and other people's selections from the `room`. What `annotations` says wins.
 */
export function useKitDefaults(props: PliPdfProps): Pick<AnnotationKitOptions, "user" | "storage" | "fonts" | "presence"> {
  const peers = useRoomPeers(props.room);
  const me = props.users?.current;
  const user = props.user ?? (me ? { id: me.id, name: me.name } : undefined);
  const id = user?.id;
  const presence = useMemo(() => (props.room ? presenceFromPeers(peers, id) : undefined), [props.room, peers, id]);
  return { user, storage: props.storage, fonts: props.fonts, presence };
}

export interface AnnotatedPdfProps extends PliPdfProps {
  /** Options of the annotation tools: where pictures are stored, which fonts to offer, presence, ... */
  annotations?: Omit<AnnotationKitOptions, "readOnly" | "session">;
}

/**
 * `PliPdf` with the annotation tools: highlight, underline, strikethrough and squiggly from selected text, pen, eraser, shapes,
 * text boxes, notes, stamps, signatures, pictures, links and redaction marks; a properties panel; and the Comments and
 * Annotations tabs. Everything else is `PliPdf`'s: the props you pass are merged with the tools' (your `tools`, `sidebar` and
 * `pageOverlay` are added to theirs).
 */
export const AnnotatedPdf = forwardRef<PliPdfHandle, AnnotatedPdfProps>(function AnnotatedPdf(props, ref) {
  const { annotations, ...rest } = props;
  const defaults = useKitDefaults(props);
  const kit = useAnnotationKit(props.session, { ...stripUndefined(defaults), ...annotations, readOnly: props.readOnly });
  const k = kit.props;
  // Keep the overlay functions the same between renders unless the host's change: the pages redraw when they do not.
  const both = (mine: (ctx: PageContext) => ReactNode, theirs: ((ctx: PageContext) => ReactNode) | undefined) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useMemo(
      () =>
        theirs
          ? (ctx: PageContext) => (
              <>
                {mine(ctx)}
                {theirs(ctx)}
              </>
            )
          : mine,
      [mine, theirs],
    );
  const pageOverlay = both(k.pageOverlay, props.pageOverlay);
  const pageOverlayDom = both(k.pageOverlayDom, props.pageOverlayDom);
  const pageOverlayBlend = both(k.pageOverlayBlend, props.pageOverlayBlend);
  const tools = useMemo(() => [...k.tools, ...(props.tools ?? [])], [k.tools, props.tools]);
  const sidebar = useMemo(() => [...k.sidebar, ...(props.sidebar ?? [])], [k.sidebar, props.sidebar]);
  return (
    <div style={{ display: "contents" }} {...kit.hostProps}>
      <PliPdf
        ref={ref}
        {...rest}
        tools={tools}
        tool={props.tool !== undefined ? props.tool : k.tool}
        onToolChange={(id) => {
          k.onToolChange(id);
          props.onToolChange?.(id);
        }}
        pageOverlay={pageOverlay}
        pageOverlayDom={pageOverlayDom}
        pageOverlayBlend={pageOverlayBlend}
        ribbon={props.ribbon ?? k.ribbon}
        formatBar={props.formatBar ?? k.formatBar}
        menus={(base, ctx) => {
          const mine = k.menus(base, ctx);
          return typeof props.menus === "function" ? props.menus(mine, ctx) : weaveMenus(mine, props.menus);
        }}
        menusChanged={props.menusChanged ?? k.menusChanged}
        findActions={props.findActions ?? k.findActions}
        sidebar={sidebar}
        rightPanel={props.rightPanel ?? k.rightPanel}
        rightPanelKey={props.rightPanel ? props.rightPanelKey : k.rightPanelKey}
      />
    </div>
  );
});
