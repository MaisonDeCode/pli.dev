import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog, MenuList, keepFocus, useDismiss, type MenuEntry } from "@pli.dev/react";
import { ICON_SETS, cellChoices, colName, describeRule, groupKey, leavesOf, parseRange, type CellControl, type ChipOption, type IconRef, type SheetSession } from "@pli.dev/sheets";
import { PALETTE, textOn, type ChipKind } from "./chips";
import { DateTreeList } from "./DateTreeList";
import { CfIcon } from "./icons";

/** Puts a panel at a point in the window, moved to stay inside it, inside the spreadsheet so its colours apply. */
function useAnchored(x: number, y: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    setPlace({ left: Math.max(margin, Math.min(x, window.innerWidth - box.width - margin)), top: Math.max(margin, Math.min(y, window.innerHeight - box.height - margin)) });
  }, [x, y]);
  return { ref, style: place ? { left: place.left, top: place.top } : { left: x, top: y, visibility: "hidden" as const } };
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose(): void;
  /** The spreadsheet's root, which the menu is drawn inside. */
  container: HTMLElement | null;
}

/** The menu for a right click on the grid. */
export function ContextMenu({ x, y, items, onClose, container }: ContextMenuProps) {
  const { ref, style } = useAnchored(x, y);
  useDismiss(true, onClose, ref);
  useEffect(() => {
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="pli-panel pli-panel-fixed pli-grid-menu" style={style} onMouseDown={keepFocus} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} close={onClose} label="Cell menu" />
    </div>,
    container ?? document.body,
  );
}

export interface FilterMenuProps {
  session: SheetSession;
  sheetId: string;
  col: number;
  x: number;
  y: number;
  /** The id of the table whose header was pressed; the sheet's own filter when missing. */
  table?: string | undefined;
  onClose(): void;
  /** Called to filter the column by a condition (the menu closes first). */
  onCondition?: ((info: { col: number; table?: string }) => void) | undefined;
  /** Called to open the Sort dialog for the column's table or filter range (the menu closes first). */
  onSort?: ((info: { col: number; table?: string }) => void) | undefined;
  /** Called with why a sort or filter was refused. */
  onProblem?: ((message: string) => void) | undefined;
  container: HTMLElement | null;
}

