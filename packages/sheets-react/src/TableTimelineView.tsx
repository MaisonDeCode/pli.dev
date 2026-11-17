import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { TIMELINE_LEVELS, type Timeline, type TimelineLevel, type TimelinePeriod } from "@pli.dev/sheets";

/** What a timeline draws: the periods of its column's dates and the range that is picked (from `SheetSession#timelineInfo`). */
export interface TimelineData {
  level: TimelineLevel;
  periods: (TimelinePeriod & { count: number; selected: boolean })[];
  selection: { start: number; end: number } | null;
}

export const TIMELINE_HEADER = 30;
const PARENT_H = 18;
const STRIP_H = 34;
const TRACK_H = 12;
const PAD = 8;
const HANDLE = 8;
const GRIP = 14;

/** How wide a period is drawn at each level. */
export const PERIOD_WIDTH: Record<TimelineLevel, number> = { years: 72, quarters: 56, months: 48, days: 30 };
const LEVEL_WORDS: Record<TimelineLevel, string> = { years: "YEARS", quarters: "QUARTERS", months: "MONTHS", days: "DAYS" };
export const timelineLevelWord = (level: TimelineLevel) => LEVEL_WORDS[level];

/** The size of the strip's window and of everything laid in it, in the timeline's own pixels. */
export function tableTimelineLayout(level: TimelineLevel, count: number, width: number) {
  const pw = PERIOD_WIDTH[level];
  const viewW = Math.max(0, width - PAD * 2);
  const contentW = count * pw;
  return { pw, viewW, contentW, max: Math.max(0, contentW - viewW), stripTop: TIMELINE_HEADER + PARENT_H, trackTop: TIMELINE_HEADER + PARENT_H + STRIP_H + 4 };
}

const ACCENTS = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

/** The accent colour of an Excel timeline style name such as `TimeSlicerStyleDark2`. */
export function timelineAccent(style: string | undefined): { accent: string; dark: boolean } {
  const m = /^TimeSlicerStyle(Light|Dark)(\d+)$/.exec(style ?? "");
  const n = m ? Number(m[2]) : 1;
  return { accent: ACCENTS[(n - 1 + ACCENTS.length) % ACCENTS.length]!, dark: m?.[1] === "Dark" };
}

/** Excel's timeline styles, a light and a dark one of each colour. */
export const TIMELINE_STYLES: { value: string; label: string }[] = ["Blue", "Orange", "Gray", "Gold", "Light blue", "Green"].flatMap((name, i) => [
  { value: `TimeSlicerStyleLight${i + 1}`, label: `${name}, light` },
  { value: `TimeSlicerStyleDark${i + 1}`, label: `${name}, dark` },
]);

export interface TimelineGeometry {
  /** How far the timeline has been moved from where it was, and its size now. */
  dx: number;
  dy: number;
  w: number;
  h: number;
}

export interface TableTimelineViewProps {
  timeline: Timeline;
  data: TimelineData;
  width: number;
  height: number;
  readOnly?: boolean | undefined;
  selected?: boolean | undefined;
  /** Picks the range of days (or everything with `null`). */
  onSelect(range: { start: number; end: number } | null): void;
  onLevel(level: TimelineLevel): void;
  /** The timeline is being moved or resized (`final` when the pointer is let go); `null` when the drag ended without a change. */
  onGeometry(change: TimelineGeometry | null, final: boolean): void;
  onMenu(at: { x: number; y: number }): void;
}

type Drag =
  | { kind: "move" | "grip"; x: number; y: number; w: number; h: number; changed: boolean }
  | { kind: "pick"; anchor: number }
  | { kind: "scroll"; x: number; scroll: number };

