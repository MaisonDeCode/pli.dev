import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { AnnotController } from "./annotController";
import { LINE_HEIGHT, TEXT_PAD, textHeight } from "./annotSvg";
import { useController } from "./annotUi";
import { useStacks } from "./AnnotationLayer";
import type { PageContext } from "./extensions";

/**
 * The text box being typed in, as a text area laid over the page in page space (so it is the size of the box on any zoom or
 * turn of the view). Typing grows the box; Escape, Ctrl/Cmd+Enter or clicking away finishes. A new box joins the document
 * only if it has text.
 */
export function TextEditor({ ctx, c }: { ctx: PageContext; c: AnnotController }): ReactNode {
  useController(c);
  const e = c.editing;
  const ref = useRef<HTMLTextAreaElement>(null);
  const stacks = useStacks(c.options.fonts, e ? [e.annot.style.family] : []);
  const id = e?.annot.id;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [id]);
  if (!e || e.page !== ctx.page.id) return null;
  const a = e.annot;
  const { rect, style } = a;
  const grow = (el: HTMLTextAreaElement) => {
    const need = Math.ceil(el.scrollHeight);
    if (need > rect.h + 0.5) c.editText({ text: el.value, rect: { ...rect, h: need } });
    else c.editText({ text: el.value });
  };
  return (
    <textarea
      ref={ref}
      className="pli-pdf-text-editor"
      aria-label="Text box"
      spellCheck
      value={a.text}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: Math.max(rect.h, textHeight(1, style.size)),
        padding: TEXT_PAD,
        fontFamily: stacks(style.family),
        fontSize: style.size,
        lineHeight: LINE_HEIGHT,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? "italic" : "normal",
        color: style.color,
        textAlign: style.align ?? "left",
        background: a.fill ?? "rgb(255 255 255 / 0.6)",
        border: a.stroke && a.stroke.width > 0 ? `${a.stroke.width}px ${a.stroke.dash?.length ? "dashed" : "solid"} ${a.stroke.color}` : "none",
      }}
      onChange={(ev) => grow(ev.currentTarget)}
      onBlur={() => c.finishEdit()}
      onKeyDown={(ev) => {
        // Keys typed here are text, not shortcuts.
        ev.stopPropagation();
        if (ev.key === "Escape" || (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey))) {
          ev.preventDefault();
          c.finishEdit();
        } else if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && (ev.key.toLowerCase() === "b" || ev.key.toLowerCase() === "i")) {
          ev.preventDefault();
          c.toggleTextStyle(ev.key.toLowerCase() === "b" ? "bold" : "italic");
        }
      }}
    />
  );
}
