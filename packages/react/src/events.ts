import {
  FRAGMENT_MIME,
  caret,
  commands,
  isCollapsed,
  isTextBlock,
  locate,
  pageBreak,
  placeholdersIn,
  plainText,
  fragmentToJson,
  selectedBlocks,
  selectionState,
  selectionToPlainText,
  sliceSelection,
  toHtml,
  type DocumentSession,
  type Point,
  type Selection,
} from "@pli.dev/docs";
import { applySelectionToDom, findBlockElement, namedTagStart, pointFromDom, readBlockText, selectionFromDom, selectionFromRange } from "./dom";
import { BLOCK_ATTR, NON_TEXT_TYPES } from "./render";

export interface EditorEventOptions {
  isReadOnly(): boolean;
  /**
   * Whether a template's `{{ … }}` tags are shown by name, and so are one character to the caret: it never rests inside one,
   * Backspace and Delete remove a whole tag, and a selection takes in a tag it touches.
   */
  isAtomic?(): boolean;
  /** Called with a block id whose DOM the browser edited directly and which must be rebuilt. */
  remount(blockId: string): void;
  /** Called with image files that were pasted or dropped. */
  insertImages?(files: File[]): void;
  /** Called with the ids of pasted images whose size isn't known, so the host can load them and set it. */
  pastedImages?(ids: string[]): void;
}

const isImage = (file: File) => file.type.startsWith("image/");

/**
 * Wires native DOM events to the session. The editor never lets the browser change the DOM
 * itself: `beforeinput` is cancelled and turned into a command, and React re-renders from the
 * model. The one exception is IME composition, which is reconciled when it ends.
 *
 * These are native listeners on purpose. React's `onBeforeInput` is not the real `beforeinput`.
 */
