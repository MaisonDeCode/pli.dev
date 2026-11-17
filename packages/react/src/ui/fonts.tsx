import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { defaultFonts, type FontCategory, type FontFamily, type FontRegistry } from "@pli.dev/core";
import { Dropdown } from "./primitives";
import { Icons } from "./icons";

// ---- Which registry an editor uses -----------------------------------------------------------------------------------

const FontsContext = createContext<FontRegistry | null>(null);

/**
 * Gives every editor and picker inside it one `FontRegistry` (the editors also take a `fonts` prop, which wins). Without
 * a provider or a prop, editors use `defaultFonts()` from `@pli.dev/core`.
 */
export function FontsProvider({ fonts, children }: { fonts: FontRegistry; children: ReactNode }) {
  return <FontsContext.Provider value={fonts}>{children}</FontsContext.Provider>;
}

/** The registry for this part of the page: the given one, the provider's, or the shared default. */
export function useFonts(explicit?: FontRegistry): FontRegistry {
  const inherited = useContext(FontsContext);
  return explicit ?? inherited ?? defaultFonts();
}

/**
 * A number that changes whenever a font in the registry loads, fails or is used: put it in a dependency list (or
 * read it during render) to measure and draw text again once a font has arrived.
 */
export function useFontsVersion(fonts: FontRegistry): number {
  return useSyncExternalStore(fonts.subscribe, fonts.version, fonts.version);
}

/**
 * Starts loading the families a document uses (and loads others when they are added), so text is drawn in them and
 * measured again when they arrive. Returns the registry's version, which changes each time.
 */
export function useDocumentFonts(fonts: FontRegistry, families: readonly string[], text?: string): number {
  const key = [...new Set(families)].sort().join("\u0000");
  useEffect(() => {
    if (key) void fonts.loadAll(key.split("\u0000"), text ? { text } : undefined);
  }, [fonts, key, text]);
  return useFontsVersion(fonts);
}

// ---- The picker ---------------------------------------------------------------------------------------------------------

const ROW = 30;
const SHOWN = 9;
const CATEGORIES: { value: FontCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sans-serif", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "monospace", label: "Mono" },
  { value: "display", label: "Display" },
  { value: "handwriting", label: "Script" },
];

type Row = { kind: "header"; text: string } | { kind: "font"; font: FontFamily } | { kind: "default"; label: string } | { kind: "empty"; text: string };

export interface FontPickerProps {
  /** Defaults to the provider's, or the shared default registry. */
  fonts?: FontRegistry;
  /** The family in use, as the document stores it (any name, even one the registry doesn't offer). */
  value: string | undefined;
  /** More than one font is selected. */
  mixed?: boolean;
  /** Called with a family's name, or `null` for the default entry (see `defaultLabel`). */
  onChange: (family: string | null) => void;
  disabled?: boolean;
  /** Adds an entry at the top that calls `onChange(null)`, such as "Default"; it is what `value: undefined` shows. */
  defaultLabel?: string;
  /** The accessible name of the button. Default "Font". */
  label?: string;
  className?: string;
}

/**
 * A font chooser: a button showing the current font that opens a searchable list, with a filter by kind of font, the
 * fonts used last, and every name drawn in its own font (the files are fetched only for the names on screen, after the
 * scrolling stops). Works with the keyboard: type to search, arrows to move, Enter to choose.
 */
export function FontPicker({ fonts: given, value, mixed, onChange, disabled, defaultLabel, label = "Font", className }: FontPickerProps) {
  const fonts = useFonts(given);
  useFontsVersion(fonts);
  const current = value ? fonts.find(value)?.family ?? value : undefined;
  const shown = mixed ? "Mixed" : current ?? defaultLabel ?? "Default";
  const pick = (name: string | null) => {
    if (name) {
      fonts.use(name);
      void fonts.load(name);
    }
    onChange(name);
  };
  return (
    <Dropdown
      label={label}
      disabled={disabled}
      className={`pli-font-button${className ? ` ${className}` : ""}`}
      panel={(close) => <FontList fonts={fonts} value={current} defaultLabel={defaultLabel} onPick={(name) => { pick(name); close(); }} />}
    >
      <span className="pli-font-name" style={!mixed && current ? { fontFamily: fonts.stack(current) } : undefined} data-status={current ? fonts.status(current) : undefined}>{shown}</span>
      <span className="pli-select-chevron" aria-hidden="true">{Icons.chevron}</span>
    </Dropdown>
  );
}

