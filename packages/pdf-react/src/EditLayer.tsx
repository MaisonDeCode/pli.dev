import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import type { PageEdit } from "@pli.dev/pdf";
import { useStacks } from "./AnnotationLayer";
import type { EditController } from "./editController";
import { grow, shrinkScale, type EditImage, type EditRun, type PageContent } from "./editGeometry";
import type { PageContext } from "./extensions";
import { textWidth } from "./PageView";
import { useStore } from "./store";

/**
 * What the Edit tool draws on a page, in three layers:
 * - `EditPreviewLayer` (SVG, always): the changes waiting for the save, as they will look: a white box over the old text or
 *   picture and the new text or picture on it. The saved file is the truth; this is a preview, drawn with the browser's font.
 * - `EditToolOverlay` (SVG, while the tool is on): a box round every piece of text and every picture, brighter under the pointer.
 * - `EditDomLayer` (HTML, always): the in-place editor, and the reason a piece of text cannot be edited.
 */

type TextEdit = Extract<PageEdit, { type: "text" }>;
type ImageEdit = Extract<PageEdit, { type: "image" }>;

const WHITE = "#ffffff";
const NOTHING: PageContent = { runs: [], images: [] };

/** The new text of a run, drawn at the old one's baseline. */
function NewText({ run, text, looks, stacks, scale }: { run: EditRun; text: string; looks: ReturnType<EditController["looks"]>; stacks: (f: string) => string; scale: number }) {
  if (text === "") return null;
  const squeeze = looks.fit === "shrink" ? shrinkScale(textWidth(text, looks.size), run.length) : 1;
  const [x, y] = run.origin;
  return (
    <text
      className="pli-edit-new"
      transform={`translate(${x} ${y})${run.angle ? ` rotate(${Math.round(run.angle * 100) / 100})` : ""}${squeeze !== 1 ? ` scale(${Math.round(squeeze * 1000) / 1000} 1)` : ""}`}
      x={0}
      y={0}
      fill={looks.color}
      fontFamily={stacks(looks.family)}
      fontSize={looks.size}
      fontWeight={looks.bold ? 700 : 400}
      fontStyle={looks.italic ? "italic" : "normal"}
      style={{ whiteSpace: "pre" }}
      data-scale={scale}
    >
      {text}
    </text>
  );
}

function PicturePreview({ edit, image }: { edit: ImageEdit; image: EditImage }) {
  const b = image.box;
  return (
    <g className="pli-edit-picture" data-edit={edit.id}>
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={WHITE} />
      {edit.picture && <image href={edit.picture.src} x={b.x} y={b.y} width={b.w} height={b.h} preserveAspectRatio={edit.fit === "stretch" ? "none" : "xMidYMid meet"} />}
    </g>
  );
}

/** The changes waiting for the save, drawn on the page they belong to. */
export function EditPreviewLayer({ ctx, c }: { ctx: PageContext; c: EditController }): ReactNode {
  useStore(c);
  const page = ctx.session.doc.pages.find((p) => p.id === ctx.page.id) ?? ctx.page;
  const edits = (page.edits ?? []).filter((e): e is TextEdit | ImageEdit => e.type === "text" || e.type === "image");
  const pending = edits.length > 0;
  useEffect(() => {
    if (pending) c.load(page.id);
  }, [c, page.id, pending]);
  // Pages nobody edited are not read for this.
  const content = pending ? c.content(page.id) : NOTHING;
  const editingRun = c.editing?.page === page.id ? c.editing.run.id : null;
  const texts = edits.filter((e): e is TextEdit => e.type === "text");
  const stacks = useStacks(
    c.options.fonts,
    texts.flatMap((e) => {
      const run = content.runs.find((r) => r.id === e.run);
      const family = e.family ?? run?.font.family;
      return family ? [family] : [];
    }),
  );
  if (!pending) return null;
  return (
    <g className="pli-edit-preview" data-page={page.id}>
      {edits.map((e) => {
        if (e.type === "image") {
          const image = content.images.find((i) => i.id === e.target);
          return image ? <PicturePreview key={e.id} edit={e} image={image} /> : null;
        }
        const run = content.runs.find((r) => r.id === e.run);
        if (!run || run.id === editingRun) return null;
        const b = grow(run.box, 1);
        return (
          <g key={e.id} className="pli-edit-text" data-edit={e.id}>
            <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={WHITE} />
            <NewText run={run} text={e.text} looks={c.looks(run, e)} stacks={stacks} scale={ctx.scale} />
          </g>
        );
      })}
    </g>
  );
}