/** A timeline: a heading with the periods' level and a button that clears the range, a strip of periods in which a range is dragged out, and a scroll bar. */
export function TableTimelineView({ timeline, data, width, height, readOnly, selected, onSelect, onLevel, onGeometry, onMenu }: TableTimelineViewProps) {
  const layout = tableTimelineLayout(data.level, data.periods.length, width);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [scroll, setScrollState] = useState(() => {
    const first = data.periods.findIndex((p) => p.selected && data.selection);
    return Math.max(0, Math.min(layout.max, first > 0 ? first * layout.pw - layout.pw : 0));
  });
  const [pending, setPending] = useState<{ a: number; b: number } | null>(null);
  const maxRef = useRef(layout.max);
  maxRef.current = layout.max;
  const scrollRef = useRef(scroll);
  scrollRef.current = scroll;
  const setScroll = (n: number) => {
    const v = Math.max(0, Math.min(maxRef.current, n));
    scrollRef.current = v;
    setScrollState(v);
  };
  const shownScroll = Math.min(scroll, layout.max);
  const { accent, dark } = timelineAccent(timeline.style);

  // The wheel over the strip moves along the periods, not the sheet.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const listener = (e: WheelEvent) => {
      if (maxRef.current <= 0) return;
      e.preventDefault();
      e.stopPropagation();
      setScroll(scrollRef.current + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY));
    };
    el.addEventListener("wheel", listener, { passive: false });
    return () => el.removeEventListener("wheel", listener);
  }, []);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const indexAt = (x: number) => Math.max(0, Math.min(data.periods.length - 1, Math.floor((x - PAD + shownScroll) / layout.pw)));
  const picked = data.periods.map((p, i) => (p.selected && data.selection ? i : -1)).filter((i) => i >= 0);
  const selFirst = picked.length ? picked[0]! : -1;
  const selLast = picked.length ? picked[picked.length - 1]! : -1;

  const finishPick = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const first = data.periods[lo];
    const last = data.periods[hi];
    if (first && last) onSelect({ start: first.start, end: last.end });
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (readOnly) return;
    const { x, y } = local(e);
    try {
      root.current?.setPointerCapture?.(e.pointerId);
    } catch {
      /* a pointer that is already gone */
    }
    if (x >= width - GRIP && y >= height - GRIP) {
      drag.current = { kind: "grip", x: e.clientX, y: e.clientY, w: width, h: height, changed: false };
      return;
    }
    if (y < TIMELINE_HEADER) {
      if (x >= width - 34) return onSelect(null);
      const level = TIMELINE_LEVELS[(TIMELINE_LEVELS.indexOf(data.level) + 1) % TIMELINE_LEVELS.length]!;
      if (x >= width - 34 - 96) return onLevel(level);
      drag.current = { kind: "move", x: e.clientX, y: e.clientY, w: width, h: height, changed: false };
      return;
    }
    if (y >= layout.trackTop - 2 && y <= layout.trackTop + TRACK_H + 2) {
      // The scroll bar: its thumb is dragged; a press beside it pages along.
      const thumbW = layout.contentW ? Math.max(20, (layout.viewW / layout.contentW) * layout.viewW) : layout.viewW;
      const thumbX = PAD + (layout.max ? (shownScroll / layout.max) * (layout.viewW - thumbW) : 0);
      if (x >= thumbX && x <= thumbX + thumbW) drag.current = { kind: "scroll", x: e.clientX, scroll: shownScroll };
      else setScroll(shownScroll + (x < thumbX ? -layout.viewW : layout.viewW));
      return;
    }
    if (y >= layout.stripTop && y <= layout.stripTop + STRIP_H && data.periods.length) {
      const i = indexAt(x);
      // The handles at the ends of the range pull that end; a press anywhere else starts a new range (Shift pulls the range out to it).
      if (selFirst >= 0 && Math.abs(x - (PAD + selFirst * layout.pw - shownScroll)) <= HANDLE / 2 + 2) drag.current = { kind: "pick", anchor: selLast };
      else if (selFirst >= 0 && Math.abs(x - (PAD + (selLast + 1) * layout.pw - shownScroll)) <= HANDLE / 2 + 2) drag.current = { kind: "pick", anchor: selFirst };
      else if (e.shiftKey && selFirst >= 0) drag.current = { kind: "pick", anchor: i < selFirst ? selLast : selFirst };
      else drag.current = { kind: "pick", anchor: i };
      setPending({ a: drag.current.anchor, b: i });
    }
  };

  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    if (d.kind === "pick") {
      const { x } = local(e);
      // Pulling past an edge of the strip scrolls it along.
      if (x > width - PAD - 6) setScroll(scrollRef.current + 12);
      else if (x < PAD + 6) setScroll(scrollRef.current - 12);
      setPending({ a: d.anchor, b: indexAt(x) });
    } else if (d.kind === "scroll") {
      const thumbW = Math.max(20, (layout.viewW / Math.max(1, layout.contentW)) * layout.viewW);
      const room = Math.max(1, layout.viewW - thumbW);
      setScroll(d.scroll + ((e.clientX - d.x) / room) * layout.max);
    } else {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const changed = d.changed || Math.abs(dx) > 2 || Math.abs(dy) > 2;
      drag.current = { ...d, changed };
      if (changed) onGeometry(d.kind === "move" ? { dx, dy, w: d.w, h: d.h } : { dx: 0, dy: 0, w: Math.max(160, d.w + dx), h: Math.max(90, d.h + dy) }, false);
    }
  };

  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    e.stopPropagation();
    try {
      root.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    if (d.kind === "pick") {
      const { x } = local(e);
      setPending(null);
      finishPick(d.anchor, indexAt(x));
    } else if (d.kind === "move" || d.kind === "grip") {
      if (!d.changed) return onGeometry(null, true);
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      onGeometry(d.kind === "move" ? { dx, dy, w: d.w, h: d.h } : { dx: 0, dy: 0, w: Math.max(160, d.w + dx), h: Math.max(90, d.h + dy) }, true);
    }
  };

  // The range shown: the one being dragged out, else the one picked.
  const lo = pending ? Math.min(pending.a, pending.b) : selFirst;
  const hi = pending ? Math.max(pending.a, pending.b) : selLast;
  const inRange = (i: number) => lo >= 0 && i >= lo && i <= hi;
  // Parents (the year over its quarters and months…) laid over their periods.
  const parents: { label: string; from: number; count: number }[] = [];
  data.periods.forEach((p, i) => {
    const last = parents[parents.length - 1];
    if (last && last.label === p.parent) last.count++;
    else parents.push({ label: p.parent, from: i, count: 1 });
  });
  const thumbW = layout.contentW ? Math.max(20, (layout.viewW / layout.contentW) * layout.viewW) : layout.viewW;
  const thumbX = PAD + (layout.max ? (shownScroll / layout.max) * (layout.viewW - thumbW) : 0);
  const style = { width, height, "--pli-timeline-accent": accent } as CSSProperties;
  const word = LEVEL_WORDS[data.level];
  const rangeWords = (() => {
    if (!data.periods.length) return "No dates";
    if (lo < 0) return `All periods`;
    const a = data.periods[lo]!;
    const b = data.periods[hi]!;
    const name = (p: (typeof data.periods)[number]) => (p.parent && data.level !== "years" ? `${p.label} ${p.parent}` : p.label);
    return lo === hi ? name(a) : `${name(a)} - ${name(b)}`;
  })();

  return (
    <div
      ref={root}
      className="pli-timeline"
      style={style}
      data-dark={dark ? "" : undefined}
      data-selected={selected ? "" : undefined}
      data-readonly={readOnly ? "" : undefined}
      role="group"
      aria-label={`Timeline: ${timeline.caption ?? timeline.column}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="pli-timeline-head" style={{ height: TIMELINE_HEADER }}>
        <span className="pli-timeline-caption">{timeline.caption ?? timeline.column}</span>
        <span className="pli-timeline-range" aria-live="polite">{rangeWords}</span>
        <span className="pli-timeline-level" role="button" aria-label={`Periods: ${word.toLowerCase()}`} title="Change the periods">{word} ▾</span>
        <span className="pli-timeline-clear" data-active={data.selection ? "" : undefined} role="button" aria-label="Clear the range" title="Clear the range">{"✕"}</span>
      </div>
      <div className="pli-timeline-strip" style={{ top: TIMELINE_HEADER, left: PAD, width: layout.viewW, height: PARENT_H + STRIP_H }}>
        <div className="pli-timeline-content" style={{ width: layout.contentW, transform: `translateX(${-shownScroll}px)` }}>
          {parents.map((g) => (
            g.label ? <div key={`g${g.from}`} className="pli-timeline-parent" style={{ left: g.from * layout.pw, width: g.count * layout.pw, height: PARENT_H }}>{g.label}</div> : null
          ))}
          {data.periods.map((p, i) => (
            <div key={p.start} className="pli-timeline-period" data-on={inRange(i) ? "" : undefined} data-empty={p.count === 0 ? "" : undefined} data-first={i === lo ? "" : undefined} data-last={i === hi ? "" : undefined} style={{ left: i * layout.pw, top: PARENT_H, width: layout.pw, height: STRIP_H }} title={`${p.label} ${p.parent}`.trim()} aria-pressed={inRange(i)}>
              {p.label}
            </div>
          ))}
          {lo >= 0 && (
            <>
              <div className="pli-timeline-handle" style={{ left: lo * layout.pw - HANDLE / 2, top: PARENT_H, height: STRIP_H, width: HANDLE }} />
              <div className="pli-timeline-handle" style={{ left: (hi + 1) * layout.pw - HANDLE / 2, top: PARENT_H, height: STRIP_H, width: HANDLE }} />
            </>
          )}
        </div>
      </div>
      <div className="pli-timeline-track" style={{ top: layout.trackTop, left: PAD, width: layout.viewW, height: TRACK_H }}>
        {layout.max > 0 && <div className="pli-timeline-thumb" style={{ left: thumbX - PAD, width: thumbW }} />}
      </div>
      <div className="pli-timeline-grip" />
    </div>
  );
}
