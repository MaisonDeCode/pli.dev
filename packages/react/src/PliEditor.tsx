import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { PliError, cellRect, cellsInRect, image, isCollapsed, isFloating, locate, usedFonts, type DocumentSession, type PasteInput } from "@pli.dev/docs";
import type { FontRegistry } from "@pli.dev/core";
import { useDocumentFonts, useFonts } from "./ui/fonts";
import { applySelectionToDom, revealSelection } from "./dom";
import { attachEditorEvents } from "./events";
import { useSessionRevision } from "./hooks";
import { fitImage, imageBlockFromFile, prepareImageFile } from "./images";
import { EditorSessionContext, PlaceholdersContext } from "./session-context";
import { placeholderMode, type PlaceholderOptions } from "./ui/placeholders";
import { EMPTY_LAYOUT, sameLayout, type Geometry, type Layout } from "./layout/paginate";
import { measureAndPaginate, type NotesGeometry, type SectionGeometry } from "./layout/measure";
import { DocumentView, type FieldValues, type SectionBox } from "./render";
import type { FloatFrame } from "./floats";

export interface PaginationConfig extends Geometry {
  /** The zoom applied to the editor with a CSS transform. */
  zoom: number;
  /** The shape of each section's pages, when sections differ. Without it every page is `content` tall. */
  sections?: readonly SectionGeometry[];
}

