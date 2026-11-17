import { useRef, useState } from "react";
import { dragShapeHandle, shapeHandles, shapeValues, type SheetImage } from "@pli.dev/sheets";

export interface ShapeHandlesProps {
  image: SheetImage;
  /** The picture's frame in pixels. */
  w: number;
  h: number;
  /** Called while a handle is dragged with the adjustments now (undefined: the shape's usual ones), and with null when the drag is over. */
  onPreview(adjust: Record<string, number> | undefined | null): void;
  /** Called when the handle is let go, with the adjustments to keep. */
  onCommit(adjust: Record<string, number> | undefined): void;
}

/** The yellow handles of a selected shaped picture (Excel's adjustment handles): drag one to change a corner radius, an arrow head, a speech bubble's tail or a star's depth. */
export function ShapeHandles({ image, w, h, onPreview, onCommit }: ShapeHandlesProps) {
  const [live, setLive] = useState<Record<string, number> | undefined | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  if (!image.shape) return null;
  const adjust = live === null ? image.shapeAdjust : live;
  const handles = shapeHandles(image.shape, w, h, adjust);
  if (!handles.length) return null;

  /** A pointer position as a point of the frame, undoing the picture's turn and flips. */
  const pointOf = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = frame.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2);
    let y = e.clientY - (r.top + r.height / 2);
    const a = (-(image.rotation ?? 0) * Math.PI) / 180;
    [x, y] = [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
    x += w / 2;
    y += h / 2;
    // A mirrored picture has its shape mirrored too: the handle is drawn at the mirrored place.
    return [image.flipH ? w - x : x, image.flipV ? h - y : y];
  };

  return (
    <div ref={frame} className="pli-grid-adjframe" aria-hidden={false}>
      {handles.map((hd) => (
        <div
          key={hd.index}
          className="pli-grid-adjhandle"
          role="slider"
          aria-label={`Adjust ${image.shape}${handles.length > 1 ? ` (${hd.names.join(", ")})` : ""}`}
          aria-valuetext={hd.names.map((n) => `${n} ${Math.round(shapeValue(image, w, h, live === null ? image.shapeAdjust : live, n))}`).join(", ")}
          style={{ left: image.flipH ? w - hd.x : hd.x, top: image.flipV ? h - hd.y : hd.y }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            let last = image.shapeAdjust;
            const move = (ev: PointerEvent) => {
              const [x, y] = pointOf(ev);
              last = dragShapeHandle(image.shape!, hd.index, x, y, w, h, image.shapeAdjust);
              setLive(last);
              onPreview(last);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              window.removeEventListener("pointercancel", up);
              setLive(null);
              onPreview(null);
              onCommit(last);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", up);
          }}
          onKeyDown={(e) => {
            // The arrow keys nudge a handle by a pixel (ten with Shift).
            const step = e.shiftKey ? 10 : 1;
            const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const delta = d[e.key];
            if (!delta) return;
            e.preventDefault();
            e.stopPropagation();
            const next = dragShapeHandle(image.shape!, hd.index, hd.x + delta[0], hd.y + delta[1], w, h, image.shapeAdjust);
            onCommit(next);
          }}
          tabIndex={0}
        />
      ))}
    </div>
  );
}

function shapeValue(image: SheetImage, w: number, h: number, adjust: Record<string, number> | undefined, name: string): number {
  return shapeValues(image.shape!, w, h, adjust)[name] ?? 0;
}
