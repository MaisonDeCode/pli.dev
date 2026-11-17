import { forwardRef, useEffect, useMemo, type KeyboardEvent, type ReactNode } from "react";
import type { FormField, PdfSession } from "@pli.dev/pdf";
import { PliPdf, type PliPdfHandle, type PliPdfProps } from "./PliPdf";
import { FieldProperties } from "./FieldProperties";
import { FormBanner, FormsHost, FormsToolbar, formMenus } from "./FormBanner";
import { FormatBar, formatMenu } from "./FormatBar";
import { annotMenus } from "./annotMenus";
import { mergeMenus, weaveMenus, type PdfMenus } from "./commands";
import { FormLayer } from "./FormLayer";
import { AnnotRibbon } from "./AnnotRibbon";
import { FormController, useFormController, type FormControllerOptions } from "./formController";
import { type ContentEditOptions } from "./editController";
import { useContentEditKit } from "./useEdit";
import { createFormTools } from "./formTools";
import { stripUndefined, useAnnotationKit, useKitDefaults, type AnnotationKitOptions } from "./useAnnotations";
import type { PageContext, PdfPanel, PdfTool, PdfViewContext } from "./extensions";

export type FormsKitOptions = Omit<FormControllerOptions, "session">;

/** What `PliPdf` is given for forms, and what goes on the element around it. */
export interface FormsKit {
  controller: FormController;
  props: {
    /** The tools that add fields (not in the toolbar: the Prepare form bar has the buttons). */
    tools: PdfTool[];
    /** The controls of the form, in page space. */
    pageOverlayDom: (ctx: PageContext) => ReactNode;
    /** The Form menu and the Prepare form switch. */
    toolbar: (ctx: PdfViewContext) => ReactNode;
    /** What the form tools need on screen whether or not there is a toolbar (the import input, the flatten dialog, messages for screen readers). */
    host: (ctx: PdfViewContext) => ReactNode;
    /** What the form tools add to the menus (Insert > Form field, Tools > Prepare form and Form, View > Highlight form fields): the `menus` prop of the viewer. */
    menus: (base: PdfMenus) => PdfMenus;
    /** Tells when the menus' state changed. */
    menusChanged: (listener: () => void) => () => void;
    /** The form bar, the Prepare form bar and messages. */
    banner: (ctx: PdfViewContext) => ReactNode;
    /** The properties panel: only while Prepare form is on (leave it out of the props otherwise, so another right panel can show). */
    rightPanel?: (ctx: PdfViewContext) => ReactNode;
    /** What the properties panel would show (the selected fields in Prepare form), or null: the viewer opens the panel when it changes. */
    rightPanelKey?: string | null;
    /** Nothing: the forms kit has no sidebar tabs. */
    sidebar: PdfPanel[];
  };
  /** Keyboard (Enter finishes a radio group): put these on an element that contains the viewer. */
  hostProps: { onKeyDownCapture: (e: KeyboardEvent) => void };
}

/**
 * The form tools as props for `PliPdf`: the controls on each page, the form bar, Prepare form (add, move, resize, delete and
 * set up fields) with its properties panel, and the Form menu (highlight, clear, export, import, flatten).
 *
 *     const forms = useFormsKit(session, { onSign: () => openMySignatureDialog() });
 *     <div style={{ display: "contents" }} {...forms.hostProps}><PliPdf session={session} renderer={renderer} {...forms.props} /></div>
 *
 * `FormsPdf` does this, and puts it together with the annotation tools.
 */
export function useFormsKit(session: PdfSession, options: FormsKitOptions = {}): FormsKit {
  const controller = useMemo(() => new FormController({ session, ...options }), [session]); // eslint-disable-line react-hooks/exhaustive-deps
  // Options can change between renders (a new signature dialog, a different download).
  Object.assign(controller.options, { ...options, session });
  useEffect(() => controller.connect(), [controller]);
  useFormController(controller);
  const tools = useMemo(() => createFormTools(controller), [controller]);
  const designing = controller.designing;
  const ids = controller.selectedIds;
  const panelKey = designing && ids.length > 0 ? `field:${ids.join(",")}` : null;

  return useMemo<FormsKit>(() => {
    const c = controller;
    return {
      controller: c,
      props: {
        tools,
        pageOverlayDom: (ctx) => <FormLayer ctx={ctx} c={c} />,
        toolbar: () => <FormsToolbar c={c} />,
        host: (ctx) => (c.setView(ctx), (<FormsHost c={c} />)),
        menus: (base) => weaveMenus(base, formMenus(c)),
        menusChanged: c.subscribe,
        banner: (ctx) => (c.setView(ctx), (<FormBanner c={c} />)),
        ...(designing && !options.readOnly ? { rightPanel: (ctx: PdfViewContext) => (c.setView(ctx), (<FieldProperties c={c} />)), rightPanelKey: panelKey } : {}),
        sidebar: [],
      },
      hostProps: {
        onKeyDownCapture: (e) => {
          const t = e.target;
          const typing = t instanceof HTMLElement && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable);
          if (e.key === "Enter" && c.designing && c.radio && c.radio.points.length > 0 && !typing && !(t instanceof HTMLElement && t.closest("button"))) {
            e.preventDefault();
            e.stopPropagation();
            c.finishRadio();
          }
        },
      },
    };
  }, [controller, tools, designing, options.readOnly, panelKey]);
}