/** The menu on a filter button: sort, and a list of the column's values to let through. */
export function FilterMenu({ session, sheetId, col, x, y, table, onClose, onCondition, onSort, onProblem, container }: FilterMenuProps) {
  const { ref, style } = useAnchored(x, y);
  useDismiss(true, onClose, ref);
  const sheet = session.state.sheets.find((s) => s.id === sheetId)!;
  const tbl = table ? sheet.tables?.find((t) => t.id === table) : undefined;
  const name = tbl ? session.tableColumnNames(tbl)[col - parseRange(tbl.range)!.c1] ?? "" : colName(col);
  const values = useMemo(() => (tbl ? session.tableFilterValues(tbl.id, col) : session.filterValues(sheetId, col)), [session, sheetId, col, tbl]);
  const allowed = tbl ? tbl.filters?.[name] : sheet.filter?.columns?.[colName(col)];
  // A column of dates shows Excel's tree of years, months and days instead of a flat list.
  const tree = useMemo(() => (tbl ? session.tableFilterDateTree(tbl.id, col) : session.filterDateTree(sheetId, col)), [session, sheetId, col, tbl]);
  const rule = allowed && !Array.isArray(allowed) && allowed.kind !== "dateGroups" ? allowed : undefined;
  const [ticked, setTicked] = useState(() => new Set(tree ? tree.nodes.flatMap(leavesOf).filter((l) => l.selected > 0).map((l) => groupKey(l.group)) : []));
  const [otherChecked, setOtherChecked] = useState(() => new Set(tree ? tree.others.filter((o) => o.selected).map((o) => o.value) : []));
  const [checked, setChecked] = useState(() => new Set(Array.isArray(allowed) ? allowed : values.map((v) => v.value)));
  const [search, setSearch] = useState("");
  const shown = values.filter((v) => (v.value === "" ? "(blanks)" : v.value).toLowerCase().includes(search.toLowerCase()));

  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      onProblem?.(e instanceof Error ? e.message : String(e));
    } finally {
      onClose();
    }
  };
  const apply = () =>
    run(() => {
      if (tree) {
        if (tbl) session.filterTableDates(tbl.id, col, [...ticked], [...otherChecked]);
        else session.filterColumnDates(sheetId, col, [...ticked], [...otherChecked]);
        return;
      }
      const all = values.every((v) => checked.has(v.value));
      const list = all ? null : values.filter((v) => checked.has(v.value)).map((v) => v.value);
      if (tbl) session.filterTable(tbl.id, col, list);
      else session.filterColumn(sheetId, col, list);
    });
  const sort = (descending: boolean) =>
    run(() => {
      if (tbl) session.sortTable(tbl.id, col, descending ? "descending" : "ascending");
      else {
        const f = sheet.filter!;
        session.sort(sheetId, f.range, { by: col - parseRange(f.range)!.c1 + 1, descending, header: true });
        session.reapplyFilter(sheetId);
      }
    });
  // What the column can be sorted by besides its values: the colours and icons of its cells.
  const sortChoices = useMemo(() => {
    try {
      return tbl ? session.tableSortChoices(tbl.id, col) : sheet.filter ? session.sortChoices(sheetId, sheet.filter.range, col - parseRange(sheet.filter.range)!.c1 + 1, { header: true }) : { fills: [], fonts: [], icons: [] };
    } catch {
      return { fills: [], fonts: [], icons: [] };
    }
  }, [session, sheetId, col, tbl, sheet.filter]);
  const sortOn = (level: { by: "cellColor" | "fontColor"; color: string } | { by: "icon"; icon: IconRef | null }) =>
    run(() => {
      if (tbl) session.sortTableBy(tbl.id, [{ column: name, ...level }]);
      else {
        const f = sheet.filter!;
        session.sort(sheetId, f.range, { header: true, levels: [{ column: col - parseRange(f.range)!.c1 + 1, ...level }] });
        session.reapplyFilter(sheetId);
      }
    });
  const hasColors = sortChoices.fills.length > 1 || sortChoices.fonts.length > 1 || sortChoices.icons.length > 1;
  const toggle = (value: string) =>
    setChecked((old) => {
      const next = new Set(old);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  // The A to Z and Z to A items are ticked only when the table's first level is a sort of this column by value.
  const sorted = tbl?.sort && tbl.sort.column === name && !tbl.sort.by ? (tbl.sort.descending ? "descending" : "ascending") : undefined;

  return createPortal(
    <div ref={ref} className="pli-panel pli-panel-fixed pli-grid-filtermenu" style={style} role="dialog" aria-label={`Filter column ${tbl ? name : colName(col)}`} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <button type="button" className="pli-menu-item" data-active={sorted === "ascending" ? "" : undefined} onMouseDown={keepFocus} onClick={() => sort(false)}>Sort A to Z</button>
      <button type="button" className="pli-menu-item" data-active={sorted === "descending" ? "" : undefined} onMouseDown={keepFocus} onClick={() => sort(true)}>Sort Z to A</button>
      {hasColors && (
        <div className="pli-grid-sortcolors" role="group" aria-label="Sort by colour">
          <div className="pli-grid-filterrule">Sort by colour (on top)</div>
          {sortChoices.fills.length > 1 && (
            <div className="pli-grid-sortswatches">
              <span>Cell</span>
              {sortChoices.fills.map((c) => (
                <button key={c} type="button" className="pli-sortswatch" data-none={c === "none" ? "" : undefined} aria-label={c === "none" ? "Sort by no cell colour" : `Sort by cell colour ${c}`} title={c === "none" ? "No fill" : c} style={c === "none" ? undefined : { background: c }} onMouseDown={keepFocus} onClick={() => sortOn({ by: "cellColor", color: c })} />
              ))}
            </div>
          )}
          {sortChoices.fonts.length > 1 && (
            <div className="pli-grid-sortswatches">
              <span>Font</span>
              {sortChoices.fonts.map((c) => (
                <button key={c} type="button" className="pli-sortswatch" aria-label={c === "auto" ? "Sort by automatic font colour" : `Sort by font colour ${c}`} title={c === "auto" ? "Automatic" : c} style={c === "auto" ? undefined : { color: c }} onMouseDown={keepFocus} onClick={() => sortOn({ by: "fontColor", color: c })}>A</button>
              ))}
            </div>
          )}
          {sortChoices.icons.length > 1 && (
            <div className="pli-grid-sortswatches">
              <span>Icon</span>
              {sortChoices.icons.map((i) => (
                <button key={i ? `${i.set}${i.index}` : "none"} type="button" className="pli-sortswatch" aria-label={i ? `Sort by icon ${i.set} ${i.index + 1}` : "Sort by no icon"} title={i ? `${i.set}, ${i.index + 1}` : "No icon"} onMouseDown={keepFocus} onClick={() => sortOn({ by: "icon", icon: i })}>
                  {i ? <CfIcon set={i.set} index={i.index} count={ICON_SETS[i.set]} size={14} /> : "\u2205"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" className="pli-menu-item" onMouseDown={keepFocus} onClick={() => { onClose(); onSort?.({ col, ...(tbl ? { table: tbl.id } : {}) }); }}>Custom sort…</button>
      <button type="button" className="pli-menu-item" data-active={rule ? "" : undefined} onMouseDown={keepFocus} onClick={() => { onClose(); onCondition?.({ col, ...(tbl ? { table: tbl.id } : {}) }); }}>Filter by condition…</button>
      {rule && <div className="pli-grid-filterrule" role="note">{describeRule(rule)}</div>}
      {tbl && (
        <>
          <button type="button" className="pli-menu-item" disabled={!tbl.filters?.[name]} onMouseDown={keepFocus} onClick={() => run(() => session.filterTable(tbl.id, col, null))}>{`Clear filter from \u201C${name}\u201D`}</button>
          <button type="button" className="pli-menu-item" disabled={!tbl.sort} onMouseDown={keepFocus} onClick={() => run(() => session.sortTable(tbl.id, col, null))}>Clear sort mark</button>
        </>
      )}
      {!tbl && (
        <button type="button" className="pli-menu-item" disabled={!allowed} onMouseDown={keepFocus} onClick={() => run(() => session.filterColumn(sheetId, col, null))}>{`Clear filter from column ${colName(col)}`}</button>
      )}
      <div className="pli-menu-separator" />
      <input className="pli-grid-filtersearch" autoFocus placeholder="Search" aria-label="Search values" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="pli-grid-filterlinks">
        {tree ? (
          <>
            <button type="button" onClick={() => (setTicked(new Set(tree.nodes.flatMap(leavesOf).map((l) => groupKey(l.group)))), setOtherChecked(new Set(tree.others.map((o) => o.value))))}>Select all</button>
            <button type="button" onClick={() => (setTicked(new Set()), setOtherChecked(new Set()))}>Clear</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setChecked((old) => new Set([...old, ...shown.map((v) => v.value)]))}>Select all</button>
            <button type="button" onClick={() => setChecked((old) => new Set([...old].filter((v) => !shown.some((s) => s.value === v))))}>Clear</button>
          </>
        )}
      </div>
      {tree && <DateTreeList tree={tree} search={search} ticked={ticked} others={otherChecked} onTicked={setTicked} onOthers={setOtherChecked} />}
      {!tree && <ul className="pli-grid-filterlist" role="group" aria-label="Values">
        {shown.map((v) => (
          <li key={v.value}>
            <label>
              <input type="checkbox" checked={checked.has(v.value)} onChange={() => toggle(v.value)} />
              <span className="pli-grid-filtervalue">{v.value === "" ? "(Blanks)" : v.value}</span>
              <span className="pli-grid-filtercount">{v.count}</span>
            </label>
          </li>
        ))}
        {shown.length === 0 && <li className="pli-grid-filterempty">No matches</li>}
      </ul>}
      <div className="pli-grid-filteractions">
        <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
        <button type="button" className="pli-button pli-button-primary" onClick={apply}>OK</button>
      </div>
    </div>,
    container ?? document.body,
  );
}

export interface ChoiceMenuProps {
  session: SheetSession;
  sheetId: string;
  row: number;
  col: number;
  x: number;
  y: number;
  chips?: Readonly<Record<string, ChipKind>> | undefined;
  onClose(): void;
  container: HTMLElement | null;
}

function Pill({ option }: { option: ChipOption }) {
  return (
    <span className="pli-pill" style={option.color ? { background: option.color, color: textOn(option.color) } : undefined}>
      {option.image && <img className="pli-pill-image" src={option.image} alt="" draggable={false} />}
      <span className="pli-pill-label">{option.label ?? option.value}</span>
    </span>
  );
}

/** The list of a dropdown's choices, or the picker for a kind of badge an app provides (with a search box). */
export function ChoiceMenu({ session, sheetId, row, col, x, y, chips, onClose, container }: ChoiceMenuProps) {
  const { ref, style } = useAnchored(x, y);
  useDismiss(true, onClose, ref);
  const address = `${colName(col)}${row}`;
  const cell = session.state.sheets.find((s) => s.id === sheetId)?.cells[address];
  const control = cell?.control;
  const kind = control?.type === "badge" && control.kind ? chips?.[control.kind] : undefined;
  // A cell with no control of its own may take its list from a data validation, which can allow several choices too.
  const rule = !control ? session.validationAt(sheetId, address) : undefined;
  const multiple = control ? control.type !== "checkbox" && !!control.multiple : rule?.kind === "list" && !!rule.multiple;
  const selected = control ? cellChoices(cell) : session.validationSelection(sheetId, address);
  const external = !control ? session.externalListStatus(sheetId, address) : null;

  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ChipOption[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!kind?.search) return;
    let stale = false;
    Promise.resolve(kind.search(query)).then(
      (items) => !stale && setFound(items),
      () => !stale && setFound([]),
    );
    return () => {
      stale = true;
    };
  }, [kind, query]);

  // A cell with no control of its own may take its list from a data validation.
  const fromRule = !control ? session.validationChoices(sheetId, address) : [];
  const options: ChipOption[] = control?.type === "dropdown" ? control.options : control ? found : fromRule.map((value) => ({ value }));
  useEffect(() => setActive(0), [query, options.length]);

  const pick = (o: ChipOption) => {
    try {
      session.pickChoice(sheetId, address, o.value);
    } catch {
      /* a refused value leaves the cell as it was */
    }
    if (!multiple) onClose();
  };

  if (control?.type === "checkbox" || (!control && fromRule.length === 0 && !external)) return null;
  return createPortal(
    <div
      ref={ref}
      className="pli-panel pli-panel-fixed pli-grid-choicemenu"
      style={style}
      role="dialog"
      aria-label="Choices"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (options.length) setActive((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        } else if (e.key === "Enter" && options[active]) {
          e.preventDefault();
          pick(options[active]!);
        }
      }}
    >
      {kind?.search && <input className="pli-choice-search" autoFocus placeholder="Search" aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} />}
      <ul className="pli-choice-list" role="listbox" aria-label="Choices" aria-multiselectable={multiple || undefined} tabIndex={kind?.search ? undefined : 0} ref={(el) => { if (el && !kind?.search && document.activeElement === document.body) el.focus(); }}>
        {options.map((o, i) => (
          <li key={o.value} role="option" aria-selected={selected.includes(o.value)}>
            <button type="button" className="pli-choice-item" data-active={i === active ? "" : undefined} onMouseDown={keepFocus} onClick={() => pick(o)}>
              <span className="pli-choice-tick" aria-hidden="true">{selected.includes(o.value) ? "✓" : ""}</span>
              <span className="pli-choice-text">
                {kind?.render ? kind.render(o) : <Pill option={o} />}
                {o.description && <span className="pli-choice-description">{o.description}</span>}
              </span>
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="pli-choice-empty">{kind?.search ? "No matches" : "No choices"}</li>}
      </ul>
      {external && (
        <p className="pli-choice-source" data-state={external.state} title={external.reason}>
          {external.state === "fresh" ? `From ${external.book}` : `From ${external.book}${external.read ? `, read ${external.read}` : ""} (may be out of date)`}
        </p>
      )}
      {(selected.length > 0 || multiple) && (
        <div className="pli-choice-buttons">
          {selected.length > 0 && (
            <button type="button" className="pli-choice-clear" onMouseDown={keepFocus} onClick={() => { session.pickChoice(sheetId, address, null); onClose(); }}>
              Clear
            </button>
          )}
          {multiple && (
            <button type="button" className="pli-choice-done" onMouseDown={keepFocus} onClick={onClose}>
              Done
            </button>
          )}
        </div>
      )}
    </div>,
    container ?? document.body,
  );
}

export interface DropdownDialogProps {
  open: boolean;
  /** The dropdown being edited, if the cell already is one. */
  initial: Extract<CellControl, { type: "dropdown" }> | undefined;
  onClose(): void;
  onSave(control: Extract<CellControl, { type: "dropdown" }>): void;
}

/** Where someone sets up a dropdown: its choices and their colours, and whether several can be chosen or anything else typed. */
export function DropdownDialog({ open, initial, onClose, onSave }: DropdownDialogProps) {
  const fresh = () => [{ value: "Option 1", color: PALETTE[0] }, { value: "Option 2", color: PALETTE[1] }] as ChipOption[];
  const [rows, setRows] = useState<ChipOption[]>(fresh);
  const [multiple, setMultiple] = useState(false);
  const [separator, setSeparator] = useState(", ");
  const [strict, setStrict] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setRows(initial ? initial.options.map((o) => ({ ...o })) : fresh());
    setMultiple(!!initial?.multiple);
    setSeparator(initial?.separator ?? ", ");
    setStrict(!!initial?.strict);
    setProblem(null);
  }, [open, initial]);

  const save = () => {
    const options = rows.map((r) => ({ ...r, value: r.value.trim() })).filter((r) => r.value !== "");
    if (options.length === 0) return setProblem("Add at least one choice");
    const seen = new Set<string>();
    for (const o of options) {
      if (seen.has(o.value)) return setProblem(`"${o.value}" is in the list twice`);
      seen.add(o.value);
    }
    if (multiple && !separator.trim()) return setProblem("Give the separator that goes between several choices, such as a comma.");
    onSave({ type: "dropdown", options, ...(multiple ? { multiple: true, ...(separator !== ", " ? { separator } : {}) } : {}), ...(strict ? { strict: true } : {}) });
  };

  return (
    <Dialog
      open={open}
      title={initial ? "Edit dropdown" : "Dropdown"}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Done</button>
        </>
      }
    >
      <ul className="pli-dropdown-rows" aria-label="Choices">
        {rows.map((r, i) => (
          <li key={i} className="pli-dropdown-row">
            <input type="color" aria-label={`Colour of choice ${i + 1}`} value={r.color ?? PALETTE[i % PALETTE.length]!} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
            <input type="text" aria-label={`Choice ${i + 1}`} value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
            <button type="button" className="pli-button" aria-label={`Remove choice ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ul>
      <button type="button" className="pli-button" onClick={() => setRows([...rows, { value: "", color: PALETTE[rows.length % PALETTE.length] }])}>Add a choice</button>
      <div className="pli-dropdown-options">
        <label><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Allow choosing several</label>
        {multiple && (
          <label>
            Separator
            <input type="text" aria-label="Separator" value={separator} maxLength={8} onChange={(e) => setSeparator(e.target.value)} />
          </label>
        )}
        <label><input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} /> Refuse anything that isn't a choice</label>
      </div>
      {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
    </Dialog>
  );
}
