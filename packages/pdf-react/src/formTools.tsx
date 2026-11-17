import type { ReactNode } from "react";
import type { Rect } from "@pli.dev/pdf";
import type { PageContext, PdfTool } from "./extensions";
import { useFormController, type FormController } from "./formController";
import { KINDS, dragRect, kindInfo, placeRect, type FieldKind } from "./formsGeometry";
import { FormIcons as I } from "./formIcons";

/**
 * The tools that add fields: one `PdfTool` per kind, for `PliPdf`'s `tools`. They are hidden from the toolbar (the Prepare
 * form bar has its own buttons). Each turns a drag (or a click) on a page into a field through the controller; the radio
 * group takes a click for each button and ends with Enter, a double-click or the bar's button.
 */

export const FORM_TOOL_PREFIX = "form:";

export function createFormTools(c: FormController): PdfTool[] {
  return KINDS.map((k) => ({
    id: `${FORM_TOOL_PREFIX}${k.kind}`,
    label: k.label,
    icon: I[k.kind],
    needsEdit: true,
    hidden: true,
    cursor: "crosshair",
    hint: k.hint,
    onPointer(e) {
      if (c.readOnly || !c.designing) return;
      if (e.type === "down") {
        if (e.button !== 0 && e.button !== undefined) return;
        c.beginDraw(k.kind, e);
      } else if (e.type === "move") c.moveDraw(e);
      else c.endDraw(e);
    },
    onCancel() {
      c.cancelDraft();
    },
    overlay(ctx: PageContext): ReactNode {
      return <FormDraftOverlay c={c} ctx={ctx} kind={k.kind} />;
    },
  }));
}

const dash = (ctx: PageContext) => `${4 / ctx.scale} ${3 / ctx.scale}`;

/** The field being drawn and the radio buttons placed so far, as SVG in page space. */
function FormDraftOverlay({ c, ctx, kind }: { c: FormController; ctx: PageContext; kind: FieldKind }) {
  useFormController(c);
  const px = 1 / ctx.scale;
  const out: ReactNode[] = [];
  const box = (r: Rect, key: string, radio: boolean, solid = false) =>
    radio ? (
      <ellipse key={key} className="pli-form-draft" cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} strokeWidth={1.5 * px} strokeDasharray={solid ? undefined : dash(ctx)} />
    ) : (
      <rect key={key} className="pli-form-draft" x={r.x} y={r.y} width={r.w} height={r.h} strokeWidth={1.5 * px} strokeDasharray={solid ? undefined : dash(ctx)} />
    );
  c.radio?.points.forEach((p, i) => {
    if (p.page === ctx.page.id) out.push(box(p.rect, `r${i}`, true, true));
  });
  const d = c.draft;
  if (d && d.page === ctx.page.id) {
    const info = kindInfo(d.kind);
    const page = { width: ctx.width, height: ctx.height };
    const dragged = Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) * ctx.scale >= 4;
    const r = dragged ? dragRect(d.from, d.to, page) : placeRect(d.from, info.w, info.h, page);
    out.push(box(r, "draft", kind === "radio"));
  }
  return out.length ? <g className="pli-form-drafts">{out}</g> : null;
}
