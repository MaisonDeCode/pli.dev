import { useId, type ReactNode } from "react";
import { keepFocus } from "@pli.dev/react";
import type { Annotation, LineEnd } from "@pli.dev/pdf";
import { NOTE_ICONS } from "./annotSvg";
import { AnnotIcons as I } from "./annotIcons";
import { canMove } from "./annotGeometry";
import { describeType, type AnnotController, type ToolId } from "./annotController";
import { colorOf, fillOf, strokeOf, supports, widthOf, withColor, withDash, withEnds, withFill, withWidth, type Supports } from "./annotProps";
import { DASHES, LINE_ENDS, SWATCHES, dashId, type StyleKey, type ToolStyle } from "./annotStyles";
import { useController } from "./annotUi";
import { Arrange } from "./Arrange";
import { TOOL_INFO } from "./annotTools";

/**
 * The properties of what is selected (colour, opacity, line width and style, line ends, text, lock, author, order, comment),
 * or, when nothing is selected and a drawing tool is active, of what that tool draws next. Changes to a selection are undo
 * steps (sliding or typing counts as one); changes to a tool are remembered in the browser.
 */

const TOOL_STYLE: Partial<Record<ToolId, StyleKey>> = {
  highlight: "highlight",
  underline: "underline",
  strikeout: "strikeout",
  squiggly: "squiggly",
  ink: "ink",
  rectangle: "rectangle",
  ellipse: "ellipse",
  line: "line",
  arrow: "arrow",
  polyline: "polyline",
  polygon: "polygon",
  text: "text",
  note: "note",
  redact: "redact",
};

/** What a tool's style makes available: the same fields an annotation of that kind has. */
function supportsStyle(key: StyleKey): Supports {
  const none: Supports = { color: true, fill: false, width: false, dash: false, ends: false, text: false, opacity: true, icon: false, overlay: false, uri: false };
  switch (key) {
    case "ink":
    case "polyline":
      return { ...none, width: true, dash: true };
    case "rectangle":
    case "ellipse":
    case "polygon":
      return { ...none, fill: true, width: true, dash: true };
    case "line":
    case "arrow":
      return { ...none, width: true, dash: true, ends: true };
    case "text":
      return { ...none, fill: true, width: true, dash: true, text: true };
    case "note":
      return { ...none, icon: true };
    case "redact":
      return { ...none, color: false, fill: true, opacity: false };
    default:
      return none;
  }
}

function Field({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? "pli-pdf-field pli-pdf-field-inline" : "pli-pdf-field"}>
      <span className="pli-pdf-field-label">{label}</span>
      {children}
    </div>
  );
}

