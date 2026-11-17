import type { Box } from "@pli.dev/decks";

/** A guide line Google-style: an `edge` line along the aligned edges, or a `gap` bar marking an equal space. */
export interface SnapGuide {
  kind: "edge" | "gap";
  /** `x` is a vertical line (or a horizontal gap bar measured along x); `y` the other way round. */
  axis: "x" | "y";
  /** Where the line sits (x for vertical lines, y for horizontal ones). For a gap bar, the position across it. */
  pos: number;
  /** The extent along the line. */
  from: number;
  to: number;
}

export interface SnapResult {
  /** How far to move the box to land on the guides. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

export interface SnapOptions {
  /** How near (in points) an edge has to be to snap. Default 4. */
  threshold?: number;
  /** Which edges of the moving box can snap: left/centre/right and top/middle/bottom. All by default; when resizing, only the edges being dragged. */
  edges?: { l?: boolean; c?: boolean; r?: boolean; t?: boolean; m?: boolean; b?: boolean };
  /** Snap to equal spacing between elements too. Default true. */
  spacing?: boolean;
}

interface Iv {
  /** Along the axis. */
  a: number;
  b: number;
  /** Across it. */
  pa: number;
  pb: number;
}

interface Line1D {
  kind: "edge" | "gap";
  pos: number;
  from: number;
  to: number;
}

const EPS = 0.01;

function snapAxis(m: Iv, others: readonly Iv[], extent: number, active: { l: boolean; c: boolean; r: boolean }, threshold: number, spacing: boolean): { d: number; lines: Line1D[] } {
  const mine: { at: number; key: "l" | "c" | "r" }[] = [];
  if (active.l) mine.push({ at: m.a, key: "l" });
  if (active.c) mine.push({ at: (m.a + m.b) / 2, key: "c" });
  if (active.r) mine.push({ at: m.b, key: "r" });
  const targets: { at: number; other?: Iv }[] = [{ at: 0 }, { at: extent / 2 }, { at: extent }];
  for (const o of others) targets.push({ at: o.a, other: o }, { at: (o.a + o.b) / 2, other: o }, { at: o.b, other: o });

  let best: { d: number; kind: "edge" | "gap"; gap?: { left: Iv; right: Iv; between: boolean; g: number } } | undefined;
  for (const mm of mine)
    for (const t of targets) {
      const d = t.at - mm.at;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - EPS)) best = { d, kind: "edge" };
    }

  if (spacing && active.l && active.r) {
    // equal gaps: a row of elements that overlap the moving box across the axis
    const row = others.filter((o) => o.pb > m.pa && o.pa < m.pb).sort((x, y) => x.a - y.a);
    for (let i = 0; i + 1 < row.length; i++) {
      const left = row[i]!;
      const right = row[i + 1]!;
      const g = right.a - left.b;
      if (g < 0) continue;
      const w = m.b - m.a;
      const candidates: { to: number; between: boolean }[] = [
        { to: left.a - g - w, between: false },
        { to: right.b + g, between: false },
      ];
      if (g > w) candidates.push({ to: left.b + (g - w) / 2, between: true });
      for (const c of candidates) {
        const d = c.to - m.a;
        if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d) - EPS)) best = { d, kind: "gap", gap: { left, right, between: c.between, g } };
      }
    }
  }
  if (!best) return { d: 0, lines: [] };
  const d = best.d;
  const lines: Line1D[] = [];
  const moved = { a: m.a + d, b: m.b + d, pa: m.pa, pb: m.pb };
  // every edge that now lines up with a target gets a line, as long as the box and the target are both there
  for (const mm of mine) {
    const at = mm.at + d;
    for (const t of targets) {
      if (Math.abs(t.at - at) > EPS) continue;
      const span = t.other ? [Math.min(moved.pa, t.other.pa), Math.max(moved.pb, t.other.pb)] : [moved.pa, moved.pb];
      lines.push({ kind: "edge", pos: at, from: span[0]!, to: span[1]! });
    }
  }
  if (best.kind === "gap" && best.gap) {
    const { left, right, between, g } = best.gap;
    const mid = (Math.max(moved.pa, left.pa, right.pa) + Math.min(moved.pb, left.pb, right.pb)) / 2;
    if (between) {
      lines.push({ kind: "gap", pos: mid, from: left.b, to: moved.a }, { kind: "gap", pos: mid, from: moved.b, to: right.a });
    } else if (moved.b <= left.a + EPS) {
      lines.push({ kind: "gap", pos: mid, from: moved.b, to: left.a }, { kind: "gap", pos: mid, from: left.b, to: right.a });
    } else {
      lines.push({ kind: "gap", pos: mid, from: left.b, to: right.a }, { kind: "gap", pos: mid, from: right.b, to: moved.a });
    }
    void g;
  }
  // drop duplicates
  const seen = new Set<string>();
  return { d, lines: lines.filter((l) => (seen.has(`${l.kind}${l.pos}${l.from}${l.to}`) ? false : (seen.add(`${l.kind}${l.pos}${l.from}${l.to}`), true))) };
}

/**
 * Where a box being moved (or resized) snaps to: the slide's edges and centre, and other elements' edges and centres, and
 * equal spacing between elements. Pure: it returns how far to move the box and the guide lines to draw.
 */
export function snap(moving: Box, others: readonly Box[], slide: { width: number; height: number }, options: SnapOptions = {}): SnapResult {
  const threshold = options.threshold ?? 4;
  const e = options.edges ?? {};
  const all = options.edges === undefined;
  const spacing = options.spacing ?? true;
  const x = snapAxis(
    { a: moving.x, b: moving.x + moving.w, pa: moving.y, pb: moving.y + moving.h },
    others.map((o) => ({ a: o.x, b: o.x + o.w, pa: o.y, pb: o.y + o.h })),
    slide.width,
    { l: all || !!e.l, c: all || !!e.c, r: all || !!e.r },
    threshold,
    spacing,
  );
  const y = snapAxis(
    { a: moving.y, b: moving.y + moving.h, pa: moving.x + x.d, pb: moving.x + x.d + moving.w },
    others.map((o) => ({ a: o.y, b: o.y + o.h, pa: o.x, pb: o.x + o.w })),
    slide.height,
    { l: all || !!e.t, c: all || !!e.m, r: all || !!e.b },
    threshold,
    spacing,
  );
  const guides: SnapGuide[] = [
    ...x.lines.map((l): SnapGuide => (l.kind === "edge" ? { kind: "edge", axis: "x", pos: l.pos, from: l.from, to: l.to } : { kind: "gap", axis: "x", pos: l.pos, from: l.from, to: l.to })),
    ...y.lines.map((l): SnapGuide => (l.kind === "edge" ? { kind: "edge", axis: "y", pos: l.pos, from: l.from, to: l.to } : { kind: "gap", axis: "y", pos: l.pos, from: l.from, to: l.to })),
  ];
  return { dx: x.d, dy: y.d, guides };
}