/** Boxes round what the tool can change: faint for everything, strong under the pointer, grey when it cannot be edited. */
export function EditToolOverlay({ ctx, c }: { ctx: PageContext; c: EditController }): ReactNode {
  useStore(c);
  useEffect(() => {
    c.load(ctx.page.id);
  }, [c, ctx.page.id]);
  const content = c.content(ctx.page.id);
  const px = 1 / ctx.scale;
  const hover = c.hover?.page === ctx.page.id ? c.hover : null;
  const sel = c.selected?.page === ctx.page.id ? c.selected : null;
  const editingRun = c.editing?.page === ctx.page.id ? c.editing.run.id : null;
  return (
    <g className="pli-edit-boxes" data-page={ctx.page.id}>
      {content.images.map((i) => (
        <rect
          key={i.id}
          className="pli-edit-box pli-edit-image"
          data-image={i.id}
          data-hover={hover?.kind === "image" && hover.id === i.id ? "" : undefined}
          data-selected={sel?.kind === "image" && sel.id === i.id ? "" : undefined}
          x={i.box.x}
          y={i.box.y}
          width={i.box.w}
          height={i.box.h}
          strokeWidth={1.5 * px}
        />
      ))}
      {content.runs.map((r) =>
        r.id === editingRun ? null : (
          <rect
            key={r.id}
            className="pli-edit-box pli-edit-run"
            data-run={r.id}
            data-locked={r.editable ? undefined : ""}
            data-hover={hover?.kind === "run" && hover.id === r.id ? "" : undefined}
            data-selected={sel?.kind === "run" && sel.id === r.id ? "" : undefined}
            x={r.box.x - 1}
            y={r.box.y - 1}
            width={r.box.w + 2}
            height={r.box.h + 2}
            strokeWidth={1 * px}
          />
        ),
      )}
    </g>
  );
}

/** Puts the keyboard focus back on the piece of text that was being edited, so the keyboard can go on to the next. */
function refocus(root: Element | null, runId: string) {
  // Only when the focus has nowhere to be: it must not be taken from something the person has gone on to (another editor).
  const active = document.activeElement;
  if (active && active !== document.body) return;
  const el = [...(root?.querySelectorAll<HTMLElement>(".pli-edit-hit") ?? [])].find((e) => e.dataset.run === runId);
  el?.focus({ preventScroll: true });
}

/**
 * The keyboard's way to the same things the pointer clicks: every piece of text and every picture of the page is a transparent
 * button in reading order (Tab and Shift with Tab walk them, Enter or Space opens the editor on text or selects a picture),
 * laid exactly over it. Only while the tool is on. A screen reader hears what each one is.
 */
function KeyboardTargets({ ctx, c }: { ctx: PageContext; c: EditController }): ReactNode {
  const content = c.content(ctx.page.id);
  const editing = c.editing?.page === ctx.page.id ? c.editing.run.id : null;
  const px = 1 / ctx.scale;
  return (
    <div className="pli-edit-hits" role="group" aria-label={`Text and pictures on page ${ctx.index + 1}`}>
      {content.runs.map((r) =>
        r.id === editing ? null : (
          <div
            key={r.id}
            className="pli-edit-hit"
            role="button"
            tabIndex={0}
            data-run={r.id}
            aria-label={r.editable ? `Edit text: ${r.text}` : `Text that cannot be edited: ${r.text}`}
            aria-disabled={r.editable ? undefined : true}
            aria-description={r.editable ? undefined : r.reason}
            style={{ left: r.box.x - 1, top: r.box.y - 1, width: r.box.w + 2, height: r.box.h + 2, ["--px" as string]: px }}
            onFocus={() => c.point({ page: ctx.page.id, kind: "run", id: r.id })}
            onBlur={() => c.point(null)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              if (r.editable) c.beginEdit(ctx.page.id, r);
              else c.selectRun(ctx.page.id, r);
            }}
          />
        ),
      )}
      {content.images.map((i, n) => (
        <div
          key={i.id}
          className="pli-edit-hit"
          role="button"
          tabIndex={0}
          data-image={i.id}
          aria-label={`Picture ${n + 1}: choose to replace or delete it`}
          style={{ left: i.box.x, top: i.box.y, width: i.box.w, height: i.box.h, ["--px" as string]: px }}
          onFocus={() => c.point({ page: ctx.page.id, kind: "image", id: i.id })}
          onBlur={() => c.point(null)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            c.selectImage(ctx.page.id, i.id);
          }}
        />
      ))}
    </div>
  );
}

