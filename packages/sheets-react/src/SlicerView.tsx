import type { CSSProperties } from "react";
import { itemPart, type ConditionalStyle, type Border, type Slicer, type SlicerStyleDef } from "@pli.dev/sheets";

/** One button of a slicer: a value of the column and whether the table lets it through. */
export interface SlicerItem {
  value: string;
  /** For a timeline's periods: the text on the button, the days it covers, and what it is under (the year of a month). */
  label?: string;
  start?: number;
  end?: number;
  group?: string;
  count: number;
  selected: boolean;
  /** Some row with this value passes the table's other filters; a button that isn't is dimmed. */
  available: boolean;
}

export const SLICER_HEADER = 32;
const PAD = 6;
const GAP = 4;
const ITEM_HEIGHT = 28;
const GRIP = 14;

/** Where the buttons of a slicer lie, in the slicer's own pixels (the first button at the top left of the body, before scrolling). */
export function slicerLayout(slicer: Slicer, w: number, h: number, count: number) {
  const columns = Math.max(1, slicer.columns ?? 1);
  const itemW = Math.max(20, (w - PAD * 2 - GAP * (columns - 1)) / columns);
  const lines = Math.ceil(count / columns);
  const contentH = lines ? lines * (ITEM_HEIGHT + GAP) - GAP + PAD * 2 : 0;
  const viewH = Math.max(0, h - SLICER_HEADER);
  return {
    columns,
    itemW,
    contentH,
    viewH,
    /** How far the buttons can scroll. */
    max: Math.max(0, contentH - viewH),
    rect(index: number, scroll: number) {
      const line = Math.floor(index / columns);
      return { x: PAD + (index % columns) * (itemW + GAP), y: SLICER_HEADER + PAD + line * (ITEM_HEIGHT + GAP) - scroll, w: itemW, h: ITEM_HEIGHT };
    },
  };
}

export type SlicerPart = { part: "clear" } | { part: "item"; value: string } | { part: "move" } | { part: "grip" } | { part: "body" };

/** What is at a point (slicer pixels) of a slicer. */
export function slicerHit(slicer: Slicer, items: readonly SlicerItem[], w: number, h: number, x: number, y: number, scroll: number): SlicerPart {
  if (x >= w - GRIP && y >= h - GRIP) return { part: "grip" };
  if (y < SLICER_HEADER) return x >= w - 34 ? { part: "clear" } : { part: "move" };
  const layout = slicerLayout(slicer, w, h, items.length);
  for (let i = 0; i < items.length; i++) {
    const r = layout.rect(i, scroll);
    if (r.y + r.h < SLICER_HEADER || r.y > h) continue;
    if (x >= r.x && x <= r.x + r.w && y >= Math.max(r.y, SLICER_HEADER) && y <= r.y + r.h) return { part: "item", value: items[i]!.value };
  }
  return { part: "body" };
}

const ACCENTS = ["#4472c4", "#ed7d31", "#a5a5a5", "#ffc000", "#5b9bd5", "#70ad47"];

/** The accent colour of an Excel slicer style name such as `SlicerStyleLight2`. */
export function slicerAccent(style: string | undefined): { accent: string; dark: boolean } {
  const m = /^SlicerStyle(Light|Dark|Other)(\d+)$/.exec(style ?? "");
  const n = m ? Number(m[2]) : 1;
  return { accent: ACCENTS[(n - 1 + ACCENTS.length) % ACCENTS.length]!, dark: m?.[1] === "Dark" };
}

const cssLine = (b: Border | undefined): string | undefined => {
  if (!b) return undefined;
  const width = b.style === "thick" ? 3 : b.style === "medium" || b.style === "double" ? 2 : 1;
  const line = b.style === "dashed" ? "dashed" : b.style === "dotted" || b.style === "hair" ? "dotted" : b.style === "double" ? "double" : "solid";
  return `${b.style === "double" ? 3 : width}px ${line} ${b.color}`;
};

