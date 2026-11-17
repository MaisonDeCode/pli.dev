import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

export interface SidebarResizerProps {
  width: number;
  min: number;
  max: number;
  /** Pixels one arrow key press moves it (Shift: four times as much). */
  step: number;
  /** The width the person is dragging to (called at every move; the caller clamps it). */
  onChange: (width: number) => void;
  /** The drag or the key press is over: time to remember the width. */
  onCommit: () => void;
  /** Double click: back to the usual width. */
  onReset: () => void;
}

/**
 * The edge of the sidebar that can be dragged, or moved with the arrow keys (a `separator` that takes focus, as in the ARIA
 * pattern for a window splitter). Left and Right move it by a step (Shift: four steps), Home and End take it to its smallest
 * and largest, double click puts it back. It sits inside the sidebar, on its right edge.
 */
export function SidebarResizer({ width, min, max, step, onChange, onCommit, onReset }: SidebarResizerProps) {
  const start = useRef<{ x: number; width: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const end = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // The pointer is already gone.
    }
    onCommit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const by = (e.shiftKey ? 4 : 1) * step;
    const to = e.key === "ArrowLeft" ? width - by : e.key === "ArrowRight" ? width + by : e.key === "Home" ? min : e.key === "End" ? max : null;
    if (to === null) return;
    // The arrow keys are the handle's: they must not turn the page or nudge an annotation.
    e.preventDefault();
    e.stopPropagation();
    onChange(to);
    onCommit();
  };

  return (
    <div
      className="pli-pdf-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize the sidebar (double click for the usual width)"
      data-dragging={dragging ? "" : undefined}
      onPointerDown={(e) => {
        if (e.button !== 0 && e.button !== undefined) return;
        e.preventDefault();
        start.current = { x: e.clientX, width, id: e.pointerId };
        setDragging(true);
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // Capture is a convenience: without it the drag follows the pointer over the handle only.
        }
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && s.id === e.pointerId) onChange(s.width + (e.clientX - s.x));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