export interface FormsPdfProps extends PliPdfProps {
  /** Options of the form tools (what a signature field does, where flattened files go). */
  forms?: FormsKitOptions;
  /**
   * The annotation tools (`AnnotatedPdf`) are included, and a click on a signature field opens their signature dialog. Pass
   * their options here, or `false` to have the form tools alone.
   */
  annotations?: Omit<AnnotationKitOptions, "readOnly" | "session"> | false;
  /**
   * The Edit text and pictures tool (`useContentEditKit`): click text to retype it, swap or delete a picture, see the changes
   * until the file is saved. Pass its options (the `fonts` follow the `fonts` prop), or `false` to leave the tool out.
   */
  edit?: Omit<ContentEditOptions, "readOnly"> | false;
}

const both = (a: ((ctx: PageContext) => ReactNode) | undefined, b: ((ctx: PageContext) => ReactNode) | undefined) =>
  a && b
    ? (ctx: PageContext) => (
        <>
          {a(ctx)}
          {b(ctx)}
        </>
      )
    : (a ?? b);

/**
 * PdfEditor (this component): the full PDF editor. `PliPdf` (viewer, thumbnails, outline, find, page tools, File menu) with the
 * annotation tools (ribbon, properties panel, Comments and Annotations tabs) and the form tools (fill, Prepare form, Form menu).
 *
 * The props you pass are merged with the kits': your `tools`, `sidebar`, `toolbar`, `pageOverlay`, `pageOverlayDom` and
 * `pageOverlayBlend` are added to theirs, and `ribbon`, `rightPanel` (with its `rightPanelKey`) and `banner` are yours when given
 * (the properties panel of Prepare form shows over the annotation properties while it is on). The panel is not always open: it
 * opens when something is selected or from the Properties button (Alt+Shift+P), and closes with its button or Esc; see `PliPdf`.
 *
 * PROPS (everything of `PliPdfProps`, plus `forms` and `annotations`)
 * - Required: `session` (a `PdfSession`), `renderer` (a `PdfRenderer`, usually `pdfjsRenderer({ workerSrc })`).
 * - Mode: `readOnly` (look, search, select, print; no tools that edit, no filling), `pageTools` (false: no page tools, File menu
 *   or outline editing), `annotations` (kit options, or false for forms and page tools without the annotation tools), `forms`
 *   (kit options: `onSign`, `onFlatten`, `download`, `highlight`), `edit` (the Edit text and pictures tool; false leaves it out).
 * - Files: `onSave(bytes, result)` (the document counts as saved when its promise resolves), `onDownload(bytes, name, mime)`,
 *   `onPrint()`, `onOpen(bytes, name)` (adds Open PDF and Create PDF from pictures), `warnOnUnload`, `password`.
 * - People and sharing: `user`, `users` (a `Users`), `comments` (true, or `{ users?, store?, permissions?, onError? }`), `room` (a
 *   `CollabRoom`), `sync` (true, or `{ version?, verifyEvery?, onResync? }`; needs `room`).
 * - Files in your storage: `storage` (a `StorageClient`: annotation pictures are uploaded and kept as addresses, which the save
 *   fetches and embeds with `SaveOptions.fetch`), `sourceRetryMs` (how soon to ask again for a file a peer added).
 * - Fonts: `fonts` (a `FontRegistry`): the pickers offer its families, and every write of the file embeds the font files that
 *   text boxes, typed signatures, form fields and text edits use.
 * - Places to add your own: `tools` + `tool` + `onToolChange`, `toolbar`, `sidebar`, `rightPanel`, `ribbon`, `banner`,
 *   `pageOverlay`, `pageOverlayDom`, `pageOverlayBlend`.
 * - Menus and chrome: `menu` (false: no title row or menu bar), `menus` (entries to add; the tools add theirs to Edit, View, Insert,
 *   Format and Tools), `onShare` (a Share button), `actions` (more controls in the title row), `replace` (find and replace; on by
 *   default with the Edit tool), `formatBar` (your own text bar instead of the editor's).
 * - Look and start state: `theme` ("auto" | "light" | "dark"; View > Theme changes it, `onThemeChange` hears that), `className`, `defaultZoom`, `defaultViewMode`, `defaultSidebar`,
 *   `spreadCover`, `fallbackOutline`, `viewport`; `onPageChange`, `onPagesSelected`.
 * - `ref`: a `PliPdfHandle` (`goToPage`, `setZoom`, `setViewMode`, `rotateView`, `find`, `scroller`).
 * `PdfEditor` is the same component under the name to use for "the editor".
 */