/** The editor for the run being typed in, the reason for a run that cannot be edited, and the keyboard's targets. */
export function EditDomLayer({ ctx, c }: { ctx: PageContext; c: EditController }): ReactNode {
  useStore(c);
  const e = c.editing && c.editing.page === ctx.page.id ? c.editing : null;
  const ref = useRef<HTMLTextAreaElement>(null);
  const stacks = useStacks(c.options.fonts, e ? [c.looks(e.run, e.style).family] : []);
  const id = e?.run.id;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [id]);

  // The reason, for text that cannot be edited: under the pointer, or else what was clicked.
  const lockedRun = (t: { page: string; kind: string; id: string } | null) => {
    const r = c.active && t && t.page === ctx.page.id && t.kind === "run" ? c.run(ctx.page.id, t.id) : undefined;
    return r && !r.editable ? r : undefined;
  };
  const locked = lockedRun(c.hover) ?? lockedRun(c.selected);
  const tip =
    locked ? (
      <div className="pli-edit-tip" role="tooltip" id={`pli-edit-tip-${ctx.page.id}`} style={{ left: locked.box.x, top: locked.box.y + locked.box.h + 4 / ctx.scale, fontSize: 12 / ctx.scale, padding: `${3 / ctx.scale}px ${6 / ctx.scale}px`, maxWidth: 260 / ctx.scale }}>
        {locked.reason ?? "This text cannot be edited."}
      </div>
    ) : null;

  const targets = c.active && !c.readOnly ? <KeyboardTargets ctx={ctx} c={c} /> : null;
  if (!e)
    return (
      <>
        {targets}
        {tip}
      </>
    );
  const looks = c.looks(e.run, e.style);
  const frame = c.frame(e.run, e.style, textWidth(e.text, looks.size) + looks.size * 0.5);
  return (
    <>
      {targets}
      <textarea
        ref={ref}
        className="pli-edit-editor"
        aria-label="New text"
        rows={1}
        wrap="off"
        spellCheck
        value={e.text}
        data-run={e.run.id}
        style={{
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          transform: frame.transform,
          fontFamily: stacks(looks.family),
          fontSize: looks.size,
          lineHeight: `${frame.height}px`,
          fontWeight: looks.bold ? 700 : 400,
          fontStyle: looks.italic ? "italic" : "normal",
          color: looks.color,
        }}
        onChange={(ev) => c.setText(ev.currentTarget.value)}
        onBlur={() => void c.commit()}
        onKeyDown={(ev) => {
          // Keys typed here are text, not shortcuts.
          ev.stopPropagation();
          if (ev.key === "Escape") {
            ev.preventDefault();
            const [id, from] = [e.run.id, ev.currentTarget.closest(".pli-pdf")];
            c.cancel();
            requestAnimationFrame(() => refocus(from, id));
          } else if (ev.key === "Enter" && !ev.nativeEvent.isComposing) {
            ev.preventDefault();
            const [id, from] = [e.run.id, ev.currentTarget.closest(".pli-pdf")];
            void c.commit();
            requestAnimationFrame(() => refocus(from, id));
          }
        }}
      />
      {tip}
    </>
  );
}