function Swatches({ label, value, onChange, none }: { label: string; value: string | undefined; onChange: (color: string | undefined) => void; none?: boolean }) {
  const custom = value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#4f46e5";
  return (
    <div className="pli-pdf-swatches" role="group" aria-label={label}>
      {none && (
        <button type="button" className="pli-swatch pli-swatch-none" aria-label={`${label}: none`} aria-pressed={value === undefined} title="None" onMouseDown={keepFocus} onClick={() => onChange(undefined)} />
      )}
      {SWATCHES.map((color) => (
        <button key={color} type="button" className="pli-swatch" style={{ background: color }} aria-label={`${label} ${color}`} title={color} aria-pressed={value?.toLowerCase() === color} onMouseDown={keepFocus} onClick={() => onChange(color)} />
      ))}
      <input type="color" className="pli-pdf-colorinput" aria-label={`${label}: custom colour`} value={custom} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * What the panel would show now, as one string for the viewer (`rightPanelKey`): the selected annotations, or nothing. While a
 * drawing tool is on the panel is about the tool's next stroke, which does not open it by itself (it would cover the page
 * the person is about to draw on): it is there when the Properties button is pressed.
 */
export function propertiesKey(c: AnnotController): string | null {
  if (c.toolId && c.toolId !== "select" && TOOL_STYLE[c.toolId as ToolId]) return null;
  const ids = c.selected.map((a) => a.id);
  return ids.length ? `annot:${ids.join(",")}` : null;
}

export function PropertiesPanel({ c }: { c: AnnotController }) {
  useController(c);
  const id = useId();
  // With a drawing tool active the panel is about what the tool draws next; otherwise about what is selected.
  const styleKey = c.toolId && c.toolId !== "select" ? TOOL_STYLE[c.toolId as ToolId] : undefined;
  const selected = styleKey ? [] : c.selected;
  const viewOnly = c.readOnly;

  if (selected.length === 0 && !styleKey) {
    const total = c.session.doc.pages.reduce((n, p) => n + p.annots.length, 0);
    return (
      <section className="pli-pdf-props" aria-label="Annotation properties" data-mode="empty">
        <h2 className="pli-pdf-props-title">Nothing selected</h2>
        <p className="pli-comments-note">Select an annotation to change it, or choose a tool to set how it draws.</p>
        <p className="pli-pdf-meta" data-summary="">
          {total === 0 ? "No annotations in this document yet." : `${total} ${total === 1 ? "annotation" : "annotations"} in this document.`}
        </p>
      </section>
    );
  }

  // ---- what is shown, and how a change is applied -------------------------------------------------------------------
  const first = selected[0];
  const mode: "annots" | "style" = selected.length > 0 ? "annots" : "style";
  const style: ToolStyle | undefined = styleKey ? c.style(styleKey) : undefined;
  const sup: Supports =
    mode === "style"
      ? supportsStyle(styleKey!)
      : (Object.fromEntries(Object.keys(supports(first!)).map((k) => [k, selected.every((a) => supports(a)[k as keyof Supports])])) as unknown as Supports);
  const same = <T,>(get: (a: Annotation) => T | undefined): T | undefined | "mixed" => {
    const values = selected.map(get);
    return values.every((v) => JSON.stringify(v) === JSON.stringify(values[0])) ? values[0] : "mixed";
  };
  const apply = (patch: (a: Annotation) => Partial<Annotation>, key: string) => c.patch(selected.map((a) => a.id), patch, key);

  const color = mode === "style" ? style!.color : same(colorOf);
  const fill = mode === "style" ? style!.fill : same(fillOf);
  const opacity = mode === "style" ? (style!.opacity ?? 1) : same((a) => a.opacity ?? 1);
  const width = mode === "style" ? style!.width : same(widthOf);
  const dash = mode === "style" ? style!.dash : same((a) => strokeOf(a)?.dash);
  const lineStart = mode === "style" ? (style!.startEnd ?? "none") : same((a) => (a.type === "line" ? (a.startEnd ?? "none") : undefined));
  const lineEnd = mode === "style" ? (style!.endEnd ?? "none") : same((a) => (a.type === "line" ? (a.endEnd ?? "none") : undefined));
  const icon = mode === "style" ? (style!.icon ?? "comment") : same((a) => (a.type === "note" ? (a.icon ?? "comment") : undefined));

  const setStyle = (patch: Partial<ToolStyle>) => c.setStyle(styleKey!, patch);
  const onColor = (v: string | undefined) => v && (mode === "style" ? setStyle({ color: v }) : apply((a) => withColor(a, v), "color"));
  const onFill = (v: string | undefined) => (mode === "style" ? setStyle({ fill: v }) : apply((a) => (supports(a).fill ? withFill(v) : {}), "fill"));
  const onOpacity = (v: number) => (mode === "style" ? setStyle({ opacity: v >= 1 ? undefined : v }) : apply(() => ({ opacity: v >= 1 ? undefined : v }) as Partial<Annotation>, "opacity"));
  const onWidth = (v: number) => (mode === "style" ? setStyle({ width: v }) : apply((a) => withWidth(a, v), "width"));
  const onDash = (idv: string) => {
    const d = DASHES.find((x) => x.id === idv)?.dash;
    if (mode === "style") setStyle({ dash: d });
    else apply((a) => withDash(a, d), "dash");
  };
  const onEnds = (which: "startEnd" | "endEnd", v: LineEnd) => (mode === "style" ? setStyle({ [which]: v }) : apply((a) => withEnds(a, { [which]: v }), which));

  const single = selected.length === 1 ? first : undefined;
  const locked = selected.length > 0 && selected.every((a) => a.locked);
  const title = mode === "style" ? `${TOOL_INFO[c.toolId as ToolId]?.label ?? ""} tool` : selected.length === 1 ? describeType(first!.type) : `${selected.length} annotations`;
  const movable = selected.some(canMove);
  const asDash = dash === "mixed" ? "" : dashId(dash as number[] | undefined);

  return (
    <section className="pli-pdf-props" aria-label="Annotation properties" data-mode={mode}>
      <h2 className="pli-pdf-props-title">{title}</h2>
      {sup.color && (
        <Field label="Colour">
          <Swatches label="Colour" value={color === "mixed" ? undefined : color} onChange={onColor} />
        </Field>
      )}
      {sup.fill && (
        <Field label="Fill">
          <Swatches label="Fill" value={fill === "mixed" ? undefined : fill} onChange={onFill} none />
        </Field>
      )}
      {sup.opacity && (
        <Field label="Opacity" inline>
          <input type="range" min={5} max={100} step={5} aria-label="Opacity" value={Math.round((opacity === "mixed" ? 1 : (opacity ?? 1)) * 100)} onChange={(e) => onOpacity(Number(e.target.value) / 100)} />
          <output>{opacity === "mixed" ? "Mixed" : `${Math.round((opacity ?? 1) * 100)}%`}</output>
        </Field>
      )}
      {sup.width && (
        <Field label="Line width" inline>
          <input type="number" min={0} max={40} step={0.5} aria-label="Line width" value={width === "mixed" ? "" : (width ?? 1)} placeholder={width === "mixed" ? "Mixed" : undefined} onChange={(e) => e.target.value !== "" && onWidth(Math.max(0, Math.min(40, Number(e.target.value))))} />
          <span>pt</span>
        </Field>
      )}
      {sup.dash && (
        <Field label="Line style" inline>
          <select aria-label="Line style" value={asDash} onChange={(e) => onDash(e.target.value)}>
            {asDash === "" && <option value="">Mixed</option>}
            {DASHES.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {sup.ends && (
        <>
          <Field label="Start of line" inline>
            <select aria-label="Start of line" value={lineStart === "mixed" ? "" : (lineStart ?? "none")} onChange={(e) => onEnds("startEnd", e.target.value as LineEnd)}>
              {lineStart === "mixed" && <option value="">Mixed</option>}
              {LINE_ENDS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="End of line" inline>
            <select aria-label="End of line" value={lineEnd === "mixed" ? "" : (lineEnd ?? "none")} onChange={(e) => onEnds("endEnd", e.target.value as LineEnd)}>
              {lineEnd === "mixed" && <option value="">Mixed</option>}
              {LINE_ENDS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </Field>
        </>
      )}
      {sup.icon && (
        <Field label="Icon" inline>
          <select aria-label="Note icon" value={icon === "mixed" ? "" : (icon ?? "comment")} onChange={(e) => (mode === "style" ? setStyle({ icon: e.target.value as ToolStyle["icon"] }) : apply(() => ({ icon: e.target.value }) as Partial<Annotation>, "icon"))}>
            {NOTE_ICONS.map((x) => (
              <option key={x} value={x}>
                {x[0]!.toUpperCase() + x.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {sup.text && (
        <p className="pli-comments-note" data-text-note="">
          Font, size, style, colours and alignment of the text are in the text bar above the pages.
        </p>
      )}
      {sup.overlay && single?.type === "redact" && (
        <Field label="Text over the box">
          <input type="text" aria-label="Text over the box" value={single.overlay ?? ""} placeholder="For example REDACTED" onChange={(e) => apply(() => ({ overlay: e.target.value || undefined }) as Partial<Annotation>, "overlay")} />
        </Field>
      )}
      {single?.type === "link" && (
        <Field label="Link">
          <button type="button" className="pli-button" onClick={() => (c.popover = { kind: "link", annot: single.id, page: c.pageOf(single.id)!, rect: single.rect }, c.emit())}>
            {single.uri ? single.uri : single.dest ? `Page ${c.session.doc.pages.findIndex((p) => p.id === single.dest!.page) + 1}` : "Set the link"}
          </button>
        </Field>
      )}

      {mode === "annots" && !viewOnly && selected.filter(canMove).length >= 2 && <Arrange count={c.arrangeable().length} onAlign={(how) => c.align(how)} onDistribute={(how) => c.distribute(how)} />}
      {mode === "annots" && (
        <>
          {single && (
            <p className="pli-pdf-meta" id={`${id}-meta`}>
              {single.authorName || single.author ? <span>{single.authorName ?? c.users.get(single.author!).name}</span> : null}
              {(single.modified ?? single.created) ? <time dateTime={new Date((single.modified ?? single.created)!).toISOString()}>{new Date((single.modified ?? single.created)!).toLocaleString()}</time> : null}
            </p>
          )}
          <div className="pli-pdf-actions" role="group" aria-label="Actions">
            <label className="pli-pdf-check">
              <input type="checkbox" aria-label="Locked" checked={locked} onChange={(e) => c.setLocked(selected.map((a) => a.id), e.target.checked)} /> Locked
            </label>
            {single && !viewOnly && (
              <button type="button" className="pli-button" onClick={() => c.openComment(single.id)}>
                {I.comment} {single.thread || single.contents ? "Open comment" : "Add comment"}
              </button>
            )}
            <button type="button" className="pli-button" disabled={!movable} onClick={() => c.reorder("forward")}>
              {I.front} Bring forward
            </button>
            <button type="button" className="pli-button" disabled={!movable} onClick={() => c.reorder("backward")}>
              {I.back} Send backward
            </button>
            <button type="button" className="pli-button" onClick={() => c.duplicate()}>
              {I.copy} Duplicate
            </button>
            <button type="button" className="pli-button pli-button-danger" disabled={locked} onClick={() => c.deleteSelected()}>
              {I.trash} Delete
            </button>
          </div>
        </>
      )}
      {mode === "style" && styleKey && (
        <Field label="After drawing" inline>
          <label className="pli-pdf-check">
            <input type="checkbox" aria-label="Keep this tool selected" checked={!!style!.sticky} onChange={(e) => setStyle({ sticky: e.target.checked })} /> Keep this tool selected
          </label>
        </Field>
      )}
    </section>
  );
}