export const FormsPdf = forwardRef<PliPdfHandle, FormsPdfProps>(function FormsPdf(props, ref) {
  const { forms: formOptions, annotations, edit: editOptions, ...rest } = props;
  const withAnnotations = annotations !== false;
  const withEdit = editOptions !== false;
  const defaults = useKitDefaults(props);
  const annot = useAnnotationKit(props.session, { ...stripUndefined(defaults), ...(annotations || {}), readOnly: props.readOnly });
  const kit = useFormsKit(props.session, {
    readOnly: props.readOnly,
    download: props.onDownload,
    // A click on a signature field opens the annotation signature dialog; the person then puts the signature down on the page.
    ...(withAnnotations ? { onSign: (field: FormField) => annot.controller.signField(field) } : {}),
    ...formOptions,
  });
  const f = kit.props;
  const a = withAnnotations ? annot.props : null;
  // The Edit tool follows the tool the viewer has on: the annotation controller's (or the host's, when it controls it).
  const toolNow = props.tool !== undefined ? props.tool : a ? a.tool : undefined;
  const edit = useContentEditKit(props.session, { fonts: defaults.fonts, ...(editOptions || {}), readOnly: props.readOnly || !withEdit }, toolNow);
  const e = withEdit ? edit.props : null;

  // One right panel: the host's, else Prepare form's, else the Edit tool's, else the annotation properties. Each says what it would show.
  const panel = props.rightPanel
    ? { node: props.rightPanel, key: props.rightPanelKey }
    : f.rightPanel
      ? { node: f.rightPanel, key: f.rightPanelKey }
      : e?.rightPanel
        ? { node: e.rightPanel, key: e.rightPanelKey }
        : { node: a?.rightPanel, key: a?.rightPanelKey };

  const readOnly = !!props.readOnly;
  const ac = withAnnotations ? annot.controller : null;
  const ec = withEdit && !readOnly ? edit.controller : null;
  const fc = kit.controller;
  // What the tools add to the menus, read when a menu is drawn (so the clipboard, the tool in hand and the selection are current).
  const menus = (base: PdfMenus, ctx: PdfViewContext): PdfMenus => {
    const mine = weaveMenus(base, mergeMenus({ Format: formatMenu(readOnly ? null : ac, ec) }, ac && !readOnly ? annotMenus(ac) : null, ec ? edit.menus() : null, formMenus(fc), typeof props.menus === "function" ? undefined : props.menus));
    return typeof props.menus === "function" ? props.menus(mine, ctx) : mine;
  };
  const menusChanged = (listener: () => void) => {
    const offs = [ac?.subscribe(listener), ec?.subscribe(listener), fc.subscribe(listener), props.menusChanged?.(listener)];
    return () => offs.forEach((off) => off?.());
  };

  const content = (
    <PliPdf
      ref={ref}
      {...rest}
      menus={menus}
      menusChanged={menusChanged}
      replace={props.replace ?? (withEdit && !readOnly)}
      formatBar={props.formatBar ?? (readOnly ? undefined : () => <FormatBar annot={ac} edit={ec} />)}
      tools={[...(a?.tools ?? []), ...f.tools, ...(e?.tools ?? []), ...(props.tools ?? [])]}
      tool={props.tool !== undefined ? props.tool : a ? a.tool : undefined}
      onToolChange={(id) => {
        a?.onToolChange(id);
        edit.onToolChange(id);
        props.onToolChange?.(id);
      }}
      pageOverlay={both(e?.pageOverlay, both(a?.pageOverlay, props.pageOverlay))}
      pageOverlayDom={both(both(both(a?.pageOverlayDom, f.pageOverlayDom), e?.pageOverlayDom), props.pageOverlayDom)}
      pageOverlayBlend={both(a?.pageOverlayBlend, props.pageOverlayBlend)}
      toolbar={(ctx) => (
        <>
          {f.toolbar(ctx)}
          {withEdit && !a && edit.group(ctx)}
          {typeof props.toolbar === "function" ? props.toolbar(ctx) : props.toolbar}
        </>
      )}
      host={(ctx) => (
        <>
          {f.host(ctx)}
          {typeof props.host === "function" ? props.host(ctx) : props.host}
        </>
      )}
      banner={props.banner ?? f.banner}
      ribbon={
        props.ribbon ??
        (a
          ? (ctx: PdfViewContext) => <AnnotRibbon c={annot.controller} view={ctx} readOnly={props.readOnly} extra={withEdit ? edit.group(ctx) : undefined} />
          : withEdit && !(props.topToolbar ?? props.menu === false)
            ? (ctx: PdfViewContext) => edit.group(ctx)
            : undefined)
      }
      findActions={props.findActions ?? a?.findActions}
      sidebar={[...(a?.sidebar ?? []), ...(e?.sidebar ?? []), ...(props.sidebar ?? [])]}
      rightPanel={panel.node}
      rightPanelKey={panel.key}
    />
  );
  return (
    <div
      style={{ display: "contents" }}
      {...(a ? annot.hostProps : {})}
      onKeyDownCapture={(ev) => {
        kit.hostProps.onKeyDownCapture(ev);
        if (!ev.isPropagationStopped() && withEdit) edit.hostProps.onKeyDownCapture(ev);
        if (!ev.isPropagationStopped() && a) annot.hostProps.onKeyDownCapture(ev);
      }}
    >
      {content}
    </div>
  );
});
