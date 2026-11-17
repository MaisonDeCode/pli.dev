import { useEffect, useRef, useState } from "react";
import { groupKey, leavesOf, type DateNode, type DateTree } from "@pli.dev/sheets";

export interface DateTreeListProps {
  tree: DateTree;
  /** What the search box holds; the tree shows the dates that match, opened up. */
  search: string;
  /** The leaves ticked (by `groupKey`), and the other values ticked. */
  ticked: ReadonlySet<string>;
  others: ReadonlySet<string>;
  onTicked(next: Set<string>): void;
  onOthers(next: Set<string>): void;
}

const matches = (n: DateNode, q: string): boolean => n.title.toLowerCase().includes(q) || n.children.some((c) => matches(c, q));

/** The checkbox of a node: ticked, empty, or in between when only some of the dates under it are ticked. */
function Box({ state, label, onChange }: { state: "all" | "some" | "none"; label: string; onChange(on: boolean): void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={state === "all"} onChange={(e) => onChange(e.target.checked)} />;
}

/** Excel's list of dates in a filter menu: years that open into months, and months that open into days, each with a three-state checkbox. */
export function DateTreeList({ tree, search, ticked, others, onTicked, onOthers }: DateTreeListProps) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const q = search.trim().toLowerCase();
  const stateOf = (n: DateNode): "all" | "some" | "none" => {
    const leaves = leavesOf(n);
    const on = leaves.filter((l) => ticked.has(groupKey(l.group))).length;
    return on === 0 ? "none" : on === leaves.length ? "all" : "some";
  };
  const set = (n: DateNode, on: boolean) => {
    const next = new Set(ticked);
    for (const l of leavesOf(n)) {
      if (on) next.add(groupKey(l.group));
      else next.delete(groupKey(l.group));
    }
    onTicked(next);
  };
  const toggleOpen = (key: string) =>
    setOpen((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const row = (n: DateNode, depth: number) => {
    if (q && !matches(n, q)) return null;
    const key = groupKey(n.group);
    const expanded = q ? true : open.has(key);
    return (
      <li key={key} role="treeitem" aria-expanded={n.children.length ? expanded : undefined} aria-level={depth + 1}>
        <label style={{ paddingLeft: `${depth * 1.1 + (n.children.length ? 0 : 1.1)}rem` }}>
          {n.children.length > 0 && (
            <button type="button" className="pli-grid-filtertoggle" aria-label={`${expanded ? "Collapse" : "Expand"} ${n.title}`} onClick={(e) => { e.preventDefault(); toggleOpen(key); }}>
              {expanded ? "▾" : "▸"}
            </button>
          )}
          <Box state={stateOf(n)} label={n.title} onChange={(on) => set(n, on)} />
          <span className="pli-grid-filtervalue">{n.label}</span>
          <span className="pli-grid-filtercount">{n.count}</span>
        </label>
        {expanded && n.children.length > 0 && <ul role="group">{n.children.map((c) => row(c, depth + 1))}</ul>}
      </li>
    );
  };
  const otherRows = tree.others.filter((o) => (o.value === "" ? "(blanks)" : o.value).toLowerCase().includes(q));
  const shown = tree.nodes.map((n) => row(n, 0)).filter(Boolean);
  return (
    <ul className="pli-grid-filterlist pli-grid-filtertree" role="tree" aria-label="Dates">
      {shown}
      {otherRows.map((o) => (
        <li key={`other:${o.value}`} role="treeitem">
          <label>
            <input
              type="checkbox"
              checked={others.has(o.value)}
              onChange={() => {
                const next = new Set(others);
                if (next.has(o.value)) next.delete(o.value);
                else next.add(o.value);
                onOthers(next);
              }}
            />
            <span className="pli-grid-filtervalue">{o.value === "" ? "(Blanks)" : o.value}</span>
            <span className="pli-grid-filtercount">{o.count}</span>
          </label>
        </li>
      ))}
      {shown.length === 0 && otherRows.length === 0 && <li className="pli-grid-filterempty">No matches</li>}
    </ul>
  );
}
