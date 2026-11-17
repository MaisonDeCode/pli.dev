import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  PX_PER_INCH,
  activeRegionNames,
  footnoteIds,
  footnoteNumbers,
  hasFirstPageRegions,
  isNoteName,
  noteIdOf,
  noteName,
  pageDimensions,
  pageSetupOf,
  plainText,
  regionKeyFor,
  regionKind,
  regionLabel,
  resolveRegion,
  sectionShape,
  sectionsOf,
  startsOnNewPage,
  type Block,
  type DocumentSession,
  type NoteName,
  type PageSetup,
  type RegionName,
} from "@pli.dev/docs";
import { useSessionRevision } from "./hooks";
import type { Layout } from "./layout/paginate";
import { PliEditor, type PliEditorHandle, type PliEditorProps } from "./PliEditor";
import { DocumentView } from "./render";
import { EditorSessionContext } from "./session-context";
import { Dropdown, MenuList } from "./ui/primitives";
import { Icons } from "./ui/icons";

/** A header or footer being edited in place. */
export interface RegionEdit {
  /** Which header or footer (the first page's, say), or which footnote. Every page that shows it mirrors the edit. */
  name: RegionName | NoteName;
  /** The page whose copy is editable; the others mirror it. */
  page: number;
  /** The section that holds this header or footer's content. A later section that is linked to it shows it too. */
  owner: number;
  /** The section of the page it was opened on. It is the same as `owner`, unless that section is linked to an earlier one. */
  section: number;
  /** Whether that page is the first of its section, which decides if its first-page header or footer is the one shown. */
  first: boolean;
  session: DocumentSession;
}

/** Where a header or footer was opened, which a page knows and a footnote does not. */
export interface RegionPlace {
  owner: number;
  section: number;
  first: boolean;
}

/** What the controls on the header or footer being edited can do. */
export interface RegionActions {
  /** Finish editing and go back to the body. */
  done(): void;
  /** Turn a different first page, or different odd and even pages, on or off. */
  toggle(option: "differentFirstPage" | "differentOddEven"): void;
  /** Insert a row of two or three columns. */
  columns(count: 2 | 3): void;
  /** Insert the page number or the page count. */
  field(field: "page" | "pages"): void;
  /** Switch a section's header or footer between its own and the previous section's. */
  link(): void;
  /** Empty this header or footer. */
  clear(): void;
}

export type ViewMode = "pages" | "continuous";

/** Space above the first page and below the last, and between pages, in CSS pixels. */
const CANVAS_PADDING = 32;
const PAGE_GAP = 24;
/** Distance of the header from the top edge of the page and of the footer from the bottom: half an inch. */
const REGION_OFFSET = 0.5 * PX_PER_INCH;
/** Room kept between a header or footer and the body, and the least height a header or footer being edited has. */
const REGION_GAP = 12;
const MIN_REGION_HEIGHT = 18;
/** Room a page's footnotes need besides the notes themselves: the rule above them and the space around it. */
const NOTES_OVERHEAD = 14;

/** True if a header or footer has anything in it. A lone empty paragraph is the same as none. */
export function regionHasContent(blocks: readonly Block[] | undefined): boolean {
  return !!blocks?.some((b) => ("runs" in b ? plainText(b.runs).length > 0 : true));
}

export interface PageCanvasProps {
  session: DocumentSession;
  view: ViewMode;
  zoom: number;
  layout: Layout | null;
  readOnly?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  bodyRef: Ref<PliEditorHandle>;
  region: RegionEdit | null;
  regionRef: Ref<PliEditorHandle>;
  onLayout: (layout: Layout) => void;
  /** Called when a file can't be added to the document. See `PliEditorProps.onStorageError`. */
  onStorageError?: PliEditorProps["onStorageError"];
  onEditRegion: (name: RegionName | NoteName, page: number, place?: RegionPlace) => void;
  regionActions: RegionActions;
  onBodyFocusChange: (focused: boolean) => void;
  onRegionFocusChange: (focused: boolean) => void;
  "aria-label"?: string;
}

/**
 * An invisible copy of something shown on the page, only there to learn how tall it is, so the body can
 * make room for it. It shows the live content, including what is being typed.
 */
function Measure({ name, width, className, onHeight, children }: { name: string; width: number; className: string; onHeight: (name: string, height: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => onHeight(name, element.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
      onHeight(name, 0);
    };
  }, [name, onHeight]);
  return (
    <div ref={ref} className={`${className} pli-measure`} style={{ width }} aria-hidden="true">
      {children}
    </div>
  );
}

