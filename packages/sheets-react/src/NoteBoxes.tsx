import { useRef, useState } from "react";
import { MIN_NOTE_HEIGHT, MIN_NOTE_WIDTH, NOTE_BOX_DEFAULTS, noteLookOf, type NoteBox, type NoteInfo } from "@pli.dev/sheets";
import { NoteContent } from "./NoteContent";
import { NoteFill, noteFrameCss, noteLineColor } from "./noteLook";

/** A note that stays on the sheet: where its cell's top right corner is in the grid's window. */
export interface ShownNote {
  address: string;
  row: number;
  col: number;
  info: NoteInfo;
  /** The cell's top right corner. */
  anchorX: number;
  anchorY: number;
}

type Grip = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const GRIPS: Grip[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const CURSOR: Record<Grip, string> = { move: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

interface Geometry {
  dx: number;
  dy: number;
  width: number;
  height: number;
}

const geometryOf = (box: NoteBox | undefined): Geometry => ({ dx: box?.dx ?? NOTE_BOX_DEFAULTS.dx, dy: box?.dy ?? NOTE_BOX_DEFAULTS.dy, width: box?.width ?? NOTE_BOX_DEFAULTS.width, height: box?.height ?? NOTE_BOX_DEFAULTS.height });

/** The box after pulling `grip` by (mx, my): a corner or edge moves, the opposite one stays. */
function pulled(g: Geometry, grip: Grip, mx: number, my: number): Geometry {
  if (grip === "move") return { ...g, dx: g.dx + mx, dy: g.dy + my };
  let { dx, dy, width, height } = g;
  if (grip.includes("e")) width = Math.max(MIN_NOTE_WIDTH, g.width + mx);
  if (grip.includes("s")) height = Math.max(MIN_NOTE_HEIGHT, g.height + my);
  if (grip.includes("w")) {
    width = Math.max(MIN_NOTE_WIDTH, g.width - mx);
    dx = g.dx + (g.width - width);
  }
  if (grip.includes("n")) {
    height = Math.max(MIN_NOTE_HEIGHT, g.height - my);
    dy = g.dy + (g.height - height);
  }
  return { dx, dy, width, height };
}

/** Where a line from the cell's corner meets the box: the nearest point on its edge. */
function nearest(ax: number, ay: number, x: number, y: number, w: number, h: number): { x: number; y: number } {
  return { x: Math.max(x, Math.min(ax, x + w)), y: Math.max(y, Math.min(ay, y + h)) };
}

export interface NoteBoxesProps {
  notes: ShownNote[];
  /** The part of the grid window the boxes may be drawn in. */
  clip: { left: number; top: number; width: number; height: number };
  /** The address of the selected cell, whose note box (if it shows) gets handles. */
  selected: string | null;
  readOnly: boolean;
  onSelect(row: number, col: number): void;
  onEdit(): void;
  /** The box after it was moved or sized, or its Hide button was pressed. */
  onChange(address: string, box: NoteBox): void;
  /** Follows a link in a note's text. */
  onOpenLink?(to: string): void;
}

/** Notes that are kept showing: boxes over the grid, joined to their cells by a line, that can be dragged and sized like pictures. */
export function NoteBoxes({ notes, clip, selected, readOnly, onSelect, onEdit, onChange, onOpenLink }: NoteBoxesProps) {
  const [drag, setDrag] = useState<{ address: string; geometry: Geometry } | null>(null);
  const start = useRef<{ grip: Grip; x: number; y: number; from: Geometry; moved: boolean } | null>(null);

  if (!notes.length) return null;
  return (
    <div className="pli-notelayer" style={{ left: clip.left, top: clip.top, width: clip.width, height: clip.height }}>
      <svg className="pli-notelines" width={clip.width} height={clip.height} aria-hidden="true">
        {notes.map((n) => {
          const g = drag?.address === n.address ? drag.geometry : geometryOf(n.info.box);
          const x = Math.max(0, n.anchorX + g.dx - clip.left);
          const y = Math.max(0, n.anchorY + g.dy - clip.top);
          const p = nearest(n.anchorX - clip.left, n.anchorY - clip.top, x, y, g.width, g.height);
          return <line key={n.address} x1={n.anchorX - clip.left} y1={n.anchorY - clip.top} x2={p.x} y2={p.y} {...(noteLineColor(n.info.box) ? { style: { stroke: noteLineColor(n.info.box)! } } : {})} />;
        })}
      </svg>
      {notes.map((n) => {
        const g = drag?.address === n.address ? drag.geometry : geometryOf(n.info.box);
        const x = Math.max(0, n.anchorX + g.dx - clip.left);
        const y = Math.max(0, n.anchorY + g.dy - clip.top);
        const isSelected = selected === n.address;
        const begin = (grip: Grip) => (e: React.PointerEvent) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          onSelect(n.row, n.col);
          if (readOnly) return;
          start.current = { grip, x: e.clientX, y: e.clientY, from: geometryOf(n.info.box), moved: false };
          try {
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          } catch {
            /* a pointer that is gone can't be captured */
          }
        };
        const move = (e: React.PointerEvent) => {
          const s = start.current;
          if (!s) return;
          const mx = e.clientX - s.x;
          const my = e.clientY - s.y;
          if (!s.moved && Math.abs(mx) < 2 && Math.abs(my) < 2) return;
          s.moved = true;
          setDrag({ address: n.address, geometry: pulled(s.from, s.grip, mx, my) });
        };
        const end = () => {
          const s = start.current;
          start.current = null;
          if (!s?.moved || !drag || drag.address !== n.address) return setDrag(null);
          const { dx, dy, width, height } = drag.geometry;
          setDrag(null);
          // Only what differs from the usual box is kept.
          onChange(n.address, {
            ...noteLookOf(n.info.box),
            ...(width !== NOTE_BOX_DEFAULTS.width ? { width } : {}),
            ...(height !== NOTE_BOX_DEFAULTS.height ? { height } : {}),
            ...(dx !== NOTE_BOX_DEFAULTS.dx ? { dx } : {}),
            ...(dy !== NOTE_BOX_DEFAULTS.dy ? { dy } : {}),
            ...(n.info.box?.show ? { show: true as const } : {}),
          });
        };
        return (
          <div
            key={n.address}
            className="pli-notebox"
            role="group"
            aria-label={`Note on ${n.address}`}
            data-note={n.address}
            data-selected={isSelected ? "" : undefined}
            style={{ left: x, top: y, width: g.width, height: g.height, cursor: readOnly ? "default" : "move", ...noteFrameCss(n.info.box) }}
            onPointerDown={begin("move")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => !readOnly && onEdit()}
          >
            <NoteFill box={n.info.box} />
            <div className="pli-notebox-text">
              <NoteContent info={n.info} {...(onOpenLink ? { onOpenLink } : {})} />
            </div>
            {isSelected && !readOnly && (
              <>
                <button type="button" className="pli-notebox-hide" aria-label="Hide note" title="Hide note" onPointerDown={(e) => e.stopPropagation()} onClick={() => onChange(n.address, { ...(n.info.box ?? {}), show: undefined } as NoteBox)}>
                  {"×"}
                </button>
                {GRIPS.map((grip) => (
                  <div key={grip} className="pli-notebox-grip" data-grip={grip} style={{ cursor: CURSOR[grip], ...gripStyle(grip) }} onPointerDown={begin(grip)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function gripStyle(grip: Grip): React.CSSProperties {
  const left = grip.includes("w") ? -4 : grip.includes("e") ? undefined : "calc(50% - 4px)";
  const right = grip.includes("e") ? -4 : undefined;
  const top = grip.includes("n") ? -4 : grip.includes("s") ? undefined : "calc(50% - 4px)";
  const bottom = grip.includes("s") ? -4 : undefined;
  return { ...(left !== undefined ? { left } : {}), ...(right !== undefined ? { right } : {}), ...(top !== undefined ? { top } : {}), ...(bottom !== undefined ? { bottom } : {}) };
}
