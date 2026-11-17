import type { CSSProperties } from "react";
import type { Slicer } from "@pli.dev/sheets";
import { SLICER_HEADER, slicerAccent, type SlicerItem, type SlicerPart } from "./SlicerView";

/*
 * A timeline over a pivot table: a heading with a button that clears the dates, and a strip of periods (months, say, under
 * their year) to pick a stretch of dates from. It is drawn like a slicer and the grid moves and resizes it the same way; its
 * buttons are the periods, `SlicerItem`s that carry the days they cover.
 */

const PAD = 6;
const TILE_W = 52;
const GAP = 2;
const GROUP_H = 16;
const GRIP = 14;

/** Where the periods of a timeline lie, in its own pixels (the first at the left, before scrolling). */
export function timelineLayout(w: number, h: number, count: number) {
  const contentW = count ? count * (TILE_W + GAP) - GAP + PAD * 2 : 0;
  const viewW = w;
  const tileH = Math.max(18, Math.min(44, h - SLICER_HEADER - GROUP_H - PAD * 3));
  return {
    tileH,
    contentW,
    viewW,
    /** How far the strip can scroll. */
    max: Math.max(0, contentW - viewW),
    rect(index: number, scroll: number) {
      return { x: PAD + index * (TILE_W + GAP) - scroll, y: SLICER_HEADER + PAD + GROUP_H, w: TILE_W, h: tileH };
    },
  };
}

/** What is at a point (timeline pixels) of a timeline. */
export function timelineHit(items: readonly SlicerItem[], w: number, h: number, x: number, y: number, scroll: number): SlicerPart {
  if (x >= w - GRIP && y >= h - GRIP) return { part: "grip" };
  if (y < SLICER_HEADER) return x >= w - 34 ? { part: "clear" } : { part: "move" };
  const layout = timelineLayout(w, h, items.length);
  for (let i = 0; i < items.length; i++) {
    const r = layout.rect(i, scroll);
    if (r.x + r.w < 0 || r.x > w) continue;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { part: "item", value: items[i]!.value };
  }
  return { part: "body" };
}

export interface TimelineViewProps {
  slicer: Slicer;
  items: readonly SlicerItem[];
  width: number;
  height: number;
  scroll: number;
  /** Whether the pivot table keeps only some dates. */
  filtered: boolean;
  selected?: boolean;
}

export function TimelineView({ slicer, items, width, height, scroll, filtered, selected }: TimelineViewProps) {
  const layout = timelineLayout(width, height, items.length);
  const { accent, dark } = slicerAccent(slicer.style);
  const style = { width, height, "--pli-slicer-accent": accent } as CSSProperties;
  const caption = slicer.caption ?? slicer.column;
  return (
    <div className="pli-slicer pli-timeline" style={style} data-dark={dark ? "" : undefined} data-selected={selected ? "" : undefined} role="group" aria-label={`Timeline: ${caption}`}>
      <div className="pli-slicer-head" style={{ height: SLICER_HEADER }}>
        <span className="pli-slicer-caption">{caption}</span>
        <span className="pli-slicer-clear" data-active={filtered ? "" : undefined} title="Clear date filter" aria-hidden="true">{"✕"}</span>
      </div>
      <div className="pli-slicer-body" style={{ top: SLICER_HEADER, height: Math.max(0, height - SLICER_HEADER) }}>
        {items.map((item, i) => {
          const r = layout.rect(i, scroll);
          if (r.x + r.w < 0 || r.x > width) return null;
          const first = i === 0 || items[i - 1]!.group !== item.group;
          return (
            <div key={item.value}>
              {first && item.group && (
                <div className="pli-timeline-group" style={{ left: Math.max(PAD, r.x), top: PAD }}>
                  {item.group}
                </div>
              )}
              <div className="pli-slicer-item pli-timeline-tile" data-selected={item.selected && filtered ? "" : undefined} data-on={item.selected ? "" : undefined} style={{ left: r.x, top: r.y - SLICER_HEADER, width: r.w, height: r.h, justifyContent: "center" }}>
                {item.label ?? item.value}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pli-slicer-grip" />
    </div>
  );
}
