import {
  Fragment,
  createElement,
  memo,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { fontStack, lookupFont } from "@pli.dev/core";
import { userColor, effectiveMarks, headingAnchor, isFormattable, listLabels, plainText, withParagraphStyle, type Block, type Doc, type ImageBlock, type ImageCrop, type Run, type TableBlock, type TocBlock } from "@pli.dev/docs";
import type { DocumentSession, StorageClient, UploadState } from "@pli.dev/docs";
import type { Layout, Split } from "./layout/paginate";
import { EditorSessionContext } from "./session-context";
import { columnRuns, sectionsOf, type ColumnRun } from "@pli.dev/docs";

/** The page gaps a view needs. `repeats` is optional so simple callers (and tests) can leave it out. */
export type PageGaps = Pick<Layout, "before" | "splits" | "pageOf"> & Partial<Pick<Layout, "repeats" | "chunks">>;

/** The attribute that ties a DOM element to a document block. The editor maps selections through it. */
export const BLOCK_ATTR = "data-block-id";

/** Block types that hold no text, so any DOM position inside them is offset 0. */
export const NON_TEXT_TYPES = new Set(["divider", "page_break", "section_break", "image", "toc", "table"]);

const SAFE_HREF = /^\s*(https?:|mailto:|tel:|#|\/)/i;
const SAFE_SRC = /^\s*(https?:|data:image\/(png|jpe?g|gif|webp|bmp);|blob:|\/|\.)/i;

function safeHref(href: string): string {
  return SAFE_HREF.test(href) ? href : "#";
}

export interface FieldValues {
  page: number;
  pages: number;
}

/** Whether a hex color is black or close to it, which on a dark page is shown as the page's text color. */
function isNearBlack(color: string): boolean {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return /^black$/i.test(color.trim());
  const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join("") : m[1]!;
  return [0, 2, 4].every((i) => parseInt(hex.slice(i, i + 2), 16) <= 0x40);
}

function renderRun(run: Run, key: number, fields: FieldValues | undefined, marksOf?: (marks: Run["marks"]) => Run["marks"]): ReactNode {
  const m = marksOf ? marksOf(run.marks) : run.marks;
  let node: ReactNode = run.text;
  if (!m) return <Fragment key={key}>{node}</Fragment>;
  if (m.field) {
    // Shown with its real value on static pages; while editing it is the run's own text.
    node = (
      <span className="pli-field" data-field={m.field}>
        {fields ? String(fields[m.field]) : run.text}
      </span>
    );
  }
  if (m.footnote) {
    // The run is one invisible character; the number is drawn by CSS from the reference's place in the editor.
    node = (
      <sup className="pli-footnote-ref" data-footnote={m.footnote}>
        {run.text}
      </sup>
    );
  }
  if (m.code) node = <code>{node}</code>;
  if (m.bold) node = <strong>{node}</strong>;
  if (m.italic) node = <em>{node}</em>;
  if (m.underline) node = <u>{node}</u>;
  if (m.strike) node = <s>{node}</s>;
  if (m.superscript) node = <sup>{node}</sup>;
  if (m.subscript) node = <sub>{node}</sub>;
  const style: CSSProperties = {};
  if (m.color) style.color = m.color;
  if (m.highlight) style.backgroundColor = m.highlight;
  // A font that isn't installed falls back to the document font rather than the browser default.
  if (m.fontFamily) style.fontFamily = lookupFont(m.fontFamily) ? fontStack(m.fontFamily) : `${m.fontFamily}, var(--pli-doc-font, Arial, sans-serif)`;
  if (m.fontSize) style.fontSize = `${m.fontSize}pt`;
  // On a dark page, text that is black becomes the page's text color, and text on a highlight stays dark so it can be read.
  const classes = [m.highlight ? "pli-highlight" : "", m.color && isNearBlack(m.color) ? "pli-ink" : ""].filter(Boolean).join(" ");
  if (Object.keys(style).length > 0) node = <span className={classes || undefined} style={style}>{node}</span>;
  if (m.link) {
    node = (
      <a href={safeHref(m.link)} rel="noopener noreferrer">
        {node}
      </a>
    );
  }
  // A change someone proposed: an addition is underlined and a deletion struck through, in the proposer's color.
  if (m.suggest) {
    const Tag = m.suggest.kind === "insert" ? "ins" : "del";
    node = (
      <Tag className="pli-suggest" data-suggest={m.suggest.id} data-kind={m.suggest.kind} data-by={m.suggest.by} style={{ ["--pli-suggest" as string]: userColor(m.suggest.by) }}>
        {node}
      </Tag>
    );
  }
  // Outermost, so a click on any of the text finds the thread.
  if (m.comment?.length) {
    node = (
      <span className="pli-comment" data-comments={m.comment.join(" ")}>
        {node}
      </span>
    );
  }
  return <Fragment key={key}>{node}</Fragment>;
}

type Piece = { kind: "run"; run: Run } | { kind: "gap"; height: number };

/** Cuts runs at the page-break offsets so a gap element can sit between the two halves. */
function piecesWithGaps(runs: readonly Run[], splits: readonly Split[]): Piece[] {
  const out: Piece[] = [];
  let position = 0;
  let next = 0;
  for (const run of runs) {
    let start = 0;
    while (next < splits.length) {
      const split = splits[next]!;
      const relative = split.offset - (position + start);
      if (relative < 0) {
        next++;
      } else if (relative === 0) {
        if (out.length > 0) out.push({ kind: "gap", height: split.height });
        next++;
      } else if (relative < run.text.length - start) {
        out.push({ kind: "run", run: { text: run.text.slice(start, start + relative), marks: run.marks } });
        out.push({ kind: "gap", height: split.height });
        start += relative;
        next++;
      } else {
        break;
      }
    }
    const rest = run.text.slice(start);
    if (rest !== "") out.push({ kind: "run", run: { text: rest, marks: run.marks } });
    position += run.text.length;
  }
  return out;
}

/**
 * Runs as DOM children. The DOM text of a block must equal the model text exactly, because
 * selection offsets are computed from it. A `<br>` (which adds no text) keeps empty lines and
 * trailing line breaks visible; page gaps add elements but no text.
 */
function content(runs: readonly Run[], splits: readonly Split[] | undefined, fields: FieldValues | undefined, marksOf?: (marks: Run["marks"]) => Run["marks"]): ReactNode[] {
  const nodes: ReactNode[] =
    splits && splits.length > 0
      ? piecesWithGaps(runs, splits).map((piece, i) =>
          piece.kind === "run" ? (
            renderRun(piece.run, i, fields, marksOf)
          ) : (
            <span key={i} className="pli-spacer pli-spacer-inline" data-pli-spacer="" contentEditable={false} aria-hidden="true" style={{ height: piece.height }} />
          ),
        )
      : runs.map((run, i) => renderRun(run, i, fields, marksOf));
  const last = runs[runs.length - 1];
  if (!last || last.text.endsWith("\n")) nodes.push(<br key="br" />);
  return nodes;
}

/** The marker text for each list item ("1.", "a.", "•", …), and undefined for other blocks. */
export function computeMarkers(blocks: readonly Block[]): (string | undefined)[] {
  return listLabels(blocks).map((label) => label?.text);
}

export interface TocEntry {
  id: string;
  level: number;
  text: string;
  /** Page number, when the document is paginated. */
  page?: number;
}

/** The headings a table of contents lists, with their page numbers if known. */
export function tocEntries(blocks: readonly Block[], levels: number, pageOf?: ReadonlyMap<string, number>): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && block.level <= levels) {
      entries.push({ id: block.id, level: block.level, text: plainText(block.runs) || "Untitled", page: pageOf?.get(block.id) });
    }
  }
  return entries;
}

