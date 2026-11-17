import { memo, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { cssColor, layoutText, radialExtent, type Pose, type ResolvedElement, type ResolvedFill, type ResolvedLine, type ResolvedParagraph, type ResolvedRun, type ResolvedText, type Scene } from "@pli.dev/decks";
import { elementSubPaths, elementTextRect } from "./engine";
import { ChartView } from "./ChartView";
import { LINE_FACTOR, arrowShape, backgroundCss, cropBox, dashArray, fontStack, gradientVector, safeHref } from "./paint";

/** A match from find-and-replace to draw highlighted in the text. */
export interface TextHighlight {
  element: string;
  cell?: [number, number];
  paragraph: number;
  offset: number;
  length: number;
  current?: boolean;
  /** `comment`: words a comment thread is about (drawn in the comment colour; `thread` says which). */
  kind?: "find" | "comment";
  thread?: string;
}

export interface SlideViewProps {
  scene: Scene;
  /** Pixels per point. The slide is drawn `scene.width * scale` wide. Default 1. */
  scale?: number;
  /** Show "Click to add title" in empty placeholders (the editor does; thumbnails and presenting don't). */
  prompts?: boolean;
  /** Elements whose text an editor draws on top, so it isn't drawn twice. */
  hideText?: readonly string[];
  highlights?: readonly TextHighlight[];
  /** Make links in the slide followable (presenting). */
  links?: boolean;
  /**
   * Where animated elements are right now (presenting and the Motion panel's preview): each element in the map is drawn
   * hidden, faded, moved, turned, scaled or wiped as its pose says. Elements not in it, and slides without it, are drawn as they are.
   */
  poses?: ReadonlyMap<string, Pose>;
  className?: string;
  style?: CSSProperties;
  /** Accessible name of the slide. */
  label?: string;
  /** Drawn over the slide in pixels (selection handles and guides). */
  children?: ReactNode;
}

/**
 * Draws a `Scene` at any scale: background, then each element in order. It is a pure function of the scene (and the
 * few display options), so thumbnails, the canvas, presenting and the presenter view all use it.
 */
export const SlideView = memo(function SlideView({ scene, scale = 1, prompts = false, hideText, highlights, links = false, poses, className, style, label, children }: SlideViewProps) {
  const hidden = hideText && hideText.length ? new Set(hideText) : undefined;
  const bg = scene.background;
  return (
    <div
      className={className ? `pli-deck-slide ${className}` : "pli-deck-slide"}
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      data-scale={scale}
      style={{ width: scene.width * scale, height: scene.height * scale, ...style }}
    >
      <div className="pli-deck-page" style={{ background: backgroundCss(bg) }}>
        <div className="pli-deck-inner" style={{ width: scene.width, height: scene.height, transform: scale === 1 ? undefined : `scale(${scale})` }}>
          {bg.kind === "image" && <PictureFill fill={bg} w={scene.width} h={scene.height} />}
          {scene.elements.map((el) => (el.hidden ? null : <ElementView key={el.id} el={el} prompts={prompts} hidden={hidden} highlights={highlights} links={links} theme={scene.theme} poses={poses} />))}
        </div>
      </div>
      {children}
    </div>
  );
});

function PictureFill({ fill, w, h }: { fill: Extract<ResolvedFill, { kind: "image" }>; w: number; h: number }) {
  const b = cropBox(fill.crop, w, h);
  return <img className="pli-deck-bg-image" alt="" draggable={false} src={fill.src} style={{ left: b.x, top: b.y, width: b.w, height: b.h, opacity: fill.alpha }} />;
}

// ---- Elements ----------------------------------------------------------------------------------------------------

interface ElementViewProps {
  el: ResolvedElement;
  prompts: boolean;
  hidden: Set<string> | undefined;
  highlights: readonly TextHighlight[] | undefined;
  links: boolean;
  theme: Scene["theme"];
  /** Animation poses (top-level elements only: a group is animated as a whole). */
  poses?: ReadonlyMap<string, Pose>;
  /** Children of a group are placed relative to it. */
  origin?: { x: number; y: number };
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The part of an element a wipe shows, as a clip: it grows from the side it comes from. */
function wipeClip(from: "left" | "right" | "up" | "down", t: number): string {
  const rest = `${round3((1 - Math.min(1, Math.max(0, t))) * 100)}%`;
  switch (from) {
    case "left":
      return `inset(0 ${rest} 0 0)`;
    case "right":
      return `inset(0 0 0 ${rest})`;
    case "up":
      return `inset(0 0 ${rest} 0)`;
    default:
      return `inset(${rest} 0 0 0)`;
  }
}

function frameStyle(el: ResolvedElement, origin?: { x: number; y: number }, pose?: Pose): CSSProperties {
  const style: CSSProperties = { left: el.x - (origin?.x ?? 0), top: el.y - (origin?.y ?? 0), width: el.w, height: el.h };
  if (!pose) {
    if (el.rotation) style.transform = `rotate(${el.rotation}deg)`;
    return style;
  }
  // The pose moves the element on the slide, then turns and scales it about its centre (the CSS default origin), on top of its own rotation.
  const parts: string[] = [];
  if (pose.dx || pose.dy) parts.push(`translate(${round3(pose.dx)}px, ${round3(pose.dy)}px)`);
  if (el.rotation) parts.push(`rotate(${el.rotation}deg)`);
  if (pose.rotate) parts.push(`rotate(${round3(pose.rotate)}deg)`);
  if (pose.scale !== 1) parts.push(`scale(${round3(pose.scale)})`);
  if (parts.length) style.transform = parts.join(" ");
  if (pose.opacity < 1) style.opacity = round3(pose.opacity);
  if (pose.clip && pose.clip.t < 1) style.clipPath = wipeClip(pose.clip.from, pose.clip.t);
  return style;
}

function ElementView(props: ElementViewProps) {
  const { el, links } = props;
  const pose = props.origin ? undefined : props.poses?.get(el.id);
  if (pose && !pose.visible) return null;
  const href = links ? safeHref(el.link) : undefined;
  const label = el.alt || undefined;
  const common = {
    className: `pli-deck-el pli-deck-${el.kind}`,
    "data-element": el.id,
    "data-kind": el.kind,
    "data-from": el.from,
    ...(el.placeholder ? { "data-placeholder": el.placeholder.type } : {}),
    ...(label ? { role: "img", "aria-label": label } : {}),
    ...(pose ? { "data-animated": "" } : {}),
    style: frameStyle(el, props.origin, pose),
  };
  let body: ReactNode;
  if (el.kind === "shape") body = <ShapeView {...props} paragraphOpacity={pose?.paragraphs} />;
  else if (el.kind === "image") body = <ImageView el={el} label={label} />;
  else if (el.kind === "table") body = <TableView {...props} />;
  else if (el.kind === "chart") body = <ChartView el={el} theme={props.theme} />;
  else body = el.children?.map((c) => (c.hidden ? null : <ElementView key={c.id} {...props} el={c} origin={{ x: el.x, y: el.y }} />));
  return (
    <div {...common}>
      {body}
      {href && <a className="pli-deck-link" href={href} target={href.startsWith("#") ? undefined : "_blank"} rel="noopener noreferrer" aria-label={`Link to ${href}`} />}
    </div>
  );
}

function radialAttrs(center: { x: number; y: number }, w: number, h: number) {
  const { cx, cy, r } = radialExtent(center, w, h);
  return { cx, cy, r: Math.max(r, 0.01) };
}

function ShapeView({ el, prompts, hidden, highlights, theme, paragraphOpacity }: ElementViewProps & { paragraphOpacity?: Record<number, number> }) {
  const uid = useId().replace(/:/g, "");
  const { w, h } = el;
  const subs = elementSubPaths(el, w, h);
  const d = subs.map((s) => s.d).join(" ");
  const open = !el.custom && /^(line|straightConnector1|bentConnector\d|curvedConnector\d|arc|bracePair|bracketPair)$/i.test(el.geometry) || el.geometry === "line";
  const fill = open ? ({ kind: "none" } as const) : el.fill;
  const line = el.line;
  const flip = el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined;
  const shadow = el.shadow ? `drop-shadow(${el.shadow.dx}px ${el.shadow.dy}px ${el.shadow.blur}px ${cssColor(el.shadow.color, el.shadow.alpha)})` : undefined;

  const defs: ReactNode[] = [];
  let fillAttr: string | undefined = "none";
  let fillOpacity: number | undefined;
  let pictureLayer: ReactNode = null;
  if (fill.kind === "solid") {
    fillAttr = fill.color;
    fillOpacity = fill.alpha < 1 ? fill.alpha : undefined;
  } else if (fill.kind === "gradient") {
    const stops = fill.stops.map((s, i) => <stop key={i} offset={s.at} stopColor={s.color} stopOpacity={s.alpha} />);
    defs.push(
      fill.gradientKind === "radial" ? (
        fill.center ? (
          <radialGradient key="g" id={`${uid}g`} gradientUnits="userSpaceOnUse" {...radialAttrs(fill.center, w, h)}>{stops}</radialGradient>
        ) : (
          <radialGradient key="g" id={`${uid}g`} cx="0.5" cy="0.5" r="0.5">{stops}</radialGradient>
        )
      ) : (
        <linearGradient key="g" id={`${uid}g`} {...gradientVector(fill.angle)}>{stops}</linearGradient>
      ),
    );
    fillAttr = `url(#${uid}g)`;
  } else if (fill.kind === "image") {
    const b = cropBox(fill.crop, w, h);
    defs.push(<clipPath key="c" id={`${uid}c`}><path d={d} /></clipPath>);
    pictureLayer = (
      <g clipPath={`url(#${uid}c)`}>
        <image href={fill.src} x={b.x} y={b.y} width={b.w} height={b.h} preserveAspectRatio="none" opacity={fill.alpha < 1 ? fill.alpha : undefined} />
      </g>
    );
  }

  let stroke: string | undefined;
  let markerStart: string | undefined;
  let markerEnd: string | undefined;
  if (line) {
    stroke = line.color;
    const marker = (end: ResolvedLine["head"], key: string) => {
      const shape = arrowShape(end);
      if (!shape) return undefined;
      defs.push(
        <marker key={key} id={`${uid}${key}`} viewBox="0 0 10 10" refX={shape.refX} refY="5" markerWidth="4" markerHeight="4" markerUnits="strokeWidth" orient="auto-start-reverse" overflow="visible">
          <path d={shape.d} fill={shape.filled ? line.color : "none"} stroke={shape.filled ? "none" : line.color} strokeWidth={shape.filled ? 0 : 1.6} strokeLinecap="round" strokeLinejoin="round" />
        </marker>,
      );
      return `url(#${uid}${key})`;
    };
    markerStart = marker(line.head, "h");
    markerEnd = marker(line.tail, "t");
  }

  const rect = elementTextRect(el);
  const showPrompt = prompts && el.prompt && (!el.text || el.text.paragraphs.every((p) => p.runs.every((r) => r.text === "")));
  return (
    <>
      <svg className="pli-deck-svg" width={Math.max(w, 1)} height={Math.max(h, 1)} viewBox={`0 0 ${Math.max(w, 1)} ${Math.max(h, 1)}`} aria-hidden="true" focusable="false" style={{ transform: flip, filter: shadow }}>
        {defs.length > 0 && <defs>{defs}</defs>}
        {pictureLayer}
        {subs.map((sp, i) => (
          <path
            key={i}
            d={sp.d}
            fill={sp.fill ? fillAttr : "none"}
            fillRule={sp.evenOdd ? "evenodd" : undefined}
            fillOpacity={sp.fill ? fillOpacity : undefined}
            stroke={sp.stroke ? stroke : undefined}
            strokeOpacity={sp.stroke && line && line.alpha < 1 ? line.alpha : undefined}
            strokeWidth={sp.stroke ? line?.width : undefined}
            strokeDasharray={sp.stroke && line ? dashArray(line.dash, line.width) : undefined}
            strokeLinecap={line ? (line.cap === "flat" ? "butt" : line.cap) : undefined}
            strokeLinejoin={line ? (line.join === "miter" ? "miter" : line.join) : undefined}
            markerStart={sp.stroke && !sp.fill ? markerStart : undefined}
            markerEnd={sp.stroke && !sp.fill ? markerEnd : undefined}
            data-shade={sp.shade}
            style={sp.shade && sp.fill ? { filter: sp.shade.startsWith("lighten") ? `brightness(${sp.shade === "lighten" ? 1.3 : 1.15})` : `brightness(${sp.shade === "darken" ? 0.7 : 0.85})` } : undefined}
          />
        ))}
      </svg>
      {showPrompt && isPicturePlaceholder(el) && !hidden?.has(el.id) && (
        <div className="pli-deck-pic-prompt" data-prompt="" data-placeholder="pic">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M3.5 18l5-5 3.5 3.5 3-3 5.5 5" />
          </svg>
          <span>{el.prompt}</span>
        </div>
      )}
      {(el.text || showPrompt) && !hidden?.has(el.id) && !(showPrompt && isPicturePlaceholder(el)) && (
        <TextBlock
          text={el.text ?? EMPTY_TEXT}
          rect={rect}
          prompt={showPrompt ? el.prompt : undefined}
          promptFont={el.placeholder?.type === "title" || el.placeholder?.type === "ctrTitle" ? theme.fonts.major : theme.fonts.minor}
          upsideDown={el.flipV}
          element={el.id}
          highlights={highlights}
          linkColor={theme.colors.hlink}
          paragraphOpacity={paragraphOpacity}
        />
      )}
    </>
  );
}

/** An empty placeholder that takes a picture, not text. */
export function isPicturePlaceholder(el: ResolvedElement): boolean {
  return el.kind === "shape" && (el.placeholder?.type === "pic" || el.placeholder?.type === "clipArt");
}

const EMPTY_TEXT: ResolvedText = { paragraphs: [{ runs: [], level: 0, align: "left", marL: 0, indent: 0, bullet: null, spaceBefore: 0, spaceAfter: 0, lineSpacing: 1, rtl: false, endSize: 18 }], vAlign: "top", insets: { l: 7.2, t: 3.6, r: 7.2, b: 3.6 }, wrap: true, autofit: "none" };

function ImageView({ el, label }: { el: ResolvedElement; label: string | undefined }) {
  const { w, h } = el;
  const b = cropBox(el.crop, w, h);
  const masked = !!el.custom || (el.geometry !== "rect" && el.geometry !== "");
  const subs = masked ? elementSubPaths(el, w, h) : [];
  const d = subs.map((s) => s.d).join(" ");
  const evenOdd = subs.some((s) => s.evenOdd);
  const shadow = el.shadow ? `drop-shadow(${el.shadow.dx}px ${el.shadow.dy}px ${el.shadow.blur}px ${cssColor(el.shadow.color, el.shadow.alpha)})` : undefined;
  const flip = el.flipH || el.flipV ? `scale(${el.flipH ? -1 : 1}, ${el.flipV ? -1 : 1})` : undefined;
  return (
    <div className="pli-deck-image-shadow" style={{ filter: shadow }}>
      <div className="pli-deck-image-clip" style={{ clipPath: masked ? `path(${evenOdd ? "evenodd, " : ""}'${d}')` : undefined, transform: flip }}>
        <img className="pli-deck-image" src={el.src} alt={label ?? ""} draggable={false} style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
      </div>
      {el.line && (
        <svg className="pli-deck-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
          <path d={d || `M0 0H${w}V${h}H0Z`} fill="none" stroke={el.line.color} strokeOpacity={el.line.alpha < 1 ? el.line.alpha : undefined} strokeWidth={el.line.width} strokeDasharray={dashArray(el.line.dash, el.line.width)} />
        </svg>
      )}
    </div>
  );
}

function TableView({ el, prompts, hidden, highlights, theme }: ElementViewProps) {
  const t = el.table;
  if (!t) return null;
  void prompts;
  return (
    <div className="pli-deck-table" role="table" aria-label={el.alt || undefined}>
      {t.rows.map((row, ri) => (
        <div key={ri} role="row" className="pli-deck-row" style={{ display: "contents" }}>
          {row.cells.map((cell, ci) => {
            if (cell.covered) return null;
            const side = (l: ResolvedLine | null) => (l ? `${l.width}px ${l.dash === "solid" ? "solid" : l.dash.includes("ot") ? "dotted" : "dashed"} ${cssColor(l.color, l.alpha)}` : "0 solid transparent");
            return (
              <div
                key={ci}
                role={ri === 0 && el.source.type === "table" && el.source.headerRow ? "columnheader" : "cell"}
                className="pli-deck-cell"
                data-row={ri}
                data-col={ci}
                style={{
                  left: cell.x,
                  top: cell.y,
                  width: cell.w,
                  height: cell.h,
                  background: backgroundCss(cell.fill),
                  borderTop: side(cell.borders.top),
                  borderRight: side(cell.borders.right),
                  borderBottom: side(cell.borders.bottom),
                  borderLeft: side(cell.borders.left),
                }}
              >
                {!hidden?.has(`${el.id}:${ri}:${ci}`) && (
                  <TextBlock text={cell.text} rect={{ x: 0, y: 0, w: cell.w, h: cell.h }} element={el.id} cell={[ri, ci]} highlights={highlights} linkColor={theme.colors.hlink} />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---- Text --------------------------------------------------------------------------------------------------------

export interface TextBlockProps {
  text: ResolvedText;
  /** The box the text goes in (inside the element). */
  rect: { x: number; y: number; w: number; h: number };
  prompt?: string;
  promptFont?: string;
  upsideDown?: boolean;
  element: string;
  cell?: [number, number];
  highlights?: readonly TextHighlight[];
  linkColor?: string;
  /** Text built by paragraph while presenting: how much of each paragraph (by index) shows, 0 to 1. Missing paragraphs are fully shown. */
  paragraphOpacity?: Record<number, number>;
  /** Marks the text as the one being edited (the editor makes it editable). */
  editable?: boolean;
  /** Called with the element that holds the paragraphs. */
  bodyRef?: (el: HTMLDivElement | null) => void;
}

const VALIGN = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;

/** Text as HTML: paragraphs of runs, with bullets hanging in the indent. Offsets are in `data-p` and `data-o` for editors. */
export function TextBlock({ text, rect, prompt, promptFont, upsideDown, element, cell, highlights, linkColor, paragraphOpacity, editable, bodyRef }: TextBlockProps) {
  const bodyEl = useRef<HTMLDivElement | null>(null);
  // "Shrink text on overflow": the engine's layout picks the scale (the same one the PDF and PowerPoint files use).
  const fit = text.autofit === "shrink" && text.paragraphs.length > 0 ? layoutText(text, rect.w, rect.h) : null;
  const own = highlights?.filter((hl) => hl.element === element && (cell ? hl.cell?.[0] === cell[0] && hl.cell?.[1] === cell[1] : !hl.cell));
  const { insets } = text;
  return (
    <div
      className="pli-deck-text"
      data-text-of={element}
      data-autofit={text.autofit}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        padding: `${insets.t}px ${insets.r}px ${insets.b}px ${insets.l}px`,
        justifyContent: VALIGN[text.vAlign],
        transform: upsideDown ? "rotate(180deg)" : undefined,
        ...(fit && fit.scale < 1 ? ({ "--pli-fit": fit.scale, "--pli-ls": 1 - fit.lineSpacingReduction } as CSSProperties) : null),
      }}
    >
      <div
        ref={(n) => {
          bodyEl.current = n;
          bodyRef?.(n);
        }}
        className="pli-deck-text-body"
        data-editable={editable ? "" : undefined}
        style={{ whiteSpace: text.wrap ? "pre-wrap" : "pre", width: text.wrap ? "100%" : undefined }}
      >
        {text.paragraphs.map((p, pi) => (
          <ParagraphView key={pi} p={p} index={pi} prompt={prompt && pi === 0 ? prompt : undefined} promptFont={promptFont} highlights={own?.filter((hl) => hl.paragraph === pi)} linkColor={linkColor} opacity={paragraphOpacity?.[pi]} />
        ))}
      </div>
    </div>
  );
}

const BREAK = " ";

function ParagraphView({ p, index, prompt, promptFont, highlights, linkColor, opacity }: { p: ResolvedParagraph; index: number; prompt?: string; promptFont?: string; highlights?: readonly TextHighlight[]; linkColor?: string; opacity?: number }) {
  const first = p.runs.find((r) => r.text !== "") ?? p.runs[0];
  const bulletSize = first ? first.fontSize : p.endSize;
  const hang = p.indent < 0 ? -p.indent : Math.max(p.indent, bulletSize * 0.8);
  const style: CSSProperties = {
    textAlign: p.align,
    paddingLeft: p.rtl ? undefined : p.marL,
    paddingRight: p.rtl ? p.marL : undefined,
    marginTop: p.spaceBefore || undefined,
    marginBottom: p.spaceAfter || undefined,
    lineHeight: `calc(${p.lineSpacing * LINE_FACTOR} * var(--pli-ls, 1))`,
    fontSize: `calc(${first ? first.fontSize : p.endSize}px * var(--pli-fit, 1))`,
    direction: p.rtl ? "rtl" : undefined,
    textIndent: p.bullet ? undefined : p.indent || undefined,
    opacity: opacity !== undefined && opacity < 1 ? round3(Math.max(0, opacity)) : undefined,
  };
  const empty = p.runs.every((r) => r.text === "");
  return (
    <div className="pli-deck-p" data-p={index} data-level={p.level} style={style}>
      {p.bullet && (
        <span
          className="pli-deck-bullet"
          contentEditable={false}
          aria-hidden="true"
          style={{
            width: hang,
            marginLeft: p.indent < 0 ? p.indent : 0,
            color: p.bullet.color,
            fontSize: `calc(${bulletSize * (p.bullet.size / 100)}px * var(--pli-fit, 1))`,
            fontFamily: p.bullet.fontFamily ? fontStack(p.bullet.fontFamily) : first ? fontStack(first.fontFamily) : undefined,
          }}
        >
          {p.bullet.label}
        </span>
      )}
      <span className="pli-deck-runs" data-runs="">
        {empty && prompt ? (
          <span className="pli-deck-prompt" data-prompt="" style={{ fontFamily: promptFont ? fontStack(promptFont) : undefined }}>{prompt}</span>
        ) : (
          p.runs.map((r, ri) => <RunView key={ri} run={r} start={offsetOf(p.runs, ri)} highlights={highlights} linkColor={linkColor} />)
        )}
        {empty && !prompt && <br />}
      </span>
    </div>
  );
}

function offsetOf(runs: ResolvedRun[], index: number): number {
  let n = 0;
  for (let i = 0; i < index; i++) n += runs[i]!.text.length;
  return n;
}

function RunView({ run, start, highlights, linkColor }: { run: ResolvedRun; start: number; highlights?: readonly TextHighlight[]; linkColor?: string }) {
  if (run.text === "") return null;
  const href = safeHref(run.link);
  const raised = run.baseline !== 0;
  const decorations = [run.underline || href ? "underline" : "", run.strike ? "line-through" : ""].filter(Boolean).join(" ");
  const size = raised ? run.fontSize * 0.7 : run.fontSize;
  const style: CSSProperties = {
    fontFamily: fontStack(run.fontFamily),
    fontSize: `calc(${size}px * var(--pli-fit, 1))`,
    fontWeight: run.bold ? 700 : undefined,
    fontStyle: run.italic ? "italic" : undefined,
    textDecoration: decorations || undefined,
    color: href && linkColor ? linkColor : cssColor(run.color, run.alpha),
    background: run.highlight,
    letterSpacing: run.letterSpacing ? `${run.letterSpacing}px` : undefined,
    textTransform: run.allCaps ? "uppercase" : undefined,
    fontVariant: run.smallCaps ? "small-caps" : undefined,
    position: raised ? "relative" : undefined,
    top: raised ? `${-(run.baseline / 100) * run.fontSize}px` : undefined,
  };
  const pieces = highlightPieces(run.text, start, highlights);
  const content = pieces.map((piece, i) => (piece.mark ? <mark key={i} className={piece.comment !== undefined ? (piece.current ? "pli-deck-comment-hl pli-deck-comment-hl-active" : "pli-deck-comment-hl") : piece.current ? "pli-deck-find pli-deck-find-current" : "pli-deck-find"} data-thread={piece.comment}>{piece.text}</mark> : piece.text));
  const attrs = { className: "pli-deck-run", "data-o": start, style, ...(run.field ? { "data-field": run.field } : {}) };
  return href ? (
    <a {...attrs} href={href} data-link={href} onClick={(e) => e.preventDefault()}>{content}</a>
  ) : (
    <span {...attrs}>{content}</span>
  );
}

interface Piece {
  text: string;
  mark?: boolean;
  current?: boolean;
  comment?: string;
}

function highlightPieces(text: string, start: number, highlights: readonly TextHighlight[] | undefined): Piece[] {
  if (!highlights || highlights.length === 0) return [{ text: text.replaceAll(BREAK, BREAK) }];
  const cuts: Piece[] = [];
  let at = 0;
  const sorted = [...highlights].sort((a, b) => a.offset - b.offset);
  for (const hl of sorted) {
    const a = Math.max(hl.offset - start, at);
    const b = Math.min(hl.offset + hl.length - start, text.length);
    if (b <= a) continue;
    if (a > at) cuts.push({ text: text.slice(at, a) });
    cuts.push({ text: text.slice(a, b), mark: true, current: hl.current, comment: hl.kind === "comment" ? (hl.thread ?? "") : undefined });
    at = b;
  }
  if (at < text.length) cuts.push({ text: text.slice(at) });
  return cuts;
}