export interface PliEditorProps {
  session: DocumentSession;
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Shown while the document is empty. */
  placeholder?: string;
  /**
   * The fonts of this editor: what is loaded when the document uses a font, and what makes text measured again when one
   * arrives. Defaults to the provider's registry, or the shared one (`defaultFonts()` from `@pli.dev/core`).
   */
  fonts?: FontRegistry;
  className?: string;
  style?: CSSProperties;
  /**
   * Lay the content out in pages: gaps are added so content avoids the page boundaries described
   * here. Omit for continuous (pageless) flow.
   */
  pagination?: PaginationConfig | null;
  /**
   * How tall each footnote is, so pages can leave room for the notes cited on them. Only meaningful with
   * `pagination`. The editor draws the numbers by the references; the notes themselves are drawn by the page.
   */
  footnotes?: NotesGeometry;
  /** Where each section's text sits, when sections have different margins or page sizes. See `DocumentViewProps`. */
  sectionBoxes?: readonly SectionBox[];
  /** Where each floating picture and text box is drawn on its page (see `floatFrames`). Without it they are drawn where they sit in the text. */
  floatFrames?: ReadonlyMap<string, FloatFrame>;
  /** Called whenever the page layout changes. */
  onLayout?: (layout: Layout) => void;
  /** Called when the editing area gains or loses focus. */
  onFocusChange?: (focused: boolean) => void;
  /** Widest an inserted image may be, in CSS pixels. */
  maxImageWidth?: number;
  /**
   * Called when a file can't be added: it is too big or the wrong type for the session's storage, or it
   * can't be read. An upload that starts and then fails is shown on the image itself, with Retry and Remove.
   */
  onStorageError?: (error: PliError, file?: File) => void;
  /** Real values for page-number fields. Only meaningful for static copies, not for editing. */
  fields?: FieldValues;
  /** Draw each `{{ … }}` as a chip (see `PliDocument`'s `placeholders`). Left out, it follows the `PliDocument` the editor is in, if any. */
  placeholders?: boolean | PlaceholderOptions;
  /** Accessible name for the editing area. */
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export interface PliEditorHandle {
  /** Focuses the editor and puts the caret where the session's selection is. */
  focus(): void;
  /** Inserts image files at the caret, as if they were pasted. */
  insertImages(files: File[]): Promise<void>;
  /**
   * Pastes what a clipboard offered: Pli's own format, HTML (Word, Google Docs, Excel, web pages),
   * tab-separated text as a table, or plain text. Pasted images get their size once they load.
   * Returns whether anything was pasted.
   */
  paste(input: PasteInput): boolean;
  /** The editable element. */
  readonly element: HTMLElement | null;
}

/** Stops re-measuring if a layout never settles, which would otherwise loop forever. */
const MAX_LAYOUT_PASSES = 6;

/**
 * The editing surface. It renders the session's document and turns keyboard, mouse, clipboard
 * and IME input into session commands. With `pagination` it also keeps content clear of page
 * boundaries. Pair it with `EditorToolbar`, or use `PliDocument` for the whole editor.
 */
export const PliEditor = forwardRef<PliEditorHandle, PliEditorProps>(function PliEditor(
  {
    session,
    readOnly = false,
    autoFocus = false,
    placeholder = "Start writing…",
    className,
    style,
    pagination,
    onLayout,
    footnotes,
    sectionBoxes,
    floatFrames,
    onFocusChange,
    maxImageWidth,
    onStorageError,
    fields,
    placeholders,
    fonts: fontsProp,
    ...aria
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inheritedPlaceholders = useContext(PlaceholdersContext);
  const ownKey = typeof placeholders === "object" ? JSON.stringify([placeholders.labels, placeholders.fields]) : String(placeholders);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `ownKey` stands for the option
  const ownChips = useMemo(() => placeholderMode(placeholders), [ownKey]);
  const chips = placeholders === undefined ? inheritedPlaceholders : ownChips;
  // When tags are shown by name, the caret treats each as one character.
  const atomicRef = useRef(false);
  atomicRef.current = !!chips && !!chips.label;
  useSessionRevision(session);
  const [epochs, setEpochs] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [layout, setLayout] = useState<Layout | null>(null);
  const [fontsTick, setFontsTick] = useState(0);
  const passes = useRef<{ doc: unknown; notes: unknown; shapes?: unknown; count: number }>({ doc: session.state, notes: undefined, count: 0 });
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const maxImageWidthRef = useRef(maxImageWidth);
  maxImageWidthRef.current = maxImageWidth;
  const onLayoutRef = useRef(onLayout);
  onLayoutRef.current = onLayout;
  const onStorageErrorRef = useRef(onStorageError);
  onStorageErrorRef.current = onStorageError;

  const remount = useCallback((blockId: string) => {
    setEpochs((prev) => new Map(prev).set(blockId, (prev.get(blockId) ?? 0) + 1));
  }, []);

  const insertImages = useCallback(
    async (files: File[]) => {
      const storage = session.storage;
      for (const file of files) {
        try {
          if (!storage) {
            session.insertBlockAtCaret(await imageBlockFromFile(file, { maxWidth: maxImageWidthRef.current }));
            continue;
          }
          // With storage the image appears at once, from the file on this computer, and is uploaded in the
          // background. The document points at the stored file when that finishes.
          storage.check(file);
          const prepared = await prepareImageFile(file, { maxWidth: maxImageWidthRef.current });
          const block = image(prepared.previewUrl, prepared.size, { alt: prepared.alt });
          if (!session.insertBlockAtCaret(block)) {
            URL.revokeObjectURL(prepared.previewUrl);
            continue;
          }
          void session.uploadImage(block.id, prepared.blob, { name: file.name, type: prepared.blob.type }).then((outcome) => {
            // Still needed by undo history when the new reference couldn't join the insert's step.
            if (outcome.status === "gone" || (outcome.status === "stored" && outcome.merged)) URL.revokeObjectURL(prepared.previewUrl);
          });
        } catch (error) {
          // A file that can't be used is skipped; the rest still go in.
          const reported = error instanceof PliError ? error : new PliError("storage", error instanceof Error ? error.message : "The file could not be read.", { cause: error });
          onStorageErrorRef.current?.(reported, file);
        }
      }
    },
    [session],
  );

  /** Pasted images with no size in their HTML are measured once loaded, and sized to fit the page. */
  const sizePastedImages = useCallback(
    (ids: string[]) => {
      // Sizing joins the paste's undo step, as long as nothing else has been done since.
      let expected = session.state;
      for (const id of ids) {
        const block = locate(session.state, id)?.block;
        if (block?.type !== "image") continue;
        const img = new Image();
        img.onload = () => {
          const current = locate(session.state, id)?.block;
          if (current?.type !== "image" || !img.naturalWidth || !img.naturalHeight) return;
          const size = fitImage(img.naturalWidth, img.naturalHeight, maxImageWidthRef.current ?? 600);
          const merge = session.state === expected;
          session.updateBlock(id, size, { merge });
          expected = session.state;
        };
        img.src = block.src;
      }
    },
    [session],
  );

  const paste = useCallback(
    (input: PasteInput) => {
      if (readOnlyRef.current) return false;
      const result = session.paste(input);
      sizePastedImages(result.unsizedImages);
      return result.applied;
    },
    [session, sizePastedImages],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return attachEditorEvents(root, session, {
      isReadOnly: () => readOnlyRef.current,
      isAtomic: () => atomicRef.current,
      remount,
      insertImages: (files) => void insertImages(files),
      pastedImages: sizePastedImages,
    });
  }, [session, remount, insertImages, sizePastedImages]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onFocusChange) return;
    const focus = () => onFocusChange(true);
    const blur = (event: FocusEvent) => {
      if (!root.contains(event.relatedTarget as Node | null)) onFocusChange(false);
    };
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", blur);
    return () => {
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", blur);
    };
  }, [onFocusChange]);