type FormattableLike = { align?: string; format?: { lineHeight?: number; spaceBefore?: number; spaceAfter?: number; indentLeft?: number; indentRight?: number; indentFirst?: number } };

function formatStyle(block: FormattableLike): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (block.align) style.textAlign = block.align as CSSProperties["textAlign"];
  const f = block.format;
  if (f) {
    if (f.lineHeight !== undefined) style.lineHeight = f.lineHeight;
    if (f.spaceBefore !== undefined) style.paddingTop = `${f.spaceBefore}pt`;
    if (f.spaceAfter !== undefined) style.marginBottom = `${f.spaceAfter}pt`;
    if (f.indentLeft !== undefined) style.marginLeft = `${f.indentLeft}pt`;
    if (f.indentRight !== undefined) style.marginRight = `${f.indentRight}pt`;
    if (f.indentFirst !== undefined) style.textIndent = `${f.indentFirst}pt`;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

interface ImageViewProps {
  block: ImageBlock;
  selected: boolean;
  onResize?: (id: string, width: number, height: number) => void;
}

const MIN_IMAGE_SIZE = 24;

/**
 * The address to show an image at. With a storage client, a stored reference is resolved (`undefined`
 * while that is in progress, `null` if it fails); without one only addresses that are safe to load show.
 */
function useDisplaySrc(src: string, storage: StorageClient | null): string | null | undefined {
  const safe = SAFE_SRC.test(src);
  const direct = !storage ? (safe ? src : null) : safe && /^(data|blob):/i.test(src) ? src : undefined;
  const [resolved, setResolved] = useState<{ from: string; url: string | null } | null>(null);
  useEffect(() => {
    if (direct !== undefined || !storage) return;
    let live = true;
    storage.resolve(src).then(
      (url) => live && setResolved({ from: src, url: SAFE_SRC.test(url) ? url : null }),
      () => live && setResolved({ from: src, url: null }),
    );
    return () => {
      live = false;
    };
  }, [src, storage, direct]);
  if (direct !== undefined) return direct;
  return resolved?.from === src ? resolved.url : undefined;
}

/** Where this image's upload stands, and redraws when it changes. */
function useUploadState(session: DocumentSession | null, id: string): UploadState | undefined {
  return useSyncExternalStore(
    (onChange) => (session ? session.onSelectionChange(onChange) : () => {}),
    () => session?.uploadState(id),
    () => undefined,
  );
}

/** How a cropped picture is placed in its frame: bigger than the frame, and shifted so the part that is kept shows. */
function cropStyle(crop: ImageBlock["crop"]): CSSProperties | undefined {
  if (!crop) return undefined;
  const across = 1 - crop.left - crop.right;
  const down = 1 - crop.top - crop.bottom;
  return {
    position: "absolute",
    maxWidth: "none",
    width: `${100 / across}%`,
    height: `${100 / down}%`,
    left: `${(-crop.left / across) * 100}%`,
    top: `${(-crop.top / down) * 100}%`,
  };
}

/** An image that can be resized by dragging its corner handles while selected. */
function ImageView({ block, selected, onResize }: ImageViewProps) {
  const session = useContext(EditorSessionContext);
  const displaySrc = useDisplaySrc(block.src, session?.storage ?? null);
  const upload = useUploadState(session, block.id);
  const [broken, setBroken] = useState<string | null>(null);
  const [live, setLiveState] = useState<{ width: number; height: number } | null>(null);
  // Also kept in a ref, so a quick release still sees the last size even before React re-renders.
  const liveRef = useRef<{ width: number; height: number } | null>(null);
  const setLive = (size: { width: number; height: number } | null) => {
    liveRef.current = size;
    setLiveState(size);
  };
  const drag = useRef<{ x: number; width: number; height: number; direction: 1 | -1 } | null>(null);

  const start = (direction: 1 | -1) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width: block.width, height: block.height, direction };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    // The editor may be zoomed with a CSS transform, so convert screen pixels to document pixels.
    const zoom = (event.currentTarget.closest("[data-pli-zoom]") as HTMLElement | null)?.dataset.pliZoom;
    const scale = zoom ? Number(zoom) || 1 : 1;
    const width = Math.max(MIN_IMAGE_SIZE, Math.round(d.width + (d.direction * (event.clientX - d.x)) / scale));
    setLive({ width, height: Math.round((width * d.height) / d.width) });
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const size = liveRef.current;
    if (size && (size.width !== block.width || size.height !== block.height)) {
      onResize?.(block.id, size.width, size.height);
    }
    setLive(null);
  };

  // Setting the crop: all of the picture is shown, with what is cut away dimmed and a grip on each edge.
  // The mode lives in the session and is announced like a selection change; this view may not be redrawn for it otherwise.
  const croppingId = useSyncExternalStore(
    (listener) => session?.onSelectionChange(listener) ?? (() => undefined),
    () => session?.croppingImage ?? null,
    () => null,
  );
  const cropping = selected && croppingId === block.id;
  const [liveCrop, setLiveCrop] = useState<ImageCrop | null>(null);
  const liveCropRef = useRef<ImageCrop | null>(null);
  const cropDrag = useRef<{ x: number; y: number; edge: "left" | "top" | "right" | "bottom"; start: ImageCrop; width: number; height: number } | null>(null);
  const had = block.crop ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const shownCrop = liveCrop ?? had;
  const showAll = cropping;
  const fullWidth = block.width / (1 - had.left - had.right);
  const fullHeight = block.height / (1 - had.top - had.bottom);
  const startEdge = (edge: "left" | "top" | "right" | "bottom") => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDrag.current = { x: event.clientX, y: event.clientY, edge, start: had, width: fullWidth, height: fullHeight };
  };
  const moveEdge = (event: ReactPointerEvent<HTMLElement>) => {
    const d = cropDrag.current;
    if (!d) return;
    const zoom = (event.currentTarget.closest("[data-pli-zoom]") as HTMLElement | null)?.dataset.pliZoom;
    const scale = zoom ? Number(zoom) || 1 : 1;
    const dx = (event.clientX - d.x) / scale / d.width;
    const dy = (event.clientY - d.y) / scale / d.height;
    const s = d.start;
    // An edge can go no further than 10% of the picture from the one across.
    const next: ImageCrop =
      d.edge === "left" ? { ...s, left: Math.min(Math.max(s.left + dx, 0), 0.9 - s.right) }
      : d.edge === "top" ? { ...s, top: Math.min(Math.max(s.top + dy, 0), 0.9 - s.bottom) }
      : d.edge === "right" ? { ...s, right: Math.min(Math.max(s.right - dx, 0), 0.9 - s.left) }
      : { ...s, bottom: Math.min(Math.max(s.bottom - dy, 0), 0.9 - s.top) };
    liveCropRef.current = next;
    setLiveCrop(next);
  };
  const endEdge = (event: ReactPointerEvent<HTMLElement>) => {
    const d = cropDrag.current;
    cropDrag.current = null;
    if (!d) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const next = liveCropRef.current;
    liveCropRef.current = null;
    setLiveCrop(null);
    if (next) session?.cropImage(block.id, next, { rescale: true });
  };
  const edgeHandle = (edge: "left" | "top" | "right" | "bottom") => (
    <span
      className={`pli-crop-handle pli-crop-handle-${edge}`}
      style={
        edge === "left" ? { left: `${shownCrop.left * 100}%`, top: `${(shownCrop.top + (1 - shownCrop.top - shownCrop.bottom) / 2) * 100}%` }
        : edge === "right" ? { left: `${(1 - shownCrop.right) * 100}%`, top: `${(shownCrop.top + (1 - shownCrop.top - shownCrop.bottom) / 2) * 100}%` }
        : edge === "top" ? { top: `${shownCrop.top * 100}%`, left: `${(shownCrop.left + (1 - shownCrop.left - shownCrop.right) / 2) * 100}%` }
        : { top: `${(1 - shownCrop.bottom) * 100}%`, left: `${(shownCrop.left + (1 - shownCrop.left - shownCrop.right) / 2) * 100}%` }
      }
      role="slider"
      aria-label={`Crop ${edge} edge`}
      onPointerDown={startEdge(edge)}
      onPointerMove={moveEdge}
      onPointerUp={endEdge}
      onPointerCancel={endEdge}
    />
  );

  const width = showAll ? fullWidth : (live?.width ?? block.width);
  const height = showAll ? fullHeight : (live?.height ?? block.height);
  const crop = showAll ? undefined : block.crop;
  const handle = (corner: "nw" | "ne" | "sw" | "se") => (
    <span
      className={`pli-image-handle pli-image-handle-${corner}`}
      onPointerDown={start(corner.endsWith("e") ? 1 : -1)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );

  return (
    <span
      className="pli-image-frame"
      style={{ width, height }}
      data-state={upload?.status ?? (displaySrc === undefined ? "loading" : displaySrc === null || broken === displaySrc ? "unavailable" : undefined)}
    >
      {(() => {
        const picture = (
          <img
            src={displaySrc ?? undefined}
            alt={block.alt ?? ""}
            width={width}
            height={height}
            style={cropStyle(crop)}
            draggable={false}
            onError={() => displaySrc && setBroken(displaySrc)}
          />
        );
        // A cropped picture is drawn bigger than the frame and shifted, inside a box that hides the rest of it.
        return crop ? <span style={{ position: "absolute", inset: 0, overflow: "hidden" }}>{picture}</span> : picture;
      })()}
      {upload?.status === "uploading" && (
        <span className="pli-upload-status" contentEditable={false} role="progressbar" aria-label="Uploading image" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(upload.progress * 100)}>
          <span className="pli-upload-bar">
            <span style={{ width: `${Math.round(upload.progress * 100)}%` }} />
          </span>
        </span>
      )}
      {upload?.status === "failed" && session && (
        <span className="pli-upload-status pli-upload-failed" contentEditable={false} role="alert" title={upload.error.message}>
          <span>{upload.error.code === "cancelled" ? "Upload cancelled" : "Upload failed"}</span>
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => void session.retryUpload(block.id)}>
            Retry
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              session.dismissUpload(block.id);
              session.transact([{ type: "delete_block", id: block.id }]);
            }}
          >
            Remove
          </button>
        </span>
      )}
      {cropping && (
        <>
          <span className="pli-crop-shade" style={{ top: 0, left: 0, right: 0, height: `${shownCrop.top * 100}%` }} />
          <span className="pli-crop-shade" style={{ bottom: 0, left: 0, right: 0, height: `${shownCrop.bottom * 100}%` }} />
          <span className="pli-crop-shade" style={{ top: `${shownCrop.top * 100}%`, bottom: `${shownCrop.bottom * 100}%`, left: 0, width: `${shownCrop.left * 100}%` }} />
          <span className="pli-crop-shade" style={{ top: `${shownCrop.top * 100}%`, bottom: `${shownCrop.bottom * 100}%`, right: 0, width: `${shownCrop.right * 100}%` }} />
          <span className="pli-crop-frame" style={{ top: `${shownCrop.top * 100}%`, bottom: `${shownCrop.bottom * 100}%`, left: `${shownCrop.left * 100}%`, right: `${shownCrop.right * 100}%` }} />
          {edgeHandle("left")}
          {edgeHandle("top")}
          {edgeHandle("right")}
          {edgeHandle("bottom")}
        </>
      )}
      {selected && onResize && !cropping && (
        <>
          {handle("nw")}
          {handle("ne")}
          {handle("sw")}
          {handle("se")}
        </>
      )}
    </span>
  );
}

