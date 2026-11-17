import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import {
  applyMarks,
  flatOffset,
  mapIndex,
  textPosition,
  marksAt,
  ordered,
  paragraphText,
  replaceRange,
  setParagraphProps,
  textInRange,
  textLength,
  type DeckSession,
  type Marks,
  type MarksPatch,
  type Paragraph,
  type ResolvedElement,
  type ResolvedText,
  type TextPos,
  type TextRange,
} from "@pli.dev/decks";
import { TextBlock, type TextHighlight } from "./SlideView";
import { elementTextRect } from "./engine";
import { domToPos, htmlToText, readSelection, writeSelection } from "./domsel";
import {
  LINE_BREAK,
  caretAt,
  changeIndent,
  clampRange,
  deleteContent,
  endOf,
  formatOf,
  isCollapsed,
  pressEnter,
  toggleList,
  wholeRange,
  type BulletKind,
  type DeleteUnit,
  type TextFormat,
} from "./textedit";

export interface TextEditState {
  format: TextFormat;
  range: TextRange;
  collapsed: boolean;
}

/** What the toolbar and menus use to act on the text being edited. */
export interface TextEditApi {
  state: TextEditState;
  toggleMark(key: "bold" | "italic" | "underline" | "strike"): void;
  setMarks(patch: MarksPatch): void;
  setParagraph(patch: Parameters<typeof setParagraphProps>[2]): void;
  toggleList(kind: BulletKind): void;
  indent(delta: number): void;
  /** Links the selected text, or inserts `label` as linked text when nothing is selected. `null` removes the link. */
  link(url: string | null, label?: string): void;
  selectAll(): void;
  focus(): void;
  selectedText(): string;
  /** Replaces the selection with text (as typing or pasting does). */
  insert(text: string): void;
}

export interface TextEditorProps {
  session: DeckSession;
  owner: string;
  el: ResolvedElement;
  /** A table cell, when editing one. */
  cell?: [number, number];
  scale: number;
  initialRange?: TextRange;
  /** Text typed to start the edit. */
  initialText?: string;
  /** Where the click that started the edit landed (client coordinates): the caret goes there. */
  point?: { x: number; y: number };
  apiRef: MutableRefObject<TextEditApi | null>;
  highlights?: readonly TextHighlight[];
  onExit: () => void;
  onState: (state: TextEditState) => void;
  /** Tab in a table cell: return true when handled (moved to another cell). */
  onTab?: (back: boolean) => boolean;
}

const NO_MARKS: MarksPatch = {};

/** The text position under a point on the screen, if the browser can tell. */
function caretAtPoint(body: HTMLElement, x: number, y: number): TextPos | null {
  const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null };
  let node: Node | null = null;
  let offset = 0;
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    if (p) ({ offsetNode: node, offset } = p);
  } else if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y);
    if (r) ({ startContainer: node, startOffset: offset } = r);
  }
  return node ? domToPos(body, node, offset) : null;
}

/**
 * Edits the text of a shape or table cell in place. The text is drawn by the same code as the slide (so it looks identical),
 * on a content-editable surface; every edit arrives as a `beforeinput` event, is applied to the model, and the DOM is redrawn
 * from it, so the browser never changes the text behind the model's back (except while an IME is composing).
 */
