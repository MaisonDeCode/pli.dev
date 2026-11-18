import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ColorPicker, FilePickerContext, FontPicker, keepFocus, pickWith } from "@pli.dev/react";
import {
  THEME_SLOTS,
  createDeck,
  resolveSlide,
  slideFromLayout,
  type DeckSession,
  type Master,
  type ResolvedElement,
  type Scene,
  type SlideSize,
  type ThemeSlot,
  type Transition,
  type TransitionType,
} from "@pli.dev/decks";
import { SlideView } from "./SlideView";
import { DeckIcons as I } from "./icons";
import { builtinThemeMaster, builtinThemes, canImportTemplate, importTemplate, type ImportedTemplate } from "./engine";
import { readBytes } from "./actions";
import * as cmd from "./commands";
import type { CommandContext } from "./commands";

export function SidePanel({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <aside className={className ? `pli-deck-panel ${className}` : "pli-deck-panel"} role="complementary" aria-label={title}>
      <header className="pli-deck-panel-head">
        <h2>{title}</h2>
        <button type="button" className="pli-tool" aria-label={`Close ${title.toLowerCase()} panel`} onMouseDown={keepFocus} onClick={onClose}>{I.close}</button>
      </header>
      <div className="pli-deck-panel-body">{children}</div>
    </aside>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="pli-deck-section">
    <h3>{title}</h3>
    {children}
  </section>
);

// ---- Themes ----------------------------------------------------------------------------------------------------------

const SAMPLE: Record<string, string> = { title: "Title", ctrTitle: "Title", subTitle: "Subtitle", body: "Text" };

/** A small sample of a master: a slide on one of its layouts with a few words in its placeholders. */
export function masterScene(master: Master, size: SlideSize, layoutKind?: string, layoutId?: string): Scene {
  const deck = createDeck({ master, size, firstSlide: false });
  const layout = master.layouts.find((l) => l.id === layoutId) ?? master.layouts.find((l) => l.kind === layoutKind) ?? master.layouts[0]!;
  const slide = slideFromLayout(layout);
  slide.elements = slide.elements.map((e) => (e.type === "shape" && e.placeholder ? { ...e, text: { paragraphs: [{ runs: [{ text: layoutId ? (e.placeholder.type.includes("itle") ? layout.name : "") : (SAMPLE[e.placeholder.type] ?? "Text") }] }] } } : e));
  deck.slides.push(slide);
  return resolveSlide(deck, slide);
}

const THEME_ACCEPT = ".pptx,.potx,.ppt,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.presentationml.template";

const SLOT_LABEL: Record<ThemeSlot, string> = {
  dk1: "Text (dark 1)",
  lt1: "Background (light 1)",
  dk2: "Dark 2",
  lt2: "Light 2",
  accent1: "Accent 1",
  accent2: "Accent 2",
  accent3: "Accent 3",
  accent4: "Accent 4",
  accent5: "Accent 5",
  accent6: "Accent 6",
  hlink: "Link",
  folHlink: "Followed link",
};

/** `masterId` is the master the colours and fonts belong to (the shown slide's); it defaults to the first. */
export function ThemePanel({ session, onClose, onEditTheme, readOnly, masterId }: { session: DeckSession; onClose: () => void; onEditTheme: () => void; readOnly?: boolean; masterId?: string }) {
  const deck = session.deck;
  const master = deck.masters.find((m) => m.id === masterId) ?? deck.masters[0]!;
  const themes = useMemo(() => builtinThemes(), []);
  const [imported, setImported] = useState<ImportedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useContext(FilePickerContext);
  const burst = useRef(false);
  useEffect(() => {
    burst.current = false;
  }, [master.id]);

  const apply = (m: Master | undefined) => {
    if (!m || readOnly) return;
    session.applyTheme(m);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const t = await importTemplate(await readBytes(file));
      if (t.masters.length === 0) setError("No theme was found in that file.");
      setImported(t);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setColor = (slot: ThemeSlot, value: string) => {
    session.setTheme(master.id, { colors: { [slot]: value } as Record<ThemeSlot, string> }, { merge: burst.current });
    burst.current = true;
  };

  return (
    <SidePanel title="Themes" onClose={onClose} className="pli-deck-theme-panel">
      <Section title="In this presentation">
        <div className="pli-deck-current-theme">
          <SlideView scene={masterScene(master, deck.size, "title")} scale={96 / deck.size.width} />
          <div>
            <strong>{master.theme.name || master.name}</strong>
            <button type="button" className="pli-button" disabled={readOnly} onClick={onEditTheme}>Edit master</button>
          </div>
        </div>
      </Section>
      <Section title="Theme gallery">
        {themes.length === 0 ? (
          <p className="pli-deck-empty">No built-in themes are available.</p>
        ) : (
          <div className="pli-deck-theme-grid" role="listbox" aria-label="Themes">
            {themes.map((t) => {
              const m = builtinThemeMaster(t.id, deck.size);
              return (
                <button key={t.id} type="button" role="option" aria-selected={master.name === t.name} className="pli-deck-theme-card" data-theme-id={t.id} disabled={readOnly || !m} title={t.name} onClick={() => apply(m)}>
                  {m && <SlideView scene={masterScene(m, deck.size, "title")} scale={104 / deck.size.width} />}
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </Section>
      <Section title="Import theme">
        {picker ? (
          <button type="button" className="pli-button" disabled={readOnly || busy || !canImportTemplate} onClick={() => void pickWith(picker, { purpose: "import", accept: THEME_ACCEPT, multiple: false, label: "Import a theme from a PowerPoint or Google Slides file" }).then((files) => onFile(files[0]), (e) => setError((e as Error).message))}>
            Import theme…
          </button>
        ) : (
          <label className="pli-button pli-deck-file-button" aria-disabled={readOnly || !canImportTemplate}>
            Import theme…
            <input type="file" accept={THEME_ACCEPT} aria-label="Import theme from a PowerPoint or Google Slides file" disabled={readOnly || busy} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        )}
        {!canImportTemplate && <p className="pli-deck-empty">Importing themes isn't available in this build.</p>}
        {busy && <p role="status">Reading the file…</p>}
        {error && <p role="alert" className="pli-deck-error">{error}</p>}
        {imported && imported.warnings.length > 0 && (
          <ul className="pli-deck-warnings" aria-label="Import notes">
            {imported.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        {imported?.masters.map((m) => (
          <div key={m.id} className="pli-deck-imported" data-master={m.id}>
            <div className="pli-deck-imported-head">
              <strong>{m.name || m.theme.name}</strong>
              <span className="pli-deck-imported-actions">
                <button type="button" className="pli-button pli-button-primary" disabled={readOnly} onClick={() => { apply(m); setImported(null); }}>Use this theme</button>
                <button type="button" className="pli-button" disabled={readOnly} title="Keep the current master and add this one beside it" onClick={() => { if (!readOnly) session.addMaster(m); }}>Add as master</button>
              </span>
            </div>
            <div className="pli-deck-imported-layouts" aria-label={`Layouts of ${m.name}`}>
              {m.layouts.map((l) => (
                <figure key={l.id} className="pli-deck-imported-layout">
                  <SlideView scene={masterScene(m, imported.size ?? deck.size, undefined, l.id)} scale={80 / (imported.size ?? deck.size).width} />
                  <figcaption>{l.name}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        ))}
      </Section>
      <Section title="Colors">
        <div className="pli-deck-colors" role="group" aria-label="Theme colors">
          {THEME_SLOTS.map((slot) => (
            <label key={slot} className="pli-deck-color-row" data-slot={slot}>
              <span className="pli-deck-swatch" style={{ background: master.theme.colors[slot] }}>
                <input type="color" aria-label={SLOT_LABEL[slot]} value={master.theme.colors[slot]} disabled={readOnly} onChange={(e) => setColor(slot, e.target.value)} onBlur={() => (burst.current = false)} />
              </span>
              <span className="pli-deck-color-name">{SLOT_LABEL[slot]}</span>
              <code className="pli-deck-color-hex">{master.theme.colors[slot].toUpperCase()}</code>
            </label>
          ))}
        </div>
      </Section>
      <Section title="Fonts">
        <div className="pli-field-row pli-deck-font-row">
          <span>Headings</span>
          <FontPicker label="Heading font" value={master.theme.fonts.major} disabled={readOnly} onChange={(f) => f && session.setTheme(master.id, { fonts: { major: f, minor: master.theme.fonts.minor } })} />
        </div>
        <div className="pli-field-row pli-deck-font-row">
          <span>Body</span>
          <FontPicker label="Body font" value={master.theme.fonts.minor} disabled={readOnly} onChange={(f) => f && session.setTheme(master.id, { fonts: { major: master.theme.fonts.major, minor: f } })} />
        </div>
      </Section>
    </SidePanel>
  );
}

// ---- Transitions -----------------------------------------------------------------------------------------------------

export const TRANSITIONS: { type: TransitionType; label: string; directional: boolean }[] = [
  { type: "none", label: "None", directional: false },
  { type: "fade", label: "Fade", directional: false },
  { type: "dissolve", label: "Dissolve", directional: false },
  { type: "slide", label: "Slide in", directional: true },
  { type: "push", label: "Push", directional: true },
  { type: "wipe", label: "Wipe", directional: true },
  { type: "flip", label: "Flip", directional: true },
  { type: "cube", label: "Cube", directional: true },
  { type: "gallery", label: "Gallery", directional: true },
  { type: "zoom", label: "Zoom", directional: false },
];

export function TransitionPanel({ session, slideIds, onClose, onPlay, readOnly }: { session: DeckSession; slideIds: readonly string[]; onClose: () => void; onPlay?: () => void; readOnly?: boolean }) {
  const first = slideIds[0] ? session.deck.slides.find((s) => s.id === slideIds[0]) : undefined;
  const tr: Transition = first?.transition ?? { type: "none" };
  const spec = TRANSITIONS.find((t) => t.type === tr.type) ?? TRANSITIONS[0]!;
  const [duration, setDuration] = useState(tr.duration ?? 700);
  const [after, setAfter] = useState(tr.advanceAfter ? String(tr.advanceAfter / 1000) : "");
  useEffect(() => setDuration(tr.duration ?? 700), [tr.duration, first?.id]);
  useEffect(() => setAfter(tr.advanceAfter ? String(tr.advanceAfter / 1000) : ""), [tr.advanceAfter, first?.id]);
  const set = (patch: Partial<Transition>, ids: readonly string[] = slideIds) => {
    if (readOnly || ids.length === 0) return;
    const next: Transition = { ...tr, ...patch };
    // keep the advance timer even when the type goes to none
    session.setTransition(ids, next.type === "none" && !next.advanceAfter ? null : next);
  };
  const commitAfter = () => {
    const n = Number(after);
    set({ advanceAfter: after.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : undefined });
  };
  return (
    <SidePanel title="Transition" onClose={onClose} className="pli-deck-transition-panel">
      {!first ? (
        <p className="pli-deck-empty">Pick a slide.</p>
      ) : (
        <>
          <p className="pli-deck-muted">{slideIds.length > 1 ? `${slideIds.length} slides selected` : "Slide transition"}</p>
          <label className="pli-field-row">
            <span>Type</span>
            <select aria-label="Transition type" value={tr.type} disabled={readOnly} onChange={(e) => set({ type: e.target.value as TransitionType, direction: TRANSITIONS.find((t) => t.type === e.target.value)?.directional ? (tr.direction ?? "right") : undefined })}>
              {TRANSITIONS.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
          </label>
          {spec.directional && (
            <label className="pli-field-row">
              <span>Direction</span>
              <select aria-label="Transition direction" value={tr.direction ?? "right"} disabled={readOnly} onChange={(e) => set({ direction: e.target.value as Transition["direction"] })}>
                {[["right", "From right"], ["left", "From left"], ["up", "From bottom"], ["down", "From top"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
          {tr.type !== "none" && (
            <label className="pli-field-row">
              <span>Speed</span>
              <span className="pli-slider-row">
                <input type="range" aria-label="Transition duration" min={100} max={3000} step={50} value={duration} disabled={readOnly} onChange={(e) => setDuration(Number(e.target.value))} onPointerUp={() => set({ duration })} onKeyUp={() => set({ duration })} onBlur={() => duration !== (tr.duration ?? 700) && set({ duration })} />
                <output>{(duration / 1000).toFixed(2)} s</output>
              </span>
            </label>
          )}
          <label className="pli-field-row">
            <span>Advance after (seconds)</span>
            <input type="number" min={0} step={0.5} aria-label="Advance after seconds" placeholder="On click" value={after} disabled={readOnly} onChange={(e) => setAfter(e.target.value)} onBlur={commitAfter} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitAfter())} />
          </label>
          <div className="pli-deck-panel-actions">
            <button type="button" className="pli-button" disabled={readOnly} onClick={() => set(tr, session.deck.slides.map((s) => s.id))}>Apply to all slides</button>
            {onPlay && <button type="button" className="pli-button" onClick={onPlay}>Play</button>}
          </div>
        </>
      )}
    </SidePanel>
  );
}

// ---- Format options --------------------------------------------------------------------------------------------------

function NumberField({ label, value, onCommit, step = 1, disabled }: { label: string; value: number; onCommit: (n: number) => void; step?: number; disabled?: boolean }) {
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n !== round(value)) onCommit(n);
    else setText(String(round(value)));
  };
  return (
    <label className="pli-deck-num">
      <span>{label}</span>
      <input type="number" step={step} aria-label={label} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />
    </label>
  );
}
const round = (n: number) => Math.round(n * 100) / 100;

export function FormatPanel({ session, owner, ctx, selection, onClose, readOnly, onChartOptions }: { session: DeckSession; owner: string; ctx: CommandContext; selection: ResolvedElement[]; onClose: () => void; readOnly?: boolean; onChartOptions?: () => void }) {
  const el = selection[0];
  const [alt, setAlt] = useState(el?.alt ?? "");
  useEffect(() => setAlt(el?.alt ?? ""), [el?.id, el?.alt]);
  return (
    <SidePanel title="Format options" onClose={onClose} className="pli-deck-format-panel">
      {!el ? (
        <p className="pli-deck-empty">Select something on the slide.</p>
      ) : (
        <>
          <Section title="Size and position">
            <div className="pli-deck-num-grid">
              <NumberField label="X (pt)" value={el.x} disabled={readOnly} onCommit={(x) => session.setFrame(owner, el.id, { x })} />
              <NumberField label="Y (pt)" value={el.y} disabled={readOnly} onCommit={(y) => session.setFrame(owner, el.id, { y })} />
              <NumberField label="Width (pt)" value={el.w} disabled={readOnly || el.kind === "table"} onCommit={(w) => session.setFrame(owner, el.id, { w: Math.max(1, w) })} />
              <NumberField label="Height (pt)" value={el.h} disabled={readOnly || el.kind === "table"} onCommit={(h) => session.setFrame(owner, el.id, { h: Math.max(0, h) })} />
              <NumberField label="Rotation (°)" value={el.rotation} disabled={readOnly} onCommit={(r) => session.setFrame(owner, el.id, { rotation: ((r % 360) + 360) % 360 })} />
            </div>
            <div className="pli-deck-panel-actions">
              <button type="button" className="pli-button" disabled={readOnly} onClick={() => cmd.flip(ctx, "h")}>Flip horizontal</button>
              <button type="button" className="pli-button" disabled={readOnly} onClick={() => cmd.flip(ctx, "v")}>Flip vertical</button>
            </div>
          </Section>
          {el.kind === "chart" && (
            <Section title="Chart">
              <div className="pli-deck-panel-actions">
                <button type="button" className="pli-button" disabled={readOnly || !onChartOptions} onClick={onChartOptions}>Chart options…</button>
              </div>
            </Section>
          )}
          {(el.kind === "shape" || el.kind === "table") && (
            <Section title="Fill">
              <div className="pli-deck-row">
                <ColorPicker label="Fill color" value={el.fill.kind === "solid" ? el.fill.color : undefined} icon={I.fill} noneLabel="Transparent" onChange={(c) => cmd.setFill(ctx, c)} />
                <span className="pli-deck-muted">{el.fill.kind === "solid" ? el.fill.color : el.fill.kind === "none" ? "No fill" : el.fill.kind}</span>
              </div>
            </Section>
          )}
          {(el.kind === "shape" || el.kind === "image") && (
            <Section title="Line">
              <div className="pli-deck-row">
                <ColorPicker label="Border color" value={el.line?.color} icon={I.borderColor} noneLabel="Transparent" onChange={(c) => (c === null ? cmd.setLine(ctx, null) : cmd.setLine(ctx, { color: c }))} />
                <NumberField label="Weight (pt)" value={el.line?.width ?? 0} step={0.5} disabled={readOnly} onCommit={(w) => (w <= 0 ? cmd.setLine(ctx, null) : cmd.setLine(ctx, { width: w }))} />
                <select aria-label="Dash style" value={el.line?.dash ?? "solid"} disabled={readOnly || !el.line} onChange={(e) => cmd.setLine(ctx, { dash: e.target.value as "solid" })}>
                  {["solid", "dot", "dash", "dashDot", "longDash"].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <label className="pli-checkbox-row">
                <input type="checkbox" checked={!!el.shadow} disabled={readOnly} onChange={(e) => cmd.setShadow(ctx, e.target.checked)} />
                <span>Drop shadow</span>
              </label>
            </Section>
          )}
          <Section title="Alt text">
            <textarea aria-label="Alt text" rows={3} value={alt} disabled={readOnly} placeholder="Describe this for people who can't see it" onChange={(e) => setAlt(e.target.value)} onBlur={() => alt !== (el.alt ?? "") && cmd.setAlt(ctx, alt)} />
          </Section>
        </>
      )}
    </SidePanel>
  );
}