function FontList({ fonts, value, defaultLabel, onPick }: { fonts: FontRegistry; value: string | undefined; defaultLabel: string | undefined; onPick: (name: string | null) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FontCategory | "all">("all");
  const [scroll, setScroll] = useState(0);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useFontsVersion(fonts);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const q = query.trim();
    if (q) {
      const lower = q.toLowerCase();
      const found = fonts.search({ query: q, category });
      // Names that start with the search come first.
      found.sort((a, b) => Number(b.family.toLowerCase().startsWith(lower)) - Number(a.family.toLowerCase().startsWith(lower)));
      if (found.length === 0) out.push({ kind: "empty", text: `No font matches “${q}”` });
      for (const font of found) out.push({ kind: "font", font });
      return out;
    }
    if (defaultLabel && category === "all") out.push({ kind: "default", label: defaultLabel });
    const list = fonts.search({ category });
    if (category === "all") {
      const recent = fonts.recent().map((n) => fonts.find(n)).filter((f): f is FontFamily => !!f && fonts.offers(f.family));
      if (recent.length) {
        out.push({ kind: "header", text: "Recent" });
        for (const font of recent) out.push({ kind: "font", font });
      }
    }
    const groups: [string, (f: FontFamily) => boolean][] = [
      ["Your fonts", (f) => f.origin === "custom"],
      ["Office and system fonts", (f) => f.origin === "system"],
      ["Google fonts", (f) => f.origin === "google"],
    ];
    for (const [text, test] of groups) {
      const part = list.filter(test);
      if (part.length === 0) continue;
      out.push({ kind: "header", text });
      for (const font of part) out.push({ kind: "font", font });
    }
    if (out.length === 0) out.push({ kind: "empty", text: "No fonts" });
    return out;
  }, [fonts, query, category, defaultLabel]);

  // Rows are drawn only for what is in view (there are two thousand), and fetched when the scrolling stops.
  const height = box.current?.clientHeight || ROW * SHOWN;
  const first = Math.max(0, Math.floor(scroll / ROW) - 3);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + 3);
  const visible = rows.slice(first, last);
  const visibleKey = visible.map((r) => (r.kind === "font" ? r.font.family : "")).join("|");
  useEffect(() => {
    const names = visibleKey.split("|").filter(Boolean);
    if (names.length === 0) return;
    const timer = setTimeout(() => {
      for (const name of names) void fonts.load(name, { text: name });
    }, 120);
    return () => clearTimeout(timer);
  }, [fonts, visibleKey]);

  const selectable = (i: number) => rows[i]?.kind === "font" || rows[i]?.kind === "default";
  const step = (from: number, dir: 1 | -1) => {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (selectable(i)) return i;
    return from;
  };
  useEffect(() => {
    // The chosen font, else the first one, is where the keyboard starts.
    const at = value ? rows.findIndex((r) => r.kind === "font" && r.font.family === value) : -1;
    const first = rows.findIndex((_, i) => selectable(i));
    setActive(query ? first : at >= 0 ? at : first);
    const top = at >= 0 && !query ? Math.max(0, at * ROW - ROW * 3) : 0;
    if (box.current) box.current.scrollTop = top;
    setScroll(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  useLayoutEffect(() => input.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (active * ROW < el.scrollTop) el.scrollTop = active * ROW;
    else if ((active + 1) * ROW > el.scrollTop + el.clientHeight && el.clientHeight > 0) el.scrollTop = (active + 1) * ROW - el.clientHeight;
  }, [active]);

  const choose = (row: Row | undefined) => {
    if (row?.kind === "font") onPick(row.font.family);
    else if (row?.kind === "default") onPick(null);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") (event.preventDefault(), setActive((a) => step(a, 1)));
    else if (event.key === "ArrowUp") (event.preventDefault(), setActive((a) => step(a, -1)));
    else if (event.key === "PageDown") (event.preventDefault(), setActive((a) => Array.from({ length: SHOWN }).reduce<number>((i) => step(i, 1), a)));
    else if (event.key === "PageUp") (event.preventDefault(), setActive((a) => Array.from({ length: SHOWN }).reduce<number>((i) => step(i, -1), a)));
    else if (event.key === "Home") (event.preventDefault(), setActive(step(-1, 1)));
    else if (event.key === "End") (event.preventDefault(), setActive(step(rows.length, -1)));
    else if (event.key === "Enter") (event.preventDefault(), choose(rows[active]));
  };

  return (
    <div className="pli-fonts" onKeyDown={onKey}>
      <input
        ref={input}
        type="text"
        className="pli-fonts-search"
        role="combobox"
        aria-label="Search fonts"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-activedescendant={selectable(active) ? `${id}-${active}` : undefined}
        placeholder="Search fonts"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="pli-fonts-kinds" role="group" aria-label="Kind of font">
        {CATEGORIES.map((c) => (
          <button key={c.value} type="button" className="pli-fonts-kind" aria-pressed={category === c.value} onClick={() => setCategory(c.value)}>
            {c.label}
          </button>
        ))}
      </div>
      <div ref={box} id={`${id}-list`} role="listbox" aria-label="Fonts" className="pli-fonts-list" style={{ height: ROW * SHOWN }} onScroll={(e) => setScroll(e.currentTarget.scrollTop)}>
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {visible.map((row, k) => {
            const i = first + k;
            const style = { position: "absolute" as const, top: i * ROW, height: ROW, left: 0, right: 0 };
            if (row.kind === "header") return <div key={`h${i}`} role="presentation" className="pli-fonts-header" style={style}>{row.text}</div>;
            if (row.kind === "empty") return <div key={`e${i}`} role="presentation" className="pli-fonts-empty" style={style}>{row.text}</div>;
            const name = row.kind === "default" ? row.label : row.font.family;
            const selected = row.kind === "default" ? value === undefined : row.font.family === value;
            return (
              <div
                key={`${i}-${name}`}
                id={`${id}-${i}`}
                role="option"
                aria-selected={selected}
                className="pli-fonts-item"
                data-active={i === active ? "" : undefined}
                data-status={row.kind === "font" ? fonts.status(row.font.family) : undefined}
                style={style}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => choose(row)}
              >
                <span className="pli-fonts-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                <span className="pli-fonts-sample" style={row.kind === "font" ? { fontFamily: fonts.stack(row.font.family) } : undefined}>{name}</span>
                {row.kind === "font" && <span className="pli-fonts-kindtag">{row.font.category === "sans-serif" ? "sans" : row.font.category === "handwriting" ? "script" : row.font.category === "monospace" ? "mono" : row.font.category}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
