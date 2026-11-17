import type { Bounds } from "@pli.dev/sheets";

/** What the grid needs to draw and drag a page break preview. */
export interface PageBreakView {
  /** The ranges that print. */
  areas: Bounds[];
  /** Whether the ranges were set (a print area), as opposed to being everything the sheet holds. */
  explicit: boolean;
  /** The pages, for the numbers drawn over them. */
  pages: { number: number; range: Bounds; area: number }[];
  /** The breaks between rows: after which row, whether you made it, and the columns the line runs across. */
  rows: { after: number; manual: boolean; from: number; to: number }[];
  cols: { after: number; manual: boolean; from: number; to: number }[];
  /** A break was dragged from after one row (or column) to after another. */
  onMoveBreak(axis: "row" | "col", from: number, to: number): void;
  /** An edge of a print range was dragged to a row or column. */
  onMoveAreaEdge(index: number, edge: "top" | "bottom" | "left" | "right", to: number): void;
}

/** A break or print area edge being dragged: where the line is shown now (a row or column to come after). */
export type PageGhost = { axis: "row" | "col"; after: number } | null;

interface Props {
  view: PageBreakView;
  /** Where the rows and columns start, in pixels (`offset(n)` is the top or left of row or column n). */
  rowAt(row: number): number;
  colAt(col: number): number;
  /** The rows and columns of the sheet drawn, one past the last. */
  endRow: number;
  endCol: number;
  /** The rows and columns this piece of the grid shows. */
  rows: [number, number];
  cols: [number, number];
  ghost: PageGhost;
}

/** The parts of the sheet outside the print ranges, as rectangles of rows and columns: [r1, c1, r2 (one past), c2 (one past)]. */
export function outsideAreas(areas: readonly Bounds[], endRow: number, endCol: number): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const ys = [...new Set([1, endRow, ...areas.flatMap((a) => [a.r1, a.r2 + 1])])].filter((y) => y >= 1 && y <= endRow).sort((a, b) => a - b);
  for (let i = 0; i + 1 < ys.length; i++) {
    const [y0, y1] = [ys[i]!, ys[i + 1]!];
    const spans = areas.filter((a) => a.r1 <= y0 && y1 <= a.r2 + 1).map((a): [number, number] => [a.c1, a.c2 + 1]).sort((a, b) => a[0] - b[0]);
    let x = 1;
    for (const [c1, c2] of spans) {
      if (c1 > x) out.push([y0, x, y1, c1]);
      x = Math.max(x, c2);
    }
    if (x < endCol) out.push([y0, x, y1, endCol]);
  }
  return out;
}

/** The page break preview drawn over the grid: what is outside the print ranges dimmed, the ranges outlined, the page numbers, and the breaks. */
export function PageBreakLayer({ view, rowAt, colAt, endRow, endCol, rows, cols, ghost }: Props) {
  const seesRows = (a: number, z: number) => z + 1 >= rows[0] && a <= rows[1];
  const seesCols = (a: number, z: number) => z + 1 >= cols[0] && a <= cols[1];
  const box = (b: { r1: number; c1: number; r2: number; c2: number }) => ({ left: colAt(b.c1), top: rowAt(b.r1), width: colAt(b.c2 + 1) - colAt(b.c1), height: rowAt(b.r2 + 1) - rowAt(b.r1) });
  const dim = outsideAreas(view.areas, endRow, endCol).filter(([r1, c1, r2, c2]) => seesRows(r1, r2 - 1) && seesCols(c1, c2 - 1));
  return (
    <>
      {dim.map(([r1, c1, r2, c2]) => (
        <div key={`d${r1}:${c1}`} className="pli-pbp-dim" style={box({ r1, c1, r2: r2 - 1, c2: c2 - 1 })} />
      ))}
      {view.areas.map((a, i) => seesRows(a.r1, a.r2) && seesCols(a.c1, a.c2) && <div key={`a${i}`} className="pli-pbp-area" data-area={i} style={box(a)} />)}
      {view.pages.filter((p) => seesRows(p.range.r1, p.range.r2) && seesCols(p.range.c1, p.range.c2)).map((p) => (
        <div key={`p${p.number}:${p.range.r1}:${p.range.c1}`} className="pli-pbp-page" data-page={p.number} style={box(p.range)}>
          <span>Page {p.number}</span>
        </div>
      ))}
      {view.rows.filter((b) => seesRows(b.after, b.after) && seesCols(b.from, b.to)).map((b) => (
        <div key={`r${b.after}:${b.from}`} className="pli-pbp-break" data-axis="row" data-after={b.after} data-manual={b.manual ? "" : undefined} style={{ left: colAt(b.from), top: rowAt(b.after + 1) - 1, width: colAt(b.to + 1) - colAt(b.from), height: 0 }} />
      ))}
      {view.cols.filter((b) => seesCols(b.after, b.after) && seesRows(b.from, b.to)).map((b) => (
        <div key={`c${b.after}:${b.from}`} className="pli-pbp-break pli-pbp-break-col" data-axis="col" data-after={b.after} data-manual={b.manual ? "" : undefined} style={{ left: colAt(b.after + 1) - 1, top: rowAt(b.from), width: 0, height: rowAt(b.to + 1) - rowAt(b.from) }} />
      ))}
      {ghost?.axis === "row" && <div className="pli-pbp-ghost" data-axis="row" data-after={ghost.after} style={{ left: 0, top: rowAt(ghost.after + 1) - 1, width: colAt(endCol), height: 0 }} />}
      {ghost?.axis === "col" && <div className="pli-pbp-ghost pli-pbp-break-col" data-axis="col" data-after={ghost.after} style={{ left: colAt(ghost.after + 1) - 1, top: 0, width: 0, height: rowAt(endRow) }} />}
    </>
  );
}
