import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import type { FormField, Rect, Widget } from "@pli.dev/pdf";
import { HANDLES, resizeRect, type Handle } from "./annotGeometry";
import type { PageContext } from "./extensions";
import { FieldControl, widgetLabel } from "./FormControls";
import { useFormController, type FormController } from "./formController";
import { DRAG_PIXELS, MIN_FIELD, fieldLabel, moveRect, typeLabel } from "./formsGeometry";
import { screenToPage } from "./geometry";

/**
 * The form on a page, drawn through `pageOverlayDom`: a real HTML control for every widget, placed in page space. In
 * fill mode they are the controls (`FormControls`); in Prepare form mode each widget is a frame the person can select,
 * move (drag or arrow keys), resize (handles or Alt+arrows), duplicate and delete.
 */

const coarse = (): boolean => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

/** The marker and message that go with a widget in fill mode, and the control itself. */
function FillWidget({ c, ctx, field, widget, rect, stop }: { c: FormController; ctx: PageContext; field: FormField; widget: Widget; rect: Rect; stop: boolean }) {
  const id = useId();
  const [refused, setRefused] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const label = widgetLabel(field, widget);
  const disabled = ctx.readOnly || !!field.flags?.readOnly;
  const problem = c.invalid(field.id);
  const any = c.problems().get(field.id)?.[0];
  const text = refused ?? problem?.message ?? any?.message ?? "";
  const focused = c.focused === widget.id;
  const describedBy = text ? `${id}-msg` : undefined;

  // A widget that was off screen when Tab asked for it takes the focus now that it is drawn.
  useEffect(() => {
    if (c.pendingFocus === widget.id) {
      c.pendingFocus = null;
      (ref.current?.querySelector<HTMLElement>("[data-control]") ?? ref.current)?.focus();
    }
  });

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return;
    if (c.tab(widget.id, e.shiftKey ? -1 : 1)) e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className="pli-form-widget"
      data-widget-id={widget.id}
      data-field-id={field.id}
      data-type={field.type}
      data-required={field.flags?.required ? "" : undefined}
      data-readonly={disabled ? "" : undefined}
      data-invalid={problem || refused ? "" : undefined}
      data-focused={focused ? "" : undefined}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onKeyDown={onKeyDown}
      onFocus={() => c.setFocused(widget.id)}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setRefused(null);
        c.setFocused(null);
        c.leave(field.id);
      }}
    >
      <FieldControl c={c} field={field} widget={widget} label={label} describedBy={describedBy} invalid={!!(problem || refused)} disabled={disabled} stop={stop} onError={setRefused} />
      {field.flags?.required && <span className="pli-form-req" aria-hidden="true" />}
      {text && (
        <span id={`${id}-msg`} className="pli-pdf-sr">
          {text}
        </span>
      )}
      {focused && text && (
        <span className="pli-form-msg" aria-hidden="true" data-kind={problem || refused ? "invalid" : "hint"}>
          {text}
        </span>
      )}
    </div>
  );
}

// ---- Prepare form: frames --------------------------------------------------------------------------------------

type Gesture = { kind: "move"; start: [number, number]; rect: Rect; moved: boolean } | { kind: "resize"; handle: Handle; start: [number, number]; rect: Rect; moved: boolean };