/**
 * The scrollable area that holds the document. In `pages` view it draws one sheet per page with
 * the header and footer repeated on each; in `continuous` view it is a single sheet that grows.
 * Either way the body is one editor, so selection and editing flow across page boundaries.
 */
export function PageCanvas({
  session,
  view,
  zoom,
  layout,
  readOnly,
  placeholder,
  autoFocus,
  bodyRef,
  region,
  regionRef,
  onLayout,
  onStorageError,
  onEditRegion,
  regionActions,
  onBodyFocusChange,
  onRegionFocusChange,
  ...aria
}: PageCanvasProps) {
  useSessionRevision(session);
  // The region's session is always subscribed (to the body's when no region is open) so hooks run in a fixed order.
  useSessionRevision(region?.session ?? session);
  const doc = session.state;
  const page = pageSetupOf(doc);
  const sections = sectionsOf(doc);

  /** Each section's page: its size and margins in pixels. Sections can differ in size, orientation and margins. */
  const dims = sections.map((_, s) => {
    const shape = sectionShape(doc, sections, s);
    const size = pageDimensions(shape as PageSetup);
    const width = size.width * PX_PER_INCH;
    const margin = {
      top: shape.margins.top * PX_PER_INCH,
      right: shape.margins.right * PX_PER_INCH,
      bottom: shape.margins.bottom * PX_PER_INCH,
      left: shape.margins.left * PX_PER_INCH,
    };
    return { width, height: size.height * PX_PER_INCH, margin, textWidth: Math.max(100, width - margin.left - margin.right) };
  });
  const { width, height, margin, textWidth } = dims[0]!;
  /** The sheets are centred on the widest one. */
  const maxWidth = Math.max(...dims.map((d) => d.width));

  const optionsOf = (s: number) => ({ differentFirstPage: hasFirstPageRegions(doc, sections, s), differentOddEven: page.differentOddEven });
  /** A page's section, as the paginator placed it. */
  const sectionOfPage = (k: number) => Math.min(layout?.pageInfo[k]?.section ?? 0, sections.length - 1);

  /** What a page shows for its header or footer, and who owns it. While one is being edited, what is typed shows on every page that shares it. */
  const regionOnPage = (kind: "header" | "footer", k: number) => {
    const section = sectionOfPage(k);
    const first = k === 0 || sectionOfPage(k - 1) !== section;
    const name = regionKeyFor(optionsOf(section), kind, k + 1, first);
    const resolved = resolveRegion(doc, sections, section, name);
    const live = region?.name === name && region.owner === resolved.owner;
    return { name, section, first, owner: resolved.owner, live, blocks: live ? region.session.state.blocks : resolved.blocks };
  };

  // Every header and footer in use, once each, so each is measured, and which ones each section shows.
  const used = new Map<string, { key: string; name: RegionName; owner: number; kind: "header" | "footer"; blocks: readonly Block[]; live: boolean }>();
  const usedBy: string[][] = sections.map(() => []);
  sections.forEach((_, s) => {
    for (const kind of ["header", "footer"] as const) {
      for (const name of activeRegionNames(optionsOf(s), kind)) {
        const resolved = resolveRegion(doc, sections, s, name);
        const live = region?.name === name && region.owner === resolved.owner;
        const blocks = live ? region.session.state.blocks : resolved.blocks;
        const key = `${resolved.owner}:${name}`;
        if (!regionHasContent(blocks) && !live) continue;
        if (!used.has(key)) used.set(key, { key, name, owner: resolved.owner, kind, blocks: blocks ?? [], live });
        usedBy[s]!.push(key);
      }
    }
  });

  // Each section's pages give way to the tallest header or footer that section shows, so its pages have the same text area.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const onHeight = useCallback((name: string, h: number) => setHeights((prev) => (prev[name] === h ? prev : { ...prev, [name]: h })), []);
  const geos = dims.map((d, s) => {
    const mine = usedBy[s]!.map((key) => used.get(key)!);
    const tallest = (kind: "header" | "footer") =>
      Math.max(0, ...mine.filter((u) => u.kind === kind).map((u) => Math.max(heights[u.key] ?? 0, u.live ? MIN_REGION_HEIGHT : 0)));
    const top = mine.some((u) => u.kind === "header") ? Math.max(d.margin.top, REGION_OFFSET + tallest("header") + REGION_GAP) : d.margin.top;
    const bottom = mine.some((u) => u.kind === "footer") ? Math.max(d.margin.bottom, REGION_OFFSET + tallest("footer") + REGION_GAP) : d.margin.bottom;
    return { content: Math.max(120, d.height - top - bottom), before: top, after: bottom };
  });
  const topPad = geos[0]!.before;
  const contentHeight = geos[0]!.content;
  const stride = height + PAGE_GAP;

  // Footnotes: how tall each one is (so a page can make room for the ones cited on it), and their numbers.
  const noteIds = footnoteIds(doc.blocks).filter((id) => doc.footnotes?.[id]);
  const noteNumber = footnoteNumbers(doc);
  const blocksOfNote = (id: string): readonly Block[] => (region?.name === noteName(id) ? region.session.state.blocks : (doc.footnotes?.[id] ?? []));
  const noteKey = noteIds.join(",");
  const noteHeightKey = noteIds.map((id) => heights[`note:${id}`] ?? 0).join(",");
  const notesGeometry = useMemo(
    () => (noteKey ? { heights: new Map(noteKey.split(",").map((id, i) => [id, Number(noteHeightKey.split(",")[i])])), overhead: NOTES_OVERHEAD } : undefined),
    [noteKey, noteHeightKey],
  );

  const paged = view === "pages";
  // What the paginator needs to know about every section's pages, kept the same object while the numbers are.
  const sectionShapes = sections.map((_, s) => ({ geometry: geos[s]!, newPage: startsOnNewPage(doc, sections, s) }));
  const shapeKey = JSON.stringify(sectionShapes) + `|${stride}|${zoom}`;
  const pagination = useMemo(
    () => (paged ? { stride, content: contentHeight, gap: PAGE_GAP, zoom, sections: sectionShapes } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shapeKey` stands for the numbers in `sectionShapes`
    [paged, shapeKey],
  );
  const pages = paged ? Math.max(1, layout?.pages ?? 1) : 1;
  /** Where each sheet goes: its section's size, and its place down the canvas as the paginator laid the pages out. */
  const sheets = Array.from({ length: pages }, (_, k) => {
    const info = layout?.pageInfo[k];
    const s = Math.min(info?.section ?? 0, sections.length - 1);
    const d = dims[s]!;
    const geo = geos[s]!;
    const top = CANVAS_PADDING + geos[0]!.before + (info?.start ?? k * stride) - geo.before;
    return { top, left: (maxWidth - d.width) / 2, d, geo };
  });
  const lastSheet = sheets[sheets.length - 1]!;
  const totalHeight = lastSheet.top + lastSheet.d.height + CANVAS_PADDING;

  // Where each section's text sits, for sections with margins or page sizes of their own.
  const boxKey = dims.map((d) => `${(maxWidth - d.width) / 2 + d.margin.left}:${d.textWidth}`).join(",");
  const sectionBoxes = useMemo(() => {
    const parts = boxKey.split(",").map((p) => p.split(":").map(Number) as [number, number]);
    const [x0, w0] = parts[0]!;
    return parts.some(([x, w]) => x !== x0 || w !== w0) ? parts.map(([x, w]) => ({ dx: x - x0, width: w })) : undefined;
  }, [boxKey]);

  /** One footnote beside its number. On a page it is edited in place by double-clicking it. */
  const noteRow = (id: string, pageIndex: number | null) => {
    const name = noteName(id);
    const n = noteNumber.get(id) ?? 0;
    const editingHere = pageIndex !== null && region?.name === name && region.page === pageIndex;
    return (
      <div
        key={id}
        className="pli-note"
        data-note={id}
        data-editing={editingHere || undefined}
        onDoubleClick={() => !readOnly && pageIndex !== null && onEditRegion(name, pageIndex)}
        title={readOnly || pageIndex === null ? undefined : "Double-click to edit the footnote"}
        onKeyDown={(e) => {
          if (e.key === "Escape" && editingHere) {
            e.preventDefault();
            regionActions.done();
          }
        }}
      >
        <span className="pli-note-number">{n}</span>
        <div className="pli-note-body">
          {editingHere ? (
            <PliEditor
              ref={regionRef}
              session={region.session}
              className="pli-note-editor"
              placeholder="Footnote"
              autoFocus
              onStorageError={onStorageError}
              onFocusChange={onRegionFocusChange}
              aria-label={`Footnote ${n}`}
            />
          ) : (
            <div className="pli-editor pli-note-editor">
              <DocumentView doc={{ ...doc, blocks: [...blocksOfNote(id)] }} />
            </div>
          )}
        </div>
        {editingHere && (
          <button type="button" className="pli-note-done" onMouseDown={(e) => e.preventDefault()} onClick={regionActions.done}>
            Done
          </button>
        )}
      </div>
    );
  };

  /** The bar on the edge of the header or footer being edited: what it is, its options, and Done. */
  const regionBar = (name: RegionName, edit: RegionEdit, left: number, width: number) => {
    const linked = edit.owner < edit.section;
    const where = sections.length > 1 ? ` \u00b7 Section ${edit.section + 1}${linked ? " (linked)" : ""}` : "";
    return (
      <div className="pli-region-bar-page" data-kind={regionKind(name)} style={{ left, width }} onMouseDown={(e) => e.preventDefault()}>
        <span className="pli-region-tag">{regionLabel(name) + where}</span>
        <span className="pli-region-controls">
          <Dropdown label="Header and footer options" align="end" className="pli-region-options" panel={(close) => (
            <MenuList
              label="Header and footer options"
              close={close}
              items={[
                ...(edit.section > 0
                  ? [{ label: "Link to previous section", checked: linked, onSelect: regionActions.link }, "separator" as const]
                  : []),
                { label: "Different first page", checked: hasFirstPageRegions(doc, sections, edit.section), onSelect: () => regionActions.toggle("differentFirstPage") },
                { label: "Different odd and even pages", checked: !!page.differentOddEven, onSelect: () => regionActions.toggle("differentOddEven") },
                "separator",
                { label: "Page number", onSelect: () => regionActions.field("page") },
                { label: "Page count", onSelect: () => regionActions.field("pages") },
                {
                  label: "Columns",
                  items: [
                    { label: "Two columns (left, right)", onSelect: () => regionActions.columns(2) },
                    { label: "Three columns (left, centre, right)", onSelect: () => regionActions.columns(3) },
                  ],
                },
                "separator",
                { label: `Remove ${regionLabel(name).toLowerCase()}`, onSelect: regionActions.clear },
              ]}
            />
          )}>
            <span>Options</span>
            {Icons.chevron}
          </Dropdown>
          <button type="button" className="pli-region-done" onClick={regionActions.done}>
            Done
          </button>
        </span>
      </div>
    );
  };

  /** A page's header or footer: a band across the top or bottom margin, edited in place by double-clicking it. */
  const regionZone = (kind: "header" | "footer", pageIndex: number) => {
    const { name, section, first, owner, blocks } = regionOnPage(kind, pageIndex);
    const label = regionLabel(name);
    const editingHere = region?.name === name && region.owner === owner && region.page === pageIndex;
    const editingThis = region?.name === name && region.owner === owner;
    const sheet = sheets[pageIndex]!;
    const pad = kind === "header" ? sheet.geo.before : sheet.geo.after;
    const { margin, textWidth } = sheet.d;
    const edge = kind === "header" ? { top: 0 } : { bottom: 0 };
    return (
      <div
        className="pli-region-zone"
        data-kind={kind}
        data-editing={editingThis || undefined}
        data-live={editingHere || undefined}
        style={{ ...edge, height: pad }}
        onDoubleClick={() => !readOnly && onEditRegion(name, pageIndex, { owner, section, first })}
        title={readOnly ? undefined : `Double-click to edit the ${label.toLowerCase()}`}
      >
        <div
          className={`pli-region pli-${kind}`}
          style={{ ...(kind === "header" ? { top: REGION_OFFSET } : { bottom: REGION_OFFSET }), left: margin.left, width: textWidth }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editingHere) {
              e.preventDefault();
              regionActions.done();
            }
          }}
        >
          {editingHere ? (
            <PliEditor
              ref={regionRef}
              session={region.session}
              className="pli-region-editor"
              placeholder={label}
              autoFocus
              maxImageWidth={textWidth}
              onStorageError={onStorageError}
              onFocusChange={onRegionFocusChange}
              aria-label={label}
            />
          ) : regionHasContent(blocks) ? (
            <div className="pli-editor pli-region-editor"><DocumentView doc={{ ...doc, blocks: [...blocks!] }} fields={{ page: pageIndex + 1, pages }} /></div>
          ) : (
            !readOnly && !editingThis && <span className="pli-region-hint">Double-click to add a {label.toLowerCase()}</span>
          )}
        </div>
        {editingHere && regionBar(name, region, margin.left, textWidth)}
      </div>
    );
  };

  const onSheetMouseDown = (event: React.MouseEvent) => {
    // Clicking the paper outside the text area puts the caret in the body.
    if (event.target === event.currentTarget && !readOnly) {
      event.preventDefault();
      (bodyRef as React.RefObject<PliEditorHandle | null>).current?.focus();
    }
  };

  if (!paged) {
    return (
      <div className="pli-canvas-content pli-canvas-continuous" data-pli-zoom={zoom} style={{ zoom }}>
        <div className="pli-sheet pli-sheet-continuous" style={{ maxWidth: width }}>
          <PliEditor
            ref={bodyRef}
            session={session}
            readOnly={readOnly}
            placeholder={placeholder}
            autoFocus={autoFocus}
            pagination={null}
            onLayout={onLayout}
            onFocusChange={onBodyFocusChange}
            maxImageWidth={textWidth}
            onStorageError={onStorageError}
            className="pli-body-editor pli-editor-continuous"
            {...aria}
          />
          {noteIds.length > 0 && <div className="pli-notes pli-notes-end">{noteIds.map((id) => noteRow(id, null))}</div>}
        </div>
      </div>
    );
  }

  return (
    // The headers and footers drawn on each page are plain views, which need the session to find stored files.
    <EditorSessionContext.Provider value={session}>
    <div className="pli-canvas-content" style={{ width: maxWidth * zoom, height: totalHeight * zoom }}>
      <div className="pli-scaler" data-pli-zoom={zoom} data-region-editing={region ? "" : undefined} style={{ width: maxWidth, height: totalHeight, transform: `scale(${zoom})` }}>
        {Array.from({ length: pages }, (_, k) => (
          <div
            key={k}
            className="pli-sheet"
            style={{ top: sheets[k]!.top, left: sheets[k]!.left, width: sheets[k]!.d.width, height: sheets[k]!.d.height }}
            onMouseDown={onSheetMouseDown}
            data-page={k + 1}
          >
            {regionZone("header", k)}
            {regionZone("footer", k)}
            {(layout?.notes.get(k + 1) ?? []).length > 0 && (
              <div className="pli-notes" style={{ left: sheets[k]!.d.margin.left, width: sheets[k]!.d.textWidth, bottom: sheets[k]!.geo.after }}>
                {(layout?.notes.get(k + 1) ?? []).filter((id) => doc.footnotes?.[id]).map((id) => noteRow(id, k))}
              </div>
            )}
          </div>
        ))}
        {noteIds.map((id) => (
          <Measure key={id} name={noteName(id)} width={Math.min(...dims.map((d) => d.textWidth))} className="pli-note-measure" onHeight={onHeight}>
            <div className="pli-note">
              <span className="pli-note-number">{noteNumber.get(id)}</span>
              <div className="pli-note-body">
                <div className="pli-editor pli-note-editor">
                  <DocumentView doc={{ ...doc, blocks: [...blocksOfNote(id)] }} />
                </div>
              </div>
            </div>
          </Measure>
        ))}
        {[...used.values()].map((u) => (
          <Measure key={u.key} name={u.key} width={dims[Math.min(u.owner, dims.length - 1)]!.textWidth} className="pli-region" onHeight={onHeight}>
            <div className="pli-editor pli-region-editor">
              <DocumentView doc={{ ...doc, blocks: [...u.blocks] }} fields={{ page: 1, pages: 1 }} />
            </div>
          </Measure>
        ))}
        <PliEditor
          ref={bodyRef}
          session={session}
          readOnly={readOnly}
          placeholder={placeholder}
          autoFocus={autoFocus}
          pagination={pagination}
          footnotes={notesGeometry}
          sectionBoxes={sectionBoxes}
          onLayout={onLayout}
          onFocusChange={onBodyFocusChange}
          maxImageWidth={textWidth}
          onStorageError={onStorageError}
          className="pli-body-editor pli-editor-paged"
          style={{ left: sheets[0]!.left + margin.left, top: CANVAS_PADDING + topPad, width: textWidth, minHeight: contentHeight }}
          {...aria}
        />
      </div>
    </div>
    </EditorSessionContext.Provider>
  );
}