  // The fonts the document names are loaded, and the text is laid out again as each arrives (a font changes widths).
  const fonts = useFonts(fontsProp);
  const usedNow = useMemo(() => usedFonts(session.state), [session.state]);
  const fontsVersion = useDocumentFonts(fonts, usedNow);
  // Web fonts change text widths, so lay out again once they have loaded.
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontsTick((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  const doc = session.state;
  const stride = pagination?.stride;
  const content = pagination?.content;
  const gap = pagination?.gap;
  const sectionShapes = pagination?.sections;
  const zoom = pagination?.zoom ?? 1;

  // Measure and paginate after every render that could have moved something, until it settles.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (stride === undefined || content === undefined) {
      if (layout) setLayout(null);
      return;
    }
    if (passes.current.doc !== doc || passes.current.notes !== footnotes || passes.current.shapes !== sectionShapes) passes.current = { doc, notes: footnotes, shapes: sectionShapes, count: 0 };
    if (passes.current.count >= MAX_LAYOUT_PASSES) return;
    passes.current.count++;

    const next = measureAndPaginate(root, doc.blocks, zoom, { stride, content, gap }, { notes: footnotes, columns: doc.page?.columns, sections: sectionShapes });
    if (!layout || !sameLayout(layout, next)) {
      setLayout(next);
      onLayoutRef.current?.(next);
    } else if (passes.current.count === 1) {
      // Nothing moved, but let the owner know the layout is current.
      onLayoutRef.current?.(layout);
    }
  }, [doc, layout, stride, content, gap, sectionShapes, zoom, epochs, fontsTick, fontsVersion, footnotes]);

  const resizeRow = useCallback(
    (id: string, row: number, points: number) => {
      const table = locate(session.state, id)?.block;
      if (table?.type !== "table") return;
      session.updateBlock(id, { rows: table.rows.map((r, i) => (i === row ? { ...r, height: points } : r)) });
    },
    [session],
  );

  const resizeColumns = useCallback(
    (id: string, columns: number[]) => {
      session.updateBlock(id, { columns });
    },
    [session],
  );

  // Dragging a floating picture or text box moves it: its position is kept as a distance from the same edge, now further along.
  const floatFramesRef = useRef(floatFrames);
  floatFramesRef.current = floatFrames;
  const moveFloat = useCallback(
    (id: string, dx: number, dy: number) => {
      const block = locate(session.state, id)?.block;
      if (!block || !isFloating(block)) return;
      const frame = floatFramesRef.current?.get(id);
      const { x, y } = block.float;
      // Where its edge is now, counted from where the position starts. Lined up with an edge becomes a distance.
      const fromX = frame ? frame.left + dx - frame.origin.x : (x.offset ?? 0) + dx;
      const fromY = frame ? frame.top + dy - frame.origin.y : (y.offset ?? 0) + dy;
      session.setFloat({ x: { from: x.from, offset: Math.round(fromX) }, y: { from: y.from, offset: Math.round(fromY) } }, id);
    },
    [session],
  );
  const resizeFloat = useCallback(
    (id: string, width: number, height: number) => {
      session.setFloat({ width, height }, id);
    },
    [session],
  );

  const resizeImage = useCallback(
    (id: string, width: number, height: number) => {
      session.updateBlock(id, { width, height });
    },
    [session],
  );

  // After every render, make the browser's selection match the session's, but only while the
  // editor has focus so we never steal it from somewhere else on the page.
  const selection = session.selection;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !selection || !root.contains(root.ownerDocument.activeElement)) return;
    if (applySelectionToDom(root, selection)) revealSelection(root, selection);
  }, [selection, doc, epochs, layout]);

  useImperativeHandle(
    ref,
    () => ({
      focus() {
        const root = rootRef.current;
        if (!root) return;
        root.focus({ preventScroll: true });
        if (session.selection) applySelectionToDom(root, session.selection);
      },
      insertImages,
      paste,
      get element() {
        return rootRef.current;
      },
    }),
    [session, insertImages, paste],
  );

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  // The selected block, for images and whole tables, which are selected as a unit.
  const selectedBlock = selection && isCollapsed(selection) ? locate(doc, selection.focus.block)?.block : undefined;
  // A caret in a text box's text counts as having the box, so it shows its handles.
  const insideBox = selection && isCollapsed(selection) ? locate(doc, selection.focus.block)?.cell?.table : undefined;
  const selectedId = insideBox?.float ? insideBox.id : selectedBlock?.type === "image" || selectedBlock?.type === "table" ? selectedBlock.id : null;

  // Cells covered by a drag across several cells, drawn highlighted.
  const covered = selection ? cellRect(doc, selection) : null;
  const coveredKey = covered ? cellsInRect(covered).map((c) => c.cell.id).join(",") : "";
  const selectedCells = useMemo(() => (coveredKey ? new Set(coveredKey.split(",")) : undefined), [coveredKey]);

  return (
    <div
      ref={rootRef}
      className={className ? `pli-editor ${className}` : "pli-editor"}
      style={style}
      role="textbox"
      aria-multiline="true"
      aria-readonly={readOnly || undefined}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      spellCheck
      data-pli-editor=""
      {...aria}
    >
      <EditorSessionContext.Provider value={session}>
      <PlaceholdersContext.Provider value={chips}>
      <DocumentView
        doc={doc}
        placeholder={placeholder}
        epochs={epochs}
        layout={pagination ? (layout ?? EMPTY_LAYOUT) : null}
        fields={fields}
        selectedId={selectedId}
        selectedCells={selectedCells}
        sectionBoxes={sectionBoxes}
        onResizeImage={readOnly ? undefined : resizeImage}
        onResizeColumns={readOnly ? undefined : resizeColumns}
        onResizeRow={readOnly ? undefined : resizeRow}
        floatFrames={floatFrames}
        onMoveFloat={readOnly ? undefined : moveFloat}
        onResizeFloat={readOnly ? undefined : resizeFloat}
      />
      </PlaceholdersContext.Provider>
      </EditorSessionContext.Provider>
    </div>
  );
});