/** Everything a block list needs to render, passed down into table cells. */
/** The text area of a section, as an offset from where the first section's text starts, and a width. */
export interface SectionBox {
  dx: number;
  width: number;
}

export interface RenderContext {
  doc: Doc;
  epochs?: ReadonlyMap<string, number>;
  layout?: PageGaps | null;
  fields?: FieldValues;
  selectedId?: string | null;
  /** Cells covered by a selection that spans several cells. */
  selectedCells?: ReadonlySet<string>;
  onResizeImage?: (id: string, width: number, height: number) => void;
  /** Where each section's text sits, relative to the first section's, when sections have different margins or page sizes. */
  sectionBoxes?: readonly SectionBox[];
  /** Called with a table's new column widths, as fractions that add up to 1. */
  onResizeColumns?: (id: string, columns: number[]) => void;
  /** Called with a table row's new minimum height, in points, when its bottom edge is dragged. */
  onResizeRow?: (id: string, row: number, points: number) => void;
}

interface BlockViewProps {
  block: Block;
  /** Only for tables, whose cells are rendered with the same context as the page. */
  context?: RenderContext;
  marker?: string;
  placeholder?: string;
  splits?: readonly Split[];
  selected?: boolean;
  fields?: FieldValues;
  toc?: TocEntry[];
  /** The document's named styles, so a block is drawn again when one changes. */
  styles?: Doc["styles"];
  onResizeImage?: (id: string, width: number, height: number) => void;
}