export function attachEditorEvents(root: HTMLElement, session: DocumentSession, options: EditorEventOptions): () => void {
  const doc = root.ownerDocument;
  let composing = false;
  /** When Ctrl/Cmd+Shift+V was pressed: the paste event that follows is plain text. */
  let plainPasteAt = 0;

  const atomic = (): boolean => options.isAtomic?.() === true;

  /** The tags in a block that are drawn as one piece: where each starts and ends in the block's text. */
  const tagsIn = (blockId: string) => {
    const found = locate(session.state, blockId);
    // A tag that can't be read is drawn as written, so the caret may go inside it to fix it.
    return found && isTextBlock(found.block) ? placeholdersIn(plainText(found.block.runs)).filter((t) => t.kind !== "error") : [];
  };

  /**
   * Moves a selection out of the tags it is inside. A caret that is inside one jumps to the side it was moving toward (it came from
   * the left, so to the right); a range takes in the whole tag at each end.
   */
  const snap = (selection: Selection, previous: Selection | null, dom: { anchor: number | null; focus: number | null } = { anchor: null, focus: null }): Selection => {
    // A point is inside a tag when it is between its characters, or at an edge but the browser has it inside the tag's element
    // (`chip` is where that element begins, which says which of two tags side by side it is).
    const inside = (p: Point, chip: number | null) =>
      tagsIn(p.block).find((t) => (p.offset > t.from && p.offset < t.to) || (chip !== null && chip >= t.from && chip < t.to && p.offset >= t.from && p.offset <= t.to));
    const a = inside(selection.anchor, dom.anchor);
    const f = inside(selection.focus, dom.focus);
    if (!a && !f) return selection;
    const { anchor, focus } = selection;
    if (isCollapsed(selection) && f) {
      const was = previous?.focus.block === focus.block ? previous.focus.offset : null;
      const nearer = focus.offset - f.from < f.to - focus.offset ? f.from : f.to;
      return caret(focus.block, was === null ? nearer : was <= f.from ? f.to : was >= f.to ? f.from : nearer);
    }
    const forward = anchor.block === focus.block ? focus.offset >= anchor.offset : true;
    return {
      anchor: a ? { block: anchor.block, offset: forward ? a.from : a.to } : anchor,
      focus: f ? { block: focus.block, offset: forward ? f.to : f.from } : focus,
    };
  };

  const syncSelection = (): void => {
    const selection = selectionFromDom(root);
    if (!selection) return;
    const sel = doc.getSelection();
    const snapped = atomic() ? snap(selection, session.selection, { anchor: namedTagStart(root, sel?.anchorNode ?? null), focus: namedTagStart(root, sel?.focusNode ?? null) }) : selection;
    session.select(snapped);
    // The browser put the caret inside a tag: move it to where the model has it, outside.
    if (snapped !== selection) applySelectionToDom(root, snapped, true);
  };

  const onSelectionChange = (): void => {
    if (!composing) syncSelection();
  };

  const selectRange = (event: InputEvent): void => {
    const range = event.getTargetRanges?.()[0];
    const selection = range && selectionFromRange(root, range);
    if (selection) session.select(atomic() ? snap(selection, null) : selection);
  };

  const insertText = (text: string): void => {
    if (text.includes("\n")) session.pastePlainText(text);
    else session.typeText(text);
  };

  const dataOf = (event: InputEvent): string => event.data ?? event.dataTransfer?.getData("text/plain") ?? "";

  const onBeforeInput = (event: InputEvent): void => {
    if (composing || event.isComposing) return;
    event.preventDefault();
    if (options.isReadOnly()) return;
    syncSelection();

    switch (event.inputType) {
      case "insertText":
        insertText(dataOf(event));
        break;
      case "insertReplacementText":
        // Spellcheck or autocorrect: the browser says which range to replace.
        selectRange(event);
        insertText(dataOf(event));
        break;
      case "insertParagraph":
        session.splitBlock();
        break;
      case "insertLineBreak":
        session.typeText("\n");
        break;
      case "insertFromPaste":
      case "insertFromDrop":
      case "insertFromYank":
        insertText(dataOf(event));
        break;
      case "deleteContentBackward":
      case "deleteContentForward": {
        // When the browser's range sits inside one block (it knows about grapheme clusters, such
        // as family emoji), delete exactly that; otherwise let the command handle block joins.
        const back = event.inputType === "deleteContentBackward";
        // Next to a tag that is shown by name, one key press removes the whole tag.
        const at = atomic() ? session.selection : null;
        const tag = at && isCollapsed(at) ? tagsIn(at.focus.block).find((t) => (back ? t.to === at.focus.offset : t.from === at.focus.offset)) : undefined;
        if (at && tag) {
          session.select({ anchor: { block: at.focus.block, offset: tag.from }, focus: { block: at.focus.block, offset: tag.to } });
          session.deleteSelection();
          break;
        }
        const range = event.getTargetRanges?.()[0];
        const target = range && selectionFromRange(root, range);
        // With an image, divider or table selected, the browser's range is about the text next to it.
        const here = session.selection && locate(session.state, session.selection.focus.block)?.block;
        const onText = !here || isTextBlock(here);
        if (onText && target && !isCollapsed(target) && target.anchor.block === target.focus.block) {
          session.select(target);
          session.deleteSelection();
        } else if (event.inputType === "deleteContentBackward") {
          session.backspace();
        } else {
          session.deleteForward();
        }
        break;
      }
      case "deleteByCut":
      case "deleteByDrag":
        session.deleteSelection();
        break;
      case "historyUndo":
        session.undo();
        break;
      case "historyRedo":
        session.redo();
        break;
      case "formatBold":
        session.toggleMark("bold");
        break;
      case "formatItalic":
        session.toggleMark("italic");
        break;
      case "formatUnderline":
        session.toggleMark("underline");
        break;
      case "formatStrikeThrough":
        session.toggleMark("strike");
        break;
      case "formatJustifyLeft":
        session.setAlign("left");
        break;
      case "formatJustifyCenter":
        session.setAlign("center");
        break;
      case "formatJustifyRight":
        session.setAlign("right");
        break;
      case "formatJustifyFull":
        session.setAlign("justify");
        break;
      default: {
        // Word, line and other larger deletions arrive with the range to remove.
        if (event.inputType.startsWith("delete")) {
          selectRange(event);
          session.deleteSelection();
        }
      }
    }
  };

  const onCompositionStart = (): void => {
    composing = true;
    // A composition replaces the selection, so clear it from the model first.
    const selection = session.selection;
    if (selection && !isCollapsed(selection) && !options.isReadOnly()) session.deleteSelection();
  };

  const onCompositionEnd = (): void => {
    composing = false;
    if (options.isReadOnly()) return;
    const dom = doc.getSelection();
    const el = dom && findBlockElement(root, dom.focusNode);
    if (!dom || !el) return;
    const id = el.getAttribute(BLOCK_ATTR)!;
    const caret = pointFromDom(root, dom.focusNode!, dom.focusOffset);
    const text = readBlockText(el);
    session.exec(commands.syncBlockText(id, text, caret?.block === id ? caret.offset : text.length));
    // The browser changed this block's DOM behind React's back; rebuild it from the model.
    options.remount(id);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (composing || event.isComposing || options.isReadOnly()) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let handled = false;
    if (mod && event.shiftKey && !event.altKey && key === "v") plainPasteAt = Date.now();
    // Ctrl/Cmd+] and [ move paragraphs in and out, as in other word processors.
    if (mod && !event.altKey && !event.shiftKey && (event.key === "]" || event.key === "[")) {
      syncSelection();
      if (event.key === "]") session.indent();
      else session.outdent();
      event.preventDefault();
      return;
    }

    if (mod && event.altKey && !event.shiftKey) {
      // Heading shortcuts. `code` is used because Alt changes `key` on a Mac.
      const digit = /^Digit([0-6])$/.exec(event.code)?.[1];
      if (digit !== undefined) {
        syncSelection();
        handled = true;
        if (digit === "0") session.setBlockType({ type: "paragraph" });
        else session.toggleBlockType({ type: "heading", level: Number(digit) as 1 | 2 | 3 | 4 | 5 | 6 });
      }
    } else if (mod && event.shiftKey && !event.altKey) {
      syncSelection();
      handled = true;
      if (event.code === "Digit7") session.toggleBlockType({ type: "list_item", list: "ordered" });
      else if (event.code === "Digit8") session.toggleBlockType({ type: "list_item", list: "bullet" });
      else if (key === "l") session.setAlign("left");
      else if (key === "e") session.setAlign("center");
      else if (key === "r") session.setAlign("right");
      else if (key === "j") session.setAlign("justify");
      else if (key === "x") session.toggleMark("strike");
      else if (key === "z") session.redo();
      else handled = false;
    } else if (mod && !event.altKey) {
      syncSelection();
      handled = true;
      if (key === "b") session.toggleMark("bold");
      else if (key === "i") session.toggleMark("italic");
      else if (key === "u") session.toggleMark("underline");
      else if (key === "z") session.undo();
      else if (key === "y") session.redo();
      else if (key === "." || key === ">") session.toggleMark("superscript");
      else if (key === "," || key === "<") session.toggleMark("subscript");
      else if (key === "\\") session.clearFormatting();
      else if (key === "enter") session.insertBlockAtCaret(pageBreak());
      else handled = false;
    } else if (event.key === "Tab" && !event.altKey) {
      syncSelection();
      // In a table, Tab moves between cells (and adds a row after the last one).
      if (session.moveToCell(event.shiftKey ? -1 : 1)) {
        event.preventDefault();
        return;
      }
      const selection = session.selection;
      // Only capture Tab inside a list, so keyboard users can still tab out of the editor.
      if (selection && selectedBlocks(session.state, selection).some((b) => b.type === "list_item")) {
        if (event.shiftKey) session.outdent();
        else session.indent();
        handled = true;
      } else if (selection && atomic() && isCollapsed(selection)) {
        // A way past a tag shown by name from the keyboard: with the caret against one, Tab steps over it (and Shift+Tab back over it).
        // Anywhere else Tab goes on to the next thing on the page as usual, so nobody is trapped in the editor.
        const { block, offset } = selection.focus;
        const tag = tagsIn(block).find((t) => (event.shiftKey ? t.to === offset : t.from === offset));
        if (tag) {
          const next = caret(block, event.shiftKey ? tag.from : tag.to);
          session.select(next);
          applySelectionToDom(root, next, true);
          handled = true;
        }
      }
    }
    if (handled) event.preventDefault();
  };

  const writeClipboard = (event: ClipboardEvent): boolean => {
    syncSelection();
    const selection = session.selection;
    if (!selection || isCollapsed(selection) || !event.clipboardData) return false;
    const slice = sliceSelection(session.state, selection);
    event.clipboardData.setData("text/plain", selectionToPlainText(session.state, selection));
    event.clipboardData.setData("text/html", toHtml(slice));
    // Copying within Pli keeps everything: this is read back before the HTML.
    event.clipboardData.setData(FRAGMENT_MIME, fragmentToJson(slice.blocks, slice.footnotes, slice.styles));
    event.preventDefault();
    return true;
  };

  const onCopy = (event: ClipboardEvent): void => {
    writeClipboard(event);
  };

  const onCut = (event: ClipboardEvent): void => {
    if (options.isReadOnly()) return;
    if (writeClipboard(event)) session.deleteSelection();
  };

  const onPaste = (event: ClipboardEvent): void => {
    event.preventDefault();
    if (options.isReadOnly()) return;
    syncSelection();
    const data = event.clipboardData;
    const plain = Date.now() - plainPasteAt < 1000;
    plainPasteAt = 0;
    const fragment = data?.getData(FRAGMENT_MIME) || undefined;
    const html = data?.getData("text/html") || undefined;
    const rtf = data?.getData("text/rtf") || undefined;
    const text = data?.getData("text/plain") || undefined;

    // A screenshot, or an image copied from a page, comes as a file with no text. Spreadsheets and
    // Word also add a picture of what they copied; with text present, the text wins.
    const files = [...(data?.files ?? [])].filter(isImage);
    if (files.length > 0 && !fragment && (text ?? "").trim() === "") {
      options.insertImages?.(files);
      return;
    }
    const result = session.paste({ fragment, html, rtf, text, plain });
    if (result.unsizedImages.length > 0) options.pastedImages?.(result.unsizedImages);
  };

  /** The document position under a screen point, for drops. */
  const pointAt = (x: number, y: number) => {
    const d = doc as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const position = d.caretPositionFromPoint?.(x, y);
    if (position) return pointFromDom(root, position.offsetNode, position.offset);
    const range = doc.caretRangeFromPoint?.(x, y);
    return range ? pointFromDom(root, range.startContainer, range.startOffset) : null;
  };

  const onDragOver = (event: DragEvent): void => {
    if ([...(event.dataTransfer?.items ?? [])].some((item) => item.kind === "file")) event.preventDefault();
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    if (options.isReadOnly()) return;
    const files = [...(event.dataTransfer?.files ?? [])].filter(isImage);
    if (files.length === 0) return;
    const point = pointAt(event.clientX, event.clientY);
    if (point) session.select(caret(point.block, point.offset));
    options.insertImages?.(files);
  };

  /** Clicking a block that holds no text (an image, page break, divider) selects it as a whole. */
  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-toc-target]")) return;
    if (event.target.closest(".pli-image-handle, .pli-col-resizer, .pli-row-resizer")) return;
    // The grip at a table's corner selects the whole table.
    const grip = event.target.closest<HTMLElement>("[data-table-grip]");
    if (grip) {
      event.preventDefault();
      root.focus({ preventScroll: true });
      session.select(caret(grip.getAttribute("data-table-grip")!, 0));
      return;
    }
    const el = event.target.closest<HTMLElement>(`[${BLOCK_ATTR}]`);
    // A table is a container: clicks in it belong to its cells' text.
    if (!el || el.getAttribute("data-type") === "table" || !NON_TEXT_TYPES.has(el.getAttribute("data-type") ?? "")) return;
    event.preventDefault();
    root.focus({ preventScroll: true });
    session.select(caret(el.getAttribute(BLOCK_ATTR)!, 0));
  };

  /** Table of contents entries jump to their heading. */
  const onClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLElement>("[data-toc-target]");
    if (link) {
      event.preventDefault();
      const id = link.getAttribute("data-toc-target")!;
      const heading = [...root.querySelectorAll<HTMLElement>(`[${BLOCK_ATTR}]`)].find((el) => el.getAttribute(BLOCK_ATTR) === id);
      if (heading) {
        session.select(caret(id, 0));
        heading.scrollIntoView({ block: "start", behavior: "smooth" });
      }
      return;
    }
    // Links are edited in place, never followed, unless the user holds the modifier key.
    const anchor = event.target.closest("a");
    if (anchor && !(event.metaKey || event.ctrlKey)) event.preventDefault();
  };

  const cancel = (event: Event): void => event.preventDefault();

  doc.addEventListener("selectionchange", onSelectionChange);
  root.addEventListener("beforeinput", onBeforeInput as EventListener);
  root.addEventListener("compositionstart", onCompositionStart);
  root.addEventListener("compositionend", onCompositionEnd);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("copy", onCopy);
  root.addEventListener("cut", onCut);
  root.addEventListener("paste", onPaste);
  root.addEventListener("dragover", onDragOver);
  root.addEventListener("drop", onDrop);
  root.addEventListener("dragstart", cancel);
  root.addEventListener("mousedown", onMouseDown);
  root.addEventListener("click", onClick);

  return () => {
    doc.removeEventListener("selectionchange", onSelectionChange);
    root.removeEventListener("beforeinput", onBeforeInput as EventListener);
    root.removeEventListener("compositionstart", onCompositionStart);
    root.removeEventListener("compositionend", onCompositionEnd);
    root.removeEventListener("keydown", onKeyDown);
    root.removeEventListener("copy", onCopy);
    root.removeEventListener("cut", onCut);
    root.removeEventListener("paste", onPaste);
    root.removeEventListener("dragover", onDragOver);
    root.removeEventListener("drop", onDrop);
    root.removeEventListener("dragstart", cancel);
    root.removeEventListener("mousedown", onMouseDown);
    root.removeEventListener("click", onClick);
  };
}