function DesignWidget({ c, ctx, field, widget, rect, order }: { c: FormController; ctx: PageContext; field: FormField; widget: Widget; rect: Rect; order: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const selected = c.selectedIds.includes(widget.id);
  // Handles belong to one field: with several selected there are none.
  const handles = selected && c.also.length === 0;
  const px = 1 / ctx.scale;
  const label = `${widgetLabel(field, widget)}, ${typeLabel(field).toLowerCase()}`;
  const tiny = rect.w * ctx.scale < 60 || rect.h * ctx.scale < 36;
  const vis = (coarse() ? 24 : 12) * px;
  // Handles are 12 pixels on the screen (24 for a finger) with hit areas of 24 (44); on a tiny field the hit area is the handle itself so the areas do not cover each other.
  const hit = (tiny ? vis : (coarse() ? 44 : 24) * px);

  const toPage = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = ref.current?.closest<HTMLElement>(".pli-pdf-page")?.getBoundingClientRect();
    return screenToPage(ctx.frame, e.clientX - (box?.left ?? 0), e.clientY - (box?.top ?? 0));
  };
  const capture = (e: ReactPointerEvent, target: Element) => {
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {
      // a synthetic event has no pointer to capture
    }
  };
  const begin = (e: ReactPointerEvent<HTMLElement>, kind: "move" | { handle: Handle }) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (kind === "move" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      // Shift or Ctrl/Cmd click adds the field to the selection (or takes it out); it does not start a drag.
      c.toggleWidget(widget.id);
      // A field that was just taken out of the selection must not take it back by getting the focus.
      if (c.selectedIds.includes(widget.id)) ref.current?.focus({ preventScroll: true });
      return;
    }
    c.selectWidget(widget.id);
    ref.current?.focus({ preventScroll: true });
    capture(e, e.currentTarget);
    const start = toPage(e);
    gesture.current = kind === "move" ? { kind: "move", start, rect: widget.rect, moved: false } : { kind: "resize", handle: kind.handle, start, rect: widget.rect, moved: false };
  };
  const next = (e: ReactPointerEvent, g: Gesture): Rect => {
    const [x, y] = toPage(e);
    const dx = x - g.start[0];
    const dy = y - g.start[1];
    if (g.kind === "move") return moveRect(g.rect, dx, dy, { width: ctx.width, height: ctx.height }, { snap: !e.altKey });
    return resizeRect(g.rect, g.handle, dx, dy, { min: MIN_FIELD });
  };
  const move = (e: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const [x, y] = toPage(e);
    if (!g.moved && Math.hypot(x - g.start[0], y - g.start[1]) * ctx.scale < DRAG_PIXELS) return;
    g.moved = true;
    c.setPreview(widget.id, next(e, g));
  };
  const up = (e: ReactPointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.moved) return c.setPreview(widget.id, null);
    c.commitRect(widget.id, next(e, g), !e.altKey, g.kind === "resize");
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "Tab" && !mod && !e.altKey) {
      if (c.tab(widget.id, e.shiftKey ? -1 : 1)) e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      c.duplicate();
    } else if (e.key.startsWith("Arrow") && !mod) {
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      e.preventDefault();
      if (e.altKey) c.resizeBy(dx, dy);
      else c.nudge(dx, dy);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      c.removeSelected();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      c.selectWidget(widget.id);
    } else if (e.key === "Escape" && selected) {
      e.preventDefault();
      e.stopPropagation();
      c.selectWidget(null);
    }
  };

  const handlePos = (h: Handle): CSSProperties => {
    const x = h.includes("w") ? 0 : h.includes("e") ? rect.w : rect.w / 2;
    const y = h.includes("n") ? 0 : h.includes("s") ? rect.h : rect.h / 2;
    return { left: x - vis / 2, top: y - vis / 2, width: vis, height: vis, ["--hit" as string]: `${hit}px`, ["--vis" as string]: `${vis}px` };
  };
  const shown = tiny ? HANDLES.filter((h) => h.length === 2) : HANDLES;
  const stopLabel = order > 0 ? String(order) : "";

  useEffect(() => {
    if (c.pendingFocus === widget.id) {
      c.pendingFocus = null;
      ref.current?.focus();
    }
  });

  return (
    <div
      ref={ref}
      className="pli-form-design"
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      data-widget-id={widget.id}
      data-field-id={field.id}
      data-type={field.type}
      data-selected={selected ? "" : undefined}
      data-moving={c.preview.has(widget.id) ? "" : undefined}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, ["--px" as string]: px }}
      onPointerDown={(e) => begin(e, "move")}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onFocus={() => {
        if (!c.selectedIds.includes(widget.id)) c.selectWidget(widget.id);
      }}
      onKeyDown={onKeyDown}
    >
      <div className="pli-form-preview" inert>
        <FieldControl c={c} field={field} widget={widget} label={fieldLabel(field)} invalid={false} disabled preview stop={false} onError={() => {}} />
      </div>
      {(selected || c.showOrder) && (
        <span className="pli-form-tag" style={{ fontSize: 11 * px, padding: `${1 * px}px ${4 * px}px`, borderRadius: 3 * px, bottom: "100%", marginBottom: 2 * px }}>
          {field.name}
        </span>
      )}
      {c.showOrder && stopLabel && (
        <span className="pli-form-order" data-order={stopLabel} style={{ fontSize: 11 * px, minWidth: 16 * px, height: 16 * px, lineHeight: `${16 * px}px`, right: "100%", top: 0, marginRight: 2 * px }}>
          {stopLabel}
        </span>
      )}
      {handles &&
        shown.map((h) => (
          <span key={h} className="pli-form-handle" data-handle={h} style={handlePos(h)} onPointerDown={(e) => begin(e, { handle: h })} />
        ))}
    </div>
  );
}

// ---- The layer -------------------------------------------------------------------------------------------------

/** The form fields of one page. */
export function FormLayer({ ctx, c }: { ctx: PageContext; c: FormController }) {
  useFormController(c);
  const items = c.order().filter((o) => o.widget.page === ctx.page.id);
  if (items.length === 0) return null;
  const stopIds = c.stopIds();
  const rows: ReactElement[] = [];
  const seen = new Set<string>();
  for (const o of items) {
    const { field, widget } = o;
    if (c.designing) {
      const n = stopIds.indexOf(widget.id) + 1;
      rows.push(<DesignWidget key={widget.id} c={c} ctx={ctx} field={field} widget={widget} rect={c.rectOf(widget)} order={n} />);
      continue;
    }
    if (field.type === "radio") {
      if (seen.has(field.id)) continue;
      seen.add(field.id);
      const mine = items.filter((x) => x.field.id === field.id);
      const problem = c.invalid(field.id);
      rows.push(
        <div key={field.id} role="radiogroup" aria-label={fieldLabel(field)} aria-required={field.flags?.required || undefined} aria-invalid={problem ? true : undefined} style={{ display: "contents" }}>
          {mine.map((m) => (
            <FillWidget key={m.widget.id} c={c} ctx={ctx} field={m.field} widget={m.widget} rect={m.widget.rect} stop={stopIds.includes(m.widget.id)} />
          ))}
        </div>,
      );
      continue;
    }
    rows.push(<FillWidget key={widget.id} c={c} ctx={ctx} field={field} widget={widget} rect={widget.rect} stop />);
  }
  return (
    <div
      className="pli-form-layer"
      data-highlight={c.highlight ? "" : undefined}
      data-design={c.designing ? "" : undefined}
      data-order={c.showOrder ? "" : undefined}
      style={{ width: ctx.width, height: ctx.height, ["--px" as string]: 1 / ctx.scale }}
    >
      <Fragment>{rows}</Fragment>
    </div>
  );
}