/** A look of a slicer style of your own as CSS. */
export function slicerLookCss(look: ConditionalStyle | undefined): CSSProperties {
  if (!look) return {};
  const b = look.border;
  return {
    ...(look.fill ? { background: look.fill } : {}),
    ...(look.color ? { color: look.color } : {}),
    ...(look.bold ? { fontWeight: 700 } : {}),
    ...(look.italic ? { fontStyle: "italic" } : {}),
    ...(look.underline || look.strike ? { textDecoration: [look.underline ? "underline" : "", look.strike ? "line-through" : ""].filter(Boolean).join(" ") } : {}),
    ...(b?.top ? { borderTop: cssLine(b.top) } : {}),
    ...(b?.bottom ? { borderBottom: cssLine(b.bottom) } : {}),
    ...(b?.left ? { borderLeft: cssLine(b.left) } : {}),
    ...(b?.right ? { borderRight: cssLine(b.right) } : {}),
  };
}

export interface SlicerViewProps {
  slicer: Slicer;
  /** The slicer style of your own the slicer's `style` names (Excel's styles are drawn from their name). */
  look?: SlicerStyleDef | undefined;
  /** The value of the button the pointer is over. */
  hovered?: string | readonly string[] | undefined;
  items: readonly SlicerItem[];
  width: number;
  height: number;
  scroll: number;
  /** Whether the table is filtered by this slicer's column. */
  filtered: boolean;
  selected?: boolean;
}

/** A slicer: a heading with a button that clears the filter, and one button for each value in the column. Drawn only; the grid handles the pointer. */
export function SlicerView({ slicer, look, hovered, items, width, height, scroll, filtered, selected }: SlicerViewProps) {
  const layout = slicerLayout(slicer, width, height, items.length);
  const { accent, dark } = slicerAccent(slicer.style);
  const style = { width, height, "--pli-slicer-accent": accent } as CSSProperties;
  return (
    <div className="pli-slicer" style={look ? { ...style, ...slicerLookCss(look.wholeTable) } : style} data-custom={look ? "" : undefined} data-dark={dark && !look ? "" : undefined} data-selected={selected ? "" : undefined} role="group" aria-label={`Slicer: ${slicer.caption ?? slicer.column}`}>
      <div className="pli-slicer-head" style={{ height: SLICER_HEADER, ...(look ? slicerLookCss(look.headerRow) : {}) }}>
        <span className="pli-slicer-caption">{slicer.caption ?? slicer.column}</span>
        <span className="pli-slicer-clear" data-active={filtered ? "" : undefined} title="Clear filter" aria-hidden="true">{"✕"}</span>
      </div>
      <div className="pli-slicer-body" style={{ top: SLICER_HEADER, height: layout.viewH }}>
        {items.map((item, i) => {
          const r = layout.rect(i, scroll);
          if (r.y + r.h < SLICER_HEADER || r.y > height) return null;
          // A style of your own colours the button by whether it is let through, has data, and is under the pointer.
          const own = look ? slicerLookCss(look[itemPart(item.selected, item.available, (typeof hovered === "string" ? hovered === item.value : !!hovered?.includes(item.value)))]) : undefined;
          return (
            <div key={item.value} className="pli-slicer-item" data-custom={look ? "" : undefined} data-selected={look ? undefined : item.selected && filtered ? "" : undefined} data-on={look ? undefined : item.selected ? "" : undefined} data-dim={look || item.available ? undefined : ""} style={{ left: r.x, top: r.y - SLICER_HEADER, width: r.w, height: r.h, ...own }}>
              {item.value === "" ? "(Blanks)" : item.value}
            </div>
          );
        })}
      </div>
      {layout.max > 0 && <div className="pli-slicer-thumb" style={{ top: SLICER_HEADER + (scroll / layout.contentH) * layout.viewH, height: Math.max(16, (layout.viewH / layout.contentH) * layout.viewH) }} />}
      <div className="pli-slicer-grip" />
    </div>
  );
}
