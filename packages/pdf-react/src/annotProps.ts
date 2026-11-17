import type { Annotation, LineEnd, StrokeStyle, TextStyle } from "@pli.dev/pdf";

/**
 * Reading and changing the look of an annotation without knowing its type: the properties panel, the compact bar and the tool
 * styles all go through these. Each `with...` returns the patch to apply (`undefined` values remove a key).
 */

export interface Supports {
  color: boolean;
  fill: boolean;
  width: boolean;
  dash: boolean;
  ends: boolean;
  text: boolean;
  opacity: boolean;
  icon: boolean;
  overlay: boolean;
  uri: boolean;
}

export function supports(a: Annotation): Supports {
  const none: Supports = { color: false, fill: false, width: false, dash: false, ends: false, text: false, opacity: true, icon: false, overlay: false, uri: false };
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
      return { ...none, color: true };
    case "ink":
      return { ...none, color: true, width: true, dash: true };
    case "square":
    case "circle":
    case "polygon":
      return { ...none, color: true, fill: true, width: true, dash: true };
    case "polyline":
      return { ...none, color: true, width: true, dash: true };
    case "line":
      return { ...none, color: true, width: true, dash: true, ends: true };
    case "freetext":
      return { ...none, color: true, fill: true, width: true, dash: true, text: true };
    case "note":
      return { ...none, color: true, icon: true };
    case "stamp":
      return { ...none, color: !("picture" in a.stamp) };
    case "signature":
      return { ...none, color: a.mode !== "image", width: a.mode === "draw" };
    case "redact":
      return { ...none, fill: true, overlay: true, opacity: false };
    case "link":
      return { ...none, uri: true, opacity: false };
    case "image":
      return none;
  }
}

export function colorOf(a: Annotation): string | undefined {
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "note":
    case "signature":
      return a.color;
    case "freetext":
      return a.style.color;
    case "stamp":
      return "picture" in a.stamp ? undefined : a.stamp.color;
    case "redact":
      return a.fill;
    default:
      return "stroke" in a ? a.stroke.color : undefined;
  }
}

export function withColor(a: Annotation, color: string): Partial<Annotation> {
  switch (a.type) {
    case "highlight":
    case "underline":
    case "strikeout":
    case "squiggly":
    case "note":
    case "signature":
      return { color } as Partial<Annotation>;
    case "freetext":
      return { style: { ...a.style, color }, ...(a.stroke ? { stroke: { ...a.stroke, color } } : {}) } as Partial<Annotation>;
    case "stamp":
      return "picture" in a.stamp ? {} : ({ stamp: { ...a.stamp, color } } as Partial<Annotation>);
    case "redact":
      return { fill: color } as Partial<Annotation>;
    default:
      return "stroke" in a ? ({ stroke: { ...a.stroke, color } } as Partial<Annotation>) : {};
  }
}

export function fillOf(a: Annotation): string | undefined {
  if (a.type === "square" || a.type === "circle" || a.type === "polygon" || a.type === "freetext" || a.type === "redact") return a.fill;
  return undefined;
}

export const withFill = (fill: string | undefined): Partial<Annotation> => ({ fill }) as Partial<Annotation>;

export function strokeOf(a: Annotation): StrokeStyle | undefined {
  if ("stroke" in a) return a.stroke;
  return undefined;
}

export function widthOf(a: Annotation): number | undefined {
  if (a.type === "signature") return a.width ?? 2;
  return strokeOf(a)?.width;
}

export function withWidth(a: Annotation, width: number): Partial<Annotation> {
  if (a.type === "signature") return { width } as Partial<Annotation>;
  if (a.type === "freetext") return { stroke: width > 0 ? { color: a.stroke?.color ?? a.style.color, ...a.stroke, width } : undefined } as Partial<Annotation>;
  const s = strokeOf(a);
  return s ? ({ stroke: { ...s, width } } as Partial<Annotation>) : {};
}

export function withDash(a: Annotation, dash: number[] | undefined): Partial<Annotation> {
  const s = strokeOf(a);
  if (!s) return {};
  const { dash: _old, ...rest } = s;
  return { stroke: dash ? { ...rest, dash } : rest } as Partial<Annotation>;
}

export function withEnds(a: Annotation, ends: { startEnd?: LineEnd; endEnd?: LineEnd }): Partial<Annotation> {
  if (a.type !== "line") return {};
  const out: Record<string, LineEnd | undefined> = {};
  if ("startEnd" in ends) out.startEnd = ends.startEnd === "none" ? undefined : ends.startEnd;
  if ("endEnd" in ends) out.endEnd = ends.endEnd === "none" ? undefined : ends.endEnd;
  return out as Partial<Annotation>;
}

export function textOf(a: Annotation): TextStyle | undefined {
  return a.type === "freetext" ? a.style : undefined;
}

export function withText(a: Annotation, patch: Partial<TextStyle>): Partial<Annotation> {
  if (a.type !== "freetext") return {};
  const style: Record<string, unknown> = { ...a.style, ...patch };
  for (const k of Object.keys(style)) if (style[k] === undefined || style[k] === false) delete style[k];
  return { style } as Partial<Annotation>;
}