export const BlockView = memo(function BlockView({
  block,
  marker,
  placeholder,
  splits,
  selected,
  fields,
  toc,
  styles,
  onResizeImage,
  context,
}: BlockViewProps) {
  const base = { [BLOCK_ATTR]: block.id, "data-type": block.type };
  // A paragraph style gives the paragraph its spacing and alignment, and its text a look that the text's own marks change.
  const named = styles ? { styles } : undefined;
  const shown = named ? withParagraphStyle(named, block) : block;
  const paragraphStyle = isFormattable(block) ? block.style : undefined;
  const marksOf = named ? (marks: Run["marks"]) => effectiveMarks(named, marks, paragraphStyle) : undefined;
  switch (block.type) {
    case "paragraph":
      return (
        <p {...base} style={formatStyle(shown as FormattableLike)} data-placeholder={placeholder}>
          {content(block.runs, splits, fields, marksOf)}
        </p>
      );
    case "title":
      return (
        <p {...base} className="pli-title" style={formatStyle(shown as FormattableLike)} data-placeholder={placeholder}>
          {content(block.runs, splits, fields, marksOf)}
        </p>
      );
    case "subtitle":
      return (
        <p {...base} className="pli-subtitle" style={formatStyle(shown as FormattableLike)}>
          {content(block.runs, splits, fields, marksOf)}
        </p>
      );
    case "heading":
      return createElement(
        `h${block.level}`,
        { ...base, id: headingAnchor(block), style: formatStyle(shown as FormattableLike) },
        content(block.runs, splits, fields, marksOf),
      );
    case "quote":
      return (
        <blockquote {...base} style={formatStyle(shown as FormattableLike)}>
          {content(block.runs, splits, fields, marksOf)}
        </blockquote>
      );
    case "code_block":
      return (
        <pre {...base} data-language={block.language}>
          <code>{content(block.runs, splits, fields, marksOf)}</code>
        </pre>
      );
    case "list_item":
      return (
        <div
          {...base}
          role="listitem"
          data-list={block.list}
          data-marker={marker}
          style={{ ...formatStyle(shown as FormattableLike), "--pli-depth": block.depth } as CSSProperties}
        >
          {content(block.runs, splits, fields, marksOf)}
        </div>
      );
    case "divider":
      return <hr {...base} contentEditable={false} />;
    case "page_break":
      return <div {...base} className="pli-page-break" contentEditable={false} role="separator" aria-label="Page break" />;
    case "section_break":
      return (
        <div
          {...base}
          className="pli-section-break"
          data-kind={block.kind}
          contentEditable={false}
          role="separator"
          aria-label={block.kind === "next_page" ? "Section break (next page)" : "Section break (continuous)"}
        />
      );
    case "image":
      return (
        <figure
          {...base}
          className="pli-image"
          contentEditable={false}
          data-selected={selected ? "" : undefined}
          data-wrap={block.wrap}
          style={block.align ? { textAlign: block.align } : undefined}
        >
          <ImageView block={block} selected={!!selected} onResize={onResizeImage} />
        </figure>
      );
    case "toc":
      return <TocView block={block} entries={toc ?? []} />;
    case "table":
      return context ? <TableView table={block} context={context} /> : null;
  }
});