export function TextEditor({ session, owner, el, cell, scale, initialRange, initialText, point, apiRef, highlights, onExit, onState, onTab }: TextEditorProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rangeRef = useRef<TextRange>({ from: { p: 0, o: 0 }, to: { p: 0, o: 0 } });
  const pendingRef = useRef<MarksPatch>(NO_MARKS);
  const burstRef = useRef(false);
  const composingRef = useRef(false);
  const lastReport = useRef("");
  const [epoch, setEpoch] = useState(0);
  const latest = useRef({ el, onExit, onState, onTab });
  latest.current = { el, onExit, onState, onTab };

  const resolved: ResolvedText | undefined = cell ? el.table?.rows[cell[0]]?.cells[cell[1]]?.text : el.text;
  const target = useMemo(() => ({ owner, id: el.id, cell }), [owner, el.id, cell]);

  const raw = useCallback((): Paragraph[] => {
    const e = session.element(target.owner, target.id);
    if (e.type === "table" && target.cell) return e.rows[target.cell[0]]?.cells[target.cell[1]]?.paragraphs ?? [{ runs: [] }];
    if (e.type === "shape") return e.text?.paragraphs.length ? e.text.paragraphs : [{ runs: [] }];
    return [{ runs: [] }];
  }, [session, target]);

  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;
  const listInfo = useCallback((p: number) => {
    const rp = resolvedRef.current?.paragraphs[p];
    return { listed: !!rp && (!!rp.bullet || rp.level > 0), level: rp?.level ?? 0 };
  }, []);

  const report = useCallback(() => {
    const ps = raw();
    const range = clampRange(ps, rangeRef.current);
    const format = formatOf(ps, resolvedRef.current, range);
    for (const [k, v] of Object.entries(pendingRef.current)) {
      if (k === "bold" || k === "italic" || k === "underline" || k === "strike") format[k] = !!v;
      else if (k === "fontSize" && typeof v === "number") format.fontSize = v;
      else if (k === "fontFamily" && typeof v === "string") format.fontFamily = v;
      else if (k === "color") format.color = typeof v === "string" ? v : format.color;
    }
    const state: TextEditState = { format, range, collapsed: isCollapsed(range) };
    const key = JSON.stringify(state);
    if (key === lastReport.current) return state;
    lastReport.current = key;
    latest.current.onState(state);
    return state;
  }, [raw]);

  const selectionMeta = useCallback(
    (range: TextRange) => ({ slide: session.selection.slide, slides: session.selection.slides, elements: [target.id], text: { element: target.id, range } }),
    [session, target],
  );

  /** Writes new paragraphs. Consecutive edits fold into one undo step until `newStep` or the burst is closed. */
  const commit = useCallback(
    (paragraphs: Paragraph[], caret: TextRange, newStep = false) => {
      const merge = burstRef.current && !newStep;
      const before = { ...session.selection };
      const after = selectionMeta(caret);
      const options = { merge, before, after };
      if (target.cell) session.setCellParagraphs(target.owner, target.id, target.cell[0], target.cell[1], paragraphs, options);
      else session.setText(target.owner, target.id, paragraphs, options);
      session.selection = after;
      burstRef.current = !newStep;
      pendingRef.current = NO_MARKS;
      rangeRef.current = caret;
    },
    [session, selectionMeta, target],
  );

  // What other people do to this text moves the caret and selection with the words they were at.
  const lastText = useRef<Paragraph[] | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        return raw();
      } catch {
        return null;
      }
    };
    lastText.current = read();
    return session.subscribe((ev) => {
      const next = read();
      const old = lastText.current;
      lastText.current = next;
      if (ev.origin !== "remote" || !old || !next) return;
      const edits = ev.ops.filter((o) => o.type === "edit_text" && o.id === target.id && JSON.stringify(o.cell ?? null) === JSON.stringify(target.cell ?? null));
      if (edits.length === 0) return;
      const move = (pos: TextPos): TextPos => {
        let at = flatOffset(old, pos);
        for (const o of edits) if (o.type === "edit_text") at = mapIndex(at, o.delta);
        return textPosition(next, at);
      };
      const r = rangeRef.current;
      rangeRef.current = { from: move(r.from), to: move(r.to) };
      setEpoch((e) => e + 1);
    });
  }, [session, target, raw]);

  const marksForTyping = useCallback((ps: Paragraph[], pos: TextPos): Marks => {
    const m: Record<string, unknown> = { ...marksAt(ps, pos) };
    for (const [k, v] of Object.entries(pendingRef.current)) {
      if (v === null || v === undefined || v === false) delete m[k];
      else m[k] = v;
    }
    return m as Marks;
  }, []);

  const insert = useCallback(
    (text: string) => {
      const ps = raw();
      const range = clampRange(ps, rangeRef.current);
      const r = ordered(range);
      const out = replaceRange(ps, r, text, marksForTyping(ps, r.from));
      commit(out.paragraphs, caretAt(out.caret));
    },
    [raw, commit, marksForTyping],
  );

  const doDelete = useCallback(
    (dir: -1 | 1, unit: DeleteUnit) => {
      const ps = raw();
      const out = deleteContent(ps, clampRange(ps, rangeRef.current), dir, unit, listInfo);
      if (out) commit(out.paragraphs, caretAt(out.caret));
    },
    [raw, commit, listInfo],
  );

  const enter = useCallback(
    (soft: boolean) => {
      const ps = raw();
      const range = clampRange(ps, rangeRef.current);
      if (soft) {
        const out = replaceRange(ps, range, LINE_BREAK, marksForTyping(ps, ordered(range).from), { literal: true });
        commit(out.paragraphs, caretAt(out.caret));
        return;
      }
      const out = pressEnter(ps, range, listInfo, marksForTyping(ps, ordered(range).from));
      commit(out.paragraphs, caretAt(out.caret), false);
    },
    [raw, commit, listInfo, marksForTyping],
  );

  /** Text of a layout or master placeholder: formatting it edits the level styles the slides inherit. */
  const templated = useCallback(() => !target.cell && session.isTemplateText(target.owner, target.id), [session, target]);

  const setMarks = useCallback(
    (patch: MarksPatch) => {
      const ps = raw();
      const r = clampRange(ps, rangeRef.current);
      if (templated()) {
        burstRef.current = false;
        pendingRef.current = NO_MARKS;
        session.formatTemplateText(target.owner, target.id, patch, r);
        report();
        return;
      }
      if (isCollapsed(r)) {
        pendingRef.current = { ...pendingRef.current, ...patch };
        burstRef.current = false;
        report();
        return;
      }
      burstRef.current = false;
      commit(applyMarks(ps, r, patch), r, true);
    },
    [raw, commit, report, templated, session, target],
  );

  const api = useMemo<TextEditApi>(
    () => ({
      get state() {
        return report();
      },
      toggleMark(key) {
        const on = report().format[key];
        // `false`, not removal: text that is bold because its placeholder says so has to be told it isn't
        setMarks({ [key]: on ? false : true });
      },
      setMarks,
      setParagraph(patch) {
        const ps = raw();
        const r = clampRange(ps, rangeRef.current);
        burstRef.current = false;
        if (templated()) return void session.formatTemplateParagraphs(target.owner, target.id, patch, r);
        commit(setParagraphProps(ps, r, patch), r, true);
      },
      toggleList(kind) {
        const ps = raw();
        const r = clampRange(ps, rangeRef.current);
        burstRef.current = false;
        const toggled = toggleList(ps, r, kind, (p) => resolvedRef.current?.paragraphs[p]);
        if (templated()) return void session.formatTemplateParagraphs(target.owner, target.id, (i) => ({ bullet: toggled[i]?.bullet ?? null, marL: toggled[i]?.marL, indent: toggled[i]?.indent }), r);
        commit(toggled, r, true);
      },
      indent(delta) {
        const ps = raw();
        const r = clampRange(ps, rangeRef.current);
        burstRef.current = false;
        if (templated()) return void session.formatTemplateParagraphs(target.owner, target.id, (i) => ({ marL: Math.max(0, (resolvedRef.current?.paragraphs[i]?.marL ?? 0) + delta * 18) }), r);
        commit(changeIndent(ps, r, delta, (p) => ({ level: resolvedRef.current?.paragraphs[p]?.level ?? 0, marL: resolvedRef.current?.paragraphs[p]?.marL ?? 0 })), r, true);
      },
      link(url, label) {
        const ps = raw();
        const r = clampRange(ps, rangeRef.current);
        if (isCollapsed(r) && url && label) {
          const out = replaceRange(ps, r, label, { ...marksAt(ps, r.from), link: url });
          burstRef.current = false;
          commit(out.paragraphs, { from: r.from, to: out.caret }, true);
        } else setMarks({ link: url });
      },
      selectAll() {
        rangeRef.current = wholeRange(raw());
        burstRef.current = false;
        if (bodyRef.current) writeSelection(bodyRef.current, rangeRef.current);
        report();
      },
      focus() {
        bodyRef.current?.focus({ preventScroll: true });
      },
      selectedText() {
        return textInRange(raw(), clampRange(raw(), rangeRef.current));
      },
      insert,
    }),
    [raw, commit, report, setMarks, insert, templated, session, target, listInfo],
  );
  apiRef.current = api;

  // ---- DOM events ----------------------------------------------------------------------------------------------

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;

    const textFrom = (e: InputEvent | ClipboardEvent): string => {
      const dt = (e as InputEvent).dataTransfer ?? (e as ClipboardEvent).clipboardData;
      const plain = dt?.getData("text/plain");
      if (plain) return plain;
      const html = dt?.getData("text/html");
      if (html) return htmlToText(html);
      return (e as InputEvent).data ?? "";
    };

    const onBeforeInput = (e: InputEvent) => {
      if (composingRef.current || e.isComposing) return;
      const type = e.inputType;
      e.preventDefault();
      switch (type) {
        case "insertText":
        case "insertReplacementText":
        case "insertFromPaste":
        case "insertFromPasteAsQuotation":
        case "insertFromDrop":
        case "insertFromYank": {
          const text = textFrom(e);
          if (text) insert(text);
          break;
        }
        case "insertParagraph":
          enter(false);
          break;
        case "insertLineBreak":
          enter(true);
          break;
        case "deleteContentBackward":
          doDelete(-1, "char");
          break;
        case "deleteContentForward":
          doDelete(1, "char");
          break;
        case "deleteWordBackward":
          doDelete(-1, "word");
          break;
        case "deleteWordForward":
          doDelete(1, "word");
          break;
        case "deleteSoftLineBackward":
        case "deleteHardLineBackward":
          doDelete(-1, "line");
          break;
        case "deleteSoftLineForward":
        case "deleteHardLineForward":
          doDelete(1, "line");
          break;
        case "deleteByCut":
        case "deleteByDrag":
        case "deleteContent": {
          const ps = raw();
          const r = clampRange(ps, rangeRef.current);
          if (!isCollapsed(r)) {
            const out = replaceRange(ps, r, "");
            commit(out.paragraphs, caretAt(out.caret), true);
          }
          break;
        }
        case "historyUndo":
          burstRef.current = false;
          session.undo();
          break;
        case "historyRedo":
          burstRef.current = false;
          session.redo();
          break;
        case "formatBold":
          api.toggleMark("bold");
          break;
        case "formatItalic":
          api.toggleMark("italic");
          break;
        case "formatUnderline":
          api.toggleMark("underline");
          break;
        default:
          break;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || composingRef.current || e.keyCode === 229) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        latest.current.onExit();
        return;
      }
      if (e.key === "Tab" && !mod && !e.altKey) {
        e.preventDefault();
        const back = e.shiftKey;
        if (latest.current.onTab?.(back)) return;
        const ps = raw();
        const r = clampRange(ps, rangeRef.current);
        const listed = ordered(r).from.p === ordered(r).to.p ? listInfo(ordered(r).from.p).listed : true;
        if (listed) api.indent(back ? -1 : 1);
        else if (!back) insert("\t");
        return;
      }
      if (mod && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        const toggle = k === "b" ? "bold" : k === "i" ? "italic" : k === "u" ? "underline" : null;
        if (toggle) {
          e.preventDefault();
          api.toggleMark(toggle);
        }
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = textFrom(e);
      if (text) insert(text.replace(/\r\n?/g, "\n"));
    };
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      const ps = raw();
      const r = clampRange(ps, rangeRef.current);
      if (isCollapsed(r)) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", textInRange(ps, r));
      if (cut) {
        const out = replaceRange(ps, r, "");
        commit(out.paragraphs, caretAt(out.caret), true);
      }
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);

    const onCompositionStart = () => {
      composingRef.current = true;
    };
    const onCompositionEnd = () => {
      composingRef.current = false;
      // The browser changed the text itself: read it back into the model, then redraw from the model.
      const ps = raw();
      const domParas = [...body.querySelectorAll<HTMLElement>(":scope > [data-p]")].map((p) => p.querySelector("[data-runs]")?.textContent ?? "");
      let out = ps;
      let caret = rangeRef.current;
      if (domParas.length === ps.length) {
        domParas.forEach((dom, i) => {
          const was = paragraphText(out[i]!);
          if (dom === was) return;
          let pre = 0;
          while (pre < was.length && pre < dom.length && was[pre] === dom[pre]) pre++;
          let suf = 0;
          while (suf < was.length - pre && suf < dom.length - pre && was[was.length - 1 - suf] === dom[dom.length - 1 - suf]) suf++;
          const res = replaceRange(out, { from: { p: i, o: pre }, to: { p: i, o: was.length - suf } }, dom.slice(pre, dom.length - suf));
          out = res.paragraphs;
          caret = caretAt(res.caret);
        });
      }
      const sel = readSelection(body);
      if (sel) caret = sel;
      commit(out, caret);
      setEpoch((n) => n + 1);
    };

    const onSelectionChange = () => {
      if (composingRef.current) return;
      const sel = readSelection(body);
      if (!sel) return;
      const cur = rangeRef.current;
      if (sel.from.p === cur.from.p && sel.from.o === cur.from.o && sel.to.p === cur.to.p && sel.to.o === cur.to.o) return;
      rangeRef.current = sel;
      pendingRef.current = NO_MARKS;
      burstRef.current = false;
      session.selection = selectionMeta(sel);
      report();
    };

    body.addEventListener("beforeinput", onBeforeInput as EventListener);
    body.addEventListener("keydown", onKeyDown);
    body.addEventListener("paste", onPaste);
    body.addEventListener("copy", copy);
    body.addEventListener("cut", cut);
    body.addEventListener("compositionstart", onCompositionStart);
    body.addEventListener("compositionend", onCompositionEnd);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      body.removeEventListener("beforeinput", onBeforeInput as EventListener);
      body.removeEventListener("keydown", onKeyDown);
      body.removeEventListener("paste", onPaste);
      body.removeEventListener("copy", copy);
      body.removeEventListener("cut", cut);
      body.removeEventListener("compositionstart", onCompositionStart);
      body.removeEventListener("compositionend", onCompositionEnd);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
    // The handlers read everything through refs and stable callbacks.
  }, [epoch, session, raw, insert, enter, doDelete, commit, listInfo, api, report, selectionMeta]);

  // ---- Mount, and redraw after each change ------------------------------------------------------------------------

  const started = useRef(false);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.setAttribute("contenteditable", "plaintext-only" in document.body.style ? "true" : "true");
    body.setAttribute("role", "textbox");
    body.setAttribute("aria-multiline", "true");
    body.setAttribute("aria-label", cell ? "Cell text" : "Slide text");
    body.setAttribute("spellcheck", "true");
    body.tabIndex = 0;
    if (!started.current) {
      started.current = true;
      const ps = raw();
      const at = point ? caretAtPoint(body, point.x, point.y) : null;
      rangeRef.current = clampRange(ps, initialRange ?? (at ? caretAt(at) : caretAt(endOf(ps))));
      session.selection = selectionMeta(rangeRef.current);
      body.focus({ preventScroll: true });
      if (initialText) insert(initialText);
    }
    writeSelection(body, clampRange(raw(), rangeRef.current));
    report();
  });

  // Text boxes grow with their text.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const e = latest.current.el;
    if (!body || cell || e.source.type !== "shape" || !e.source.textBox || e.source.placeholder || e.source.text?.autofit === "none") return;
    if (e.source.text?.autofit !== "resize" && e.source.text?.autofit !== undefined) return;
    const insets = resolved?.insets ?? { t: 3.6, b: 3.6 };
    const need = body.scrollHeight + insets.t + insets.b;
    if (need > 0 && Math.abs(need - e.h) > 1 && body.scrollHeight > 0) {
      session.updateElements(owner, [e.id], (old) => ({ ...old, y: old.y ?? e.y, x: old.x ?? e.x, w: old.w ?? e.w, h: Math.ceil(need) }), { merge: true });
    }
  });

  // ---- Where it sits -----------------------------------------------------------------------------------------------

  let box = { x: el.x, y: el.y, w: el.w, h: el.h };
  let rect = elementTextRect(el);
  if (cell && el.table) {
    const c = el.table.rows[cell[0]]?.cells[cell[1]];
    if (c) {
      box = { x: el.x + c.x, y: el.y + c.y, w: c.w, h: c.h };
      rect = { x: 0, y: 0, w: c.w, h: c.h };
    }
  }
  return (
    <div
      className="pli-deck-editor"
      data-editing={el.id}
      style={{ left: box.x * scale, top: box.y * scale, width: box.w * scale, height: box.h * scale, transform: el.rotation && !cell ? `rotate(${el.rotation}deg)` : undefined }}
    >
      <div className="pli-deck-editor-inner" style={{ width: box.w, height: box.h, transform: `scale(${scale})` }}>
        {resolved && (
          <TextBlock
            key={epoch}
            text={resolved}
            rect={rect}
            element={el.id}
            cell={cell}
            editable
            highlights={highlights}
            upsideDown={el.flipV}
            bodyRef={(n) => {
              bodyRef.current = n;
            }}
          />
        )}
      </div>
    </div>
  );
}
