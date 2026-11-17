import { useState } from "react";
import type { DocumentSession, TableState } from "@pli.dev/docs";
import { Dialog, keepFocus, type MenuEntry } from "./primitives";

const GRID_ROWS = 8;
const GRID_COLUMNS = 8;

/** A grid of squares: hover to choose a size, click to insert a table that big. */
export function TableGrid({ onPick }: { onPick: (rows: number, columns: number) => void }) {
  const [hover, setHover] = useState({ rows: 0, columns: 0 });
  return (
    <div className="pli-table-grid-wrap">
      <div className="pli-table-grid" role="group" aria-label="Table size" onMouseLeave={() => setHover({ rows: 0, columns: 0 })}>
        {Array.from({ length: GRID_ROWS }, (_, r) =>
          Array.from({ length: GRID_COLUMNS }, (_, c) => (
            <button
              key={`${r}:${c}`}
              type="button"
              className="pli-table-grid-cell"
              aria-label={`${r + 1} rows by ${c + 1} columns`}
              data-active={r < hover.rows && c < hover.columns ? "" : undefined}
              onMouseDown={keepFocus}
              onMouseEnter={() => setHover({ rows: r + 1, columns: c + 1 })}
              onFocus={() => setHover({ rows: r + 1, columns: c + 1 })}
              onClick={() => onPick(r + 1, c + 1)}
            />
          )),
        )}
      </div>
      <div className="pli-table-grid-label" aria-live="polite">
        {hover.rows > 0 ? `${hover.rows} × ${hover.columns}` : "Insert table"}
      </div>
    </div>
  );
}

export interface TableDialogProps {
  open: boolean;
  onInsert: (rows: number, columns: number, headerRow: boolean) => void;
  onClose: () => void;
}

/** For a table size the grid can't reach. */
export function TableDialog({ open, onInsert, onClose }: TableDialogProps) {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [headerRow, setHeaderRow] = useState(true);
  const clamp = (value: string, max: number) => Math.min(max, Math.max(1, Math.floor(Number(value)) || 1));
  return (
    <Dialog
      open={open}
      title="Insert table"
      onClose={onClose}
      onSubmit={() => { onInsert(rows, columns, headerRow); onClose(); }}
      actions={
        <>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Insert</button>
        </>
      }
    >
      <label className="pli-field-row">
        <span>Rows</span>
        <input type="number" min={1} max={100} value={rows} onChange={(e) => setRows(clamp(e.target.value, 100))} autoFocus />
      </label>
      <label className="pli-field-row">
        <span>Columns</span>
        <input type="number" min={1} max={20} value={columns} onChange={(e) => setColumns(clamp(e.target.value, 20))} />
      </label>
      <label className="pli-checkbox-row">
        <input type="checkbox" checked={headerRow} onChange={(e) => setHeaderRow(e.target.checked)} />
        First row is a header
      </label>
    </Dialog>
  );
}

/** Row heights offered in the menu, in points. Anything else goes through the dialog. */
const ROW_HEIGHTS = [18, 24, 36, 48, 72];

export interface TableMenuOptions {
  /** Open a dialog for a row height the menu doesn't list. */
  onRowHeight?: () => void;
}

/** The table commands as menu entries, for the toolbar's table menu and the Format menu. */
export function tableMenuItems(session: DocumentSession, table: TableState | null, after: () => void, options: TableMenuOptions = {}): MenuEntry[] {
  const run = (action: () => unknown) => () => {
    action();
    after();
  };
  const disabled = !table;
  const rows = table?.selectedRows ?? 1;
  const columns = table?.selectedColumns ?? 1;
  return [
    { label: "Insert row above", disabled, onSelect: run(() => session.addRow("above")) },
    { label: "Insert row below", disabled, onSelect: run(() => session.addRow("below")) },
    { label: "Insert column left", disabled, onSelect: run(() => session.addColumn("left")) },
    { label: "Insert column right", disabled, onSelect: run(() => session.addColumn("right")) },
    "separator",
    { label: rows > 1 ? `Delete ${rows} rows` : "Delete row", disabled, onSelect: run(() => session.deleteRow()) },
    { label: columns > 1 ? `Delete ${columns} columns` : "Delete column", disabled, onSelect: run(() => session.deleteColumn()) },
    { label: "Delete table", disabled, onSelect: run(() => session.deleteTable()) },
    "separator",
    { label: "Merge cells", disabled: !table?.canMerge, onSelect: run(() => session.mergeCells()) },
    { label: "Split cell", disabled: !table?.canSplit, onSelect: run(() => session.splitCells()) },
    "separator",
    {
      label: "Vertical alignment",
      disabled,
      items: (["top", "middle", "bottom"] as const).map((align) => ({
        label: align === "top" ? "Top" : align === "middle" ? "Middle" : "Bottom",
        checked: table?.vAlign === align,
        onSelect: run(() => session.setCellVerticalAlign(align)),
      })),
    },
    {
      label: "Row height",
      disabled,
      items: [
        { label: "Fit content", checked: table?.rowHeight === undefined, onSelect: run(() => session.setRowHeight(null)) },
        ...ROW_HEIGHTS.map((points) => ({
          label: `${points} pt`,
          checked: table?.rowHeight === points,
          onSelect: run(() => session.setRowHeight(points)),
        })),
        ...(options.onRowHeight ? [{ label: "Custom…", onSelect: options.onRowHeight }] : []),
      ],
    },
    "separator",
    { label: "Header row", disabled, checked: !!table?.headerRow, onSelect: run(() => session.setHeaderRow(!table?.headerRow)) },
    {
      label: "Borders",
      disabled,
      items: (["all", "horizontal", "none"] as const).map((mode) => ({
        label: mode === "all" ? "All borders" : mode === "horizontal" ? "Horizontal lines only" : "No borders",
        checked: table?.borders === mode,
        onSelect: run(() => session.setTableBorders(mode)),
      })),
    },
  ];
}

export interface RowHeightDialogProps {
  open: boolean;
  /** The current minimum height in points, if the row has one. */
  initial?: number;
  onApply: (points: number | null) => void;
  onClose: () => void;
}

/** A custom minimum height for the selected rows. */
export function RowHeightDialog({ open, initial, onApply, onClose }: RowHeightDialogProps) {
  const [points, setPoints] = useState(initial ?? 24);
  return (
    <Dialog
      open={open}
      title="Row height"
      onClose={onClose}
      onSubmit={() => { onApply(Math.min(2000, Math.max(6, points))); onClose(); }}
      actions={
        <>
          <button type="button" className="pli-button" onClick={() => { onApply(null); onClose(); }}>Fit content</button>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Apply</button>
        </>
      }
    >
      <label className="pli-field-row">
        <span>Minimum height</span>
        <input type="number" min={6} max={2000} step={1} value={points} onChange={(e) => setPoints(Number(e.target.value) || 6)} autoFocus />
      </label>
      <p className="pli-dialog-note">In points. A row is always tall enough for its content.</p>
    </Dialog>
  );
}
