import type { ReactNode } from "react";
import type { PliUser } from "@pli.dev/core";
import { userColor } from "@pli.dev/core";

/** The container for presence overlays: put it over the canvas. It is hidden from screen readers and ignores the mouse. */
export function PeerLayer({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div className={className ? `pli-peer-layer ${className}` : "pli-peer-layer"} aria-hidden="true">
      {children}
    </div>
  );
}

const colorOf = (user: Pick<PliUser, "id" | "color">, color?: string) => color ?? user.color ?? userColor(user.id);

/** A coloured caret with the person's name above it: a text caret in a cell or a text box, or a pointer. */
export function PeerCursor({ user, x, y, height = 18, label = user.name, color }: { user: Pick<PliUser, "id" | "name" | "color">; x: number; y: number; height?: number; label?: string | false; color?: string }) {
  return (
    <span className="pli-peer-cursor" style={{ left: x, top: y, height, ["--pli-peer" as string]: colorOf(user, color) }}>
      {label !== false && <span className="pli-peer-flag">{label}</span>}
    </span>
  );
}

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A rectangle in a person's colour: the cell they are editing (`cell`), the slide object or annotation they have selected
 * (`element`), or text they have selected (`range`, a translucent fill).
 */
export function PeerOutline({ user, rect, label, variant = "element", color }: { user: Pick<PliUser, "id" | "name" | "color">; rect: Rect; label?: string | false; variant?: "cell" | "element" | "range"; color?: string }) {
  return (
    <span className="pli-peer-outline" data-variant={variant} style={{ ...rect, ["--pli-peer" as string]: colorOf(user, color) }}>
      {label !== false && variant !== "range" && <span className="pli-peer-flag">{label ?? user.name}</span>}
    </span>
  );
}