const MIN_COLUMN = 0.05;
/** The shortest a row can be dragged to, in points. */
const MIN_ROW_POINTS = 12;

/**
 * A table. Cells render their blocks like the page does. Merged cells span their squares, and the
 * squares they cover aren't drawn. Column borders and row bottoms can be dragged to resize.
 */
function TableView({ table, context }: { table: TableBlock; context: RenderContext }) {
  const [liveColumns, setLiveColumnsState] = useState<number[] | null>(null);
  const liveColumnsRef = useRef<number[] | null>(null);
  const setLiveColumns = (columns: number[] | null) => {
    liveColumnsRef.current = columns;
    setLiveColumnsState(columns);
  };
  const [liveRow, setLiveRowState] = useState<{ row: number; points: number } | null>(null);
  const liveRowRef = useRef<{ row: number; points: number } | null>(null);
  const setLiveRow = (value: { row: number; points: number } | null) => {
    liveRowRef.current = value;
    setLiveRowState(value);
  };
  const drag = useRef<
    | { kind: "column"; x: number; column: number; widths: number[]; tableWidth: number; scale: number }
    | { kind: "row"; y: number; row: number; startPoints: number; scale: number }
    | null
  >(null);

  const scaleOf = (el: Element) => {
    const zoom = (el.closest("[data-pli-zoom]") as HTMLElement | null)?.dataset.pliZoom;
    return zoom ? Number(zoom) || 1 : 1;
  };

  /** Dragging the border to the right of grid column `column`. */
  const startColumn = (column: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const el = event.currentTarget.closest("table")!;
    const scale = scaleOf(el);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "column", x: event.clientX, column, widths: table.columns, tableWidth: el.getBoundingClientRect().width / scale, scale };
  };

  /** Dragging the bottom edge of grid row `row`. */
  const startRow = (row: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const tr = event.currentTarget.closest("table")!.querySelectorAll("tr[data-row-id]")[row] as HTMLElement;
    const scale = scaleOf(tr);
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "row", y: event.clientY, row, startPoints: ((tr.getBoundingClientRect().height / scale) * 3) / 4, scale };
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "column") {
      const delta = (event.clientX - d.x) / d.scale / d.tableWidth;
      const pair = d.widths[d.column]! + d.widths[d.column + 1]!;
      const a = Math.min(Math.max(d.widths[d.column]! + delta, MIN_COLUMN), pair - MIN_COLUMN);
      const next = d.widths.slice();
      next[d.column] = a;
      next[d.column + 1] = pair - a;
      setLiveColumns(next);
    } else {
      // Screen pixels to document pixels to points (1pt is 4/3 px).
      const points = Math.max(MIN_ROW_POINTS, Math.round(d.startPoints + (((event.clientY - d.y) / d.scale) * 3) / 4));
      setLiveRow({ row: d.row, points });
    }
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (d.kind === "column") {
      if (liveColumnsRef.current) context.onResizeColumns?.(table.id, liveColumnsRef.current);
      setLiveColumns(null);
    } else {
      if (liveRowRef.current) context.onResizeRow?.(table.id, liveRowRef.current.row, liveRowRef.current.points);
      setLiveRow(null);
    }
  };

  const columns = liveColumns ?? table.columns;
  const lastColumn = table.columns.length - 1;
  const handles = {
    columns: !!context.onResizeColumns,
    rows: !!context.onResizeRow,
  };

  return (
    <div className="pli-table-box">
      <span className="pli-table-grip" contentEditable={false} role="button" aria-label="Select table" data-table-grip={table.id} />
      <table
        {...{ [BLOCK_ATTR]: table.id, "data-type": "table" }}
        className="pli-table"
        data-borders={table.borders ?? "all"}
        data-selected={context.selectedId === table.id ? "" : undefined}
      >
        <colgroup>
          {columns.map((width, i) => (
            <col key={i} style={{ width: `${width * 100}%` }} />
          ))}
        </colgroup>
        <tbody>
          {table.rows.map((row, r) => {
            const gap = context.layout?.before.get(row.id);
            // The header row is repeated at the end of the gap, so each page of a long table has one.
            const repeat = table.headerRow && r > 0 ? (context.layout?.repeats?.get(row.id) ?? 0) : 0;
            const header = table.rows[0];
            const height = liveRow?.row === r ? liveRow.points : row.height;
            return (
              <Fragment key={row.id}>
                {gap && gap > 0 ? (
                  <tr className="pli-spacer-row" data-pli-spacer="" aria-hidden="true">
                    <td colSpan={table.columns.length} contentEditable={false} style={{ height: Math.max(0, gap - repeat) }} />
                  </tr>
                ) : null}
                {gap && gap > 0 && repeat > 0 && header ? (
                  <tr className="pli-repeat-row" data-pli-spacer="" aria-hidden="true" style={{ height: repeat }}>
                    {header.cells
                      .filter((cell) => !cell.covered)
                      .map((cell) => (
                        <td
                          key={cell.id}
                          colSpan={cell.colSpan}
                          contentEditable={false}
                          data-shaded={cell.shade ? "" : undefined}
                          style={cell.shade ? { backgroundColor: cell.shade } : undefined}
                        >
                          {cell.blocks.map((b) => ("runs" in b ? plainText(b.runs) : "")).join(" ")}
                        </td>
                      ))}
                  </tr>
                ) : null}
                <tr data-row-id={row.id} data-header={r === 0 && table.headerRow ? "" : undefined} style={height ? { height: `${height}pt` } : undefined}>
                  {row.cells.map((cell, c) => {
                    // A square under a merged cell has no element: the merged cell spans it.
                    if (cell.covered) return null;
                    const lastSquareColumn = c + (cell.colSpan ?? 1) - 1;
                    const lastSquareRow = r + (cell.rowSpan ?? 1) - 1;
                    const style: CSSProperties = {};
                    if (cell.shade) style.backgroundColor = cell.shade;
                    if (cell.vAlign) style.verticalAlign = cell.vAlign;
                    return (
                      <td
                        key={cell.id}
                        colSpan={cell.colSpan}
                        rowSpan={cell.rowSpan}
                        data-cell-id={cell.id}
                        data-shaded={cell.shade ? "" : undefined}
                        data-selected-cell={context.selectedCells?.has(cell.id) ? "" : undefined}
                        style={Object.keys(style).length > 0 ? style : undefined}
                      >
                        {renderBlocks(cell.blocks, context)}
                        {handles.columns && lastSquareColumn < lastColumn && (
                          <span
                            className="pli-col-resizer"
                            contentEditable={false}
                            onPointerDown={startColumn(lastSquareColumn)}
                            onPointerMove={move}
                            onPointerUp={end}
                            onPointerCancel={end}
                          />
                        )}
                        {handles.rows && (
                          <span
                            className="pli-row-resizer"
                            contentEditable={false}
                            onPointerDown={startRow(lastSquareRow)}
                            onPointerMove={move}
                            onPointerUp={end}
                            onPointerCancel={end}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TocView({ block, entries }: { block: TocBlock; entries: TocEntry[] }) {
  const title = block.title ?? "Table of contents";
  return (
    <nav {...{ [BLOCK_ATTR]: block.id, "data-type": "toc" }} className="pli-toc" contentEditable={false} aria-label={title || "Table of contents"}>
      {title && <p className="pli-toc-title">{title}</p>}
      {entries.length === 0 ? (
        <p className="pli-toc-empty">Add headings to your document and they will appear here.</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} style={{ paddingLeft: `${(entry.level - 1) * 1.25}em` }}>
              <a href={`#${headingAnchor(entry)}`} data-toc-target={entry.id}>
                <span className="pli-toc-text">{entry.text}</span>
                {entry.page !== undefined && <span className="pli-toc-page">{entry.page}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

/**
 * Renders a list of sibling blocks: the page's, or one table cell's. Consecutive list items are
 * grouped, and a page gap before a block becomes a spacer.
 */
function renderBlocks(blocks: readonly Block[], context: RenderContext, placeholder?: string): ReactNode[] {
  const { doc, epochs, layout, fields, selectedId, onResizeImage } = context;
  const markers = computeMarkers(blocks);
  const only = blocks.length === 1 ? blocks[0] : undefined;
  const showPlaceholder = !!placeholder && only?.type === "paragraph" && only.runs.length === 0;

  const root: ReactNode[] = [];
  /** Where nodes go on the page: the page itself, or a section's box when sections have different margins. */
  let out: ReactNode[] = root;
  /** Where nodes go: the page, or the column container being filled. */
  let sink: ReactNode[] = out;
  let group: ReactNode[] = [];
  let groupKey = "";
  const flush = () => {
    if (group.length === 0) return;
    sink.push(
      <div role="list" className="pli-list" key={`list:${groupKey}`}>
        {group}
      </div>,
    );
    group = [];
  };

  // Text in columns is drawn in containers that flow it into the columns. The paginator splits a run of blocks
  // into one container for each page it spans; without a layout (pageless), the run is a single container.
  const pageLevel = blocks === doc.blocks;
  const runAt = new Map<number, ColumnRun>();
  if (pageLevel) for (const run of columnRuns(doc)) for (let k = run.from; k < run.to; k++) runAt.set(k, run);
  const sectionOfIndex: number[] = [];
  if (pageLevel && context.sectionBoxes) {
    sectionsOf(doc).forEach((section, s) => {
      for (let k = section.start ? section.from - 1 : 0; k < section.to; k++) sectionOfIndex[k] = s;
    });
  }
  let box: { section: number; children: ReactNode[] } | null = null;
  const closeBox = () => {
    if (!box) return;
    const dims = context.sectionBoxes![box.section];
    root.push(
      <div key={`section:${box.section}`} className="pli-section-box" style={dims ? { marginLeft: dims.dx, width: dims.width } : undefined}>
        {box.children}
      </div>,
    );
    box = null;
    out = root;
    sink = out;
  };
  let open: { key: string; run: ColumnRun; height: number | undefined; children: ReactNode[] } | null = null;
  const closeColumns = () => {
    flush();
    if (open) {
      const { run, key, height, children } = open;
      const { count, gap, rule } = run.columns;
      out.push(
        <div
          key={key}
          className="pli-cols"
          data-columns={count}
          style={
            {
              "--pli-cols": count,
              "--pli-col-gap": `${gap}pt`,
              columnCount: count,
              columnGap: `${gap}pt`,
              columnRule: rule ? "1px solid #b5bac4" : undefined,
              height,
            } as CSSProperties
          }
        >
          {children}
        </div>,
      );
    }
    open = null;
    sink = out;
  };

  blocks.forEach((block, i) => {
    if (context.sectionBoxes && pageLevel) {
      const s = sectionOfIndex[i] ?? 0;
      if (box && box.section !== s) {
        closeColumns();
        closeBox();
      }
      if (!box) {
        box = { section: s, children: [] };
        out = box.children;
        sink = out;
      }
    }
    const gap = layout?.before.get(block.id);
    const spacer =
      gap && gap > 0 ? (
        <div key={`gap:${block.id}`} className="pli-spacer" data-pli-spacer="" contentEditable={false} aria-hidden="true" style={{ height: gap }} />
      ) : null;
    const node = (
      <BlockView
        key={`${block.id}:${epochs?.get(block.id) ?? 0}`}
        block={block}
        marker={markers[i]}
        placeholder={showPlaceholder ? placeholder : undefined}
        splits={layout?.splits.get(block.id)}
        selected={selectedId === block.id}
        fields={fields}
        styles={doc.styles}
        toc={block.type === "toc" ? tocEntries(doc.blocks, block.levels, layout?.pageOf) : undefined}
        onResizeImage={onResizeImage}
        context={block.type === "table" ? context : undefined}
      />
    );

    const run = runAt.get(i);
    const chunk = layout?.chunks?.get(block.id);
    if (open && (!run || run !== open.run || chunk)) closeColumns();
    if (run && !open) {
      // A new container starts here: at the start of the run, or where the paginator started a page's worth.
      flush();
      if (spacer) out.push(spacer);
      open = { key: `cols:${block.id}`, run, height: chunk?.height, children: [] };
      sink = open.children;
    }

    if (block.type === "list_item") {
      if (group.length === 0) groupKey = block.id;
      if (spacer && !run) group.push(spacer);
      group.push(node);
    } else {
      flush();
      if (spacer && !run) sink.push(spacer);
      sink.push(node);
    }
  });
  closeColumns();
  closeBox();
  return root;
}

export interface DocumentViewProps {
  doc: Doc;
  /** Shown while the document is a single empty paragraph. */
  placeholder?: string;
  /**
   * Per-block counters that force a block's DOM to be rebuilt. The editor bumps one after the
   * browser edited that block's DOM directly (IME composition).
   */
  epochs?: ReadonlyMap<string, number>;
  /** Page gaps from the paginator. Omit for continuous (pageless) layout. */
  layout?: PageGaps | null;
  /** Real values for page-number fields, for static copies of a header or footer. */
  fields?: FieldValues;
  /** The block (an image or a table) that is currently selected. */
  selectedId?: string | null;
  /** Table cells covered by a selection across cells, to draw them highlighted. */
  selectedCells?: ReadonlySet<string>;
  onResizeImage?: (id: string, width: number, height: number) => void;
  /** Where each section's text sits, for a document whose sections have different margins or page sizes. */
  sectionBoxes?: readonly SectionBox[];
  /** Called when a column border is dragged. Omit to make column widths fixed. */
  onResizeColumns?: (id: string, columns: number[]) => void;
  /** Called when a row's bottom edge is dragged. Omit to make row heights fixed. */
  onResizeRow?: (id: string, row: number, points: number) => void;
}

/** Renders a document's blocks. Pure and hook-free apart from drag state, so it also works for static output. */
export const DocumentView = memo(function DocumentView({
  doc,
  placeholder,
  epochs,
  layout,
  fields,
  selectedId,
  selectedCells,
  onResizeImage,
  sectionBoxes,
  onResizeColumns,
  onResizeRow,
}: DocumentViewProps) {
  const context: RenderContext = { doc, epochs, layout, fields, selectedId, selectedCells, onResizeImage, sectionBoxes, onResizeColumns, onResizeRow };
  return <>{renderBlocks(doc.blocks, context, placeholder)}</>;
});
