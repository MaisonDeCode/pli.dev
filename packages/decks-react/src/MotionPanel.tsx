import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { keepFocus } from "@pli.dev/react";
import {
  ANIMATION_LABELS,
  KINDS_BY_CLASS,
  hasDirection,
  makeAnimation,
  type Animation,
  type AnimationClass,
  type AnimationEasing,
  type AnimationKind,
  type AnimationTrigger,
  type DeckSession,
  type ResolvedElement,
  type Scene,
} from "@pli.dev/decks";
import { SidePanel } from "./panels";
import { DeckIcons as I } from "./icons";
import { addAnimations, describeAnimation, elementLabel, seconds } from "./motion";

export const CLASS_LABELS: Record<AnimationClass, string> = { entrance: "Entrance", emphasis: "Emphasis", exit: "Exit" };
export const TRIGGER_LABELS: Record<AnimationTrigger, string> = { onClick: "On click", withPrevious: "With previous", afterPrevious: "After previous" };
const TRIGGER_BADGES: Record<AnimationTrigger, string> = { onClick: "Click", withPrevious: "With prev.", afterPrevious: "After prev." };
const EASING_LABELS: Record<AnimationEasing, string> = { linear: "Linear", easeIn: "Ease in", easeOut: "Ease out", easeInOut: "Ease in and out" };
const DEFAULT_KIND: Record<AnimationClass, AnimationKind> = { entrance: "fade", emphasis: "pulse", exit: "fade" };
const CLASS_ICONS = { entrance: I.animEntrance, emphasis: I.animEmphasis, exit: I.animExit } as const;

/** Direction names for the kinds that come from, or go to, a side. */
function directionLabels(kind: AnimationKind, cls: AnimationClass): [Animation["direction"], string][] {
  const word = cls === "exit" ? "To" : "From";
  void kind;
  return [
    ["left", `${word} left`],
    ["right", `${word} right`],
    ["up", `${word} top`],
    ["down", `${word} bottom`],
  ];
}

type Patch = { [K in keyof Animation]?: Animation[K] | null };

/**
 * The patch that applies `change` to an animation and keeps it whole: the kind fits the class, a new kind starts from its own
 * defaults (spin 360°, a motion path…), and settings the kind has no use for are dropped.
 */
export function reshape(a: Animation, change: Patch): Patch {
  const next: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(change)) {
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  return reshapeTo(a, next as unknown as Animation);
}

function reshapeTo(a: Animation, next: Animation): Patch {
  if (!KINDS_BY_CLASS[next.class].includes(next.kind)) next.kind = DEFAULT_KIND[next.class];
  if (next.kind !== a.kind) {
    delete next.amount;
    delete next.direction;
    delete next.path;
    if (next.kind === "appear") next.duration = 0;
    else if (a.kind === "appear" && next.duration === 0) delete next.duration;
  }
  if (next.class === "emphasis") delete next.text;
  if (next.kind !== "motion") delete next.path;
  if (!hasDirection(next.kind)) delete next.direction;
  if (next.kind !== "spin" && next.kind !== "grow" && next.kind !== "pulse") delete next.amount;
  const made = makeAnimation(next, a.id);
  const patch: Patch = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(made)]);
  for (const k of keys) {
    if (k === "id") continue;
    const before = (a as unknown as Record<string, unknown>)[k];
    const after = (made as unknown as Record<string, unknown>)[k];
    if (after === undefined) {
      if (before !== undefined) (patch as Record<string, unknown>)[k] = null;
    } else if (JSON.stringify(before) !== JSON.stringify(after)) (patch as Record<string, unknown>)[k] = after;
  }
  return patch;
}

function NumField({ label, value, onCommit, step = 1, min, max, disabled, format = (n) => String(n) }: { label: string; value: number; onCommit: (n: number) => void; step?: number; min?: number; max?: number; disabled?: boolean; format?: (n: number) => string }) {
  const [text, setText] = useState(format(value));
  useEffect(() => setText(format(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n !== value && (min === undefined || n >= min) && (max === undefined || n <= max)) onCommit(n);
    else setText(format(value));
  };
  return <input type="number" aria-label={label} step={step} min={min} max={max} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit())} />;
}

const hasText = (el: ResolvedElement | undefined) => !!el && el.kind === "shape" && !!el.text && el.text.paragraphs.some((p) => p.runs.some((r) => r.text !== ""));

export interface MotionPanelProps {
  session: DeckSession;
  slideId: string | null;
  scene: Scene | null;
  /** The elements selected on the slide: "Add animation" animates them. */
  selection: readonly string[];
  readOnly?: boolean;
  /** The selected animation. */
  active: string | null;
  onActive: (id: string | null) => void;
  /** A preview is playing on the canvas. */
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onTransition?: () => void;
  onClose: () => void;
}

/** Google Slides' Motion sidebar: the slide's transition and the list of object animations, with the settings of the selected one. */
export function MotionPanel({ session, slideId, scene, selection, readOnly, active, onActive, playing, onPlay, onStop, onTransition, onClose }: MotionPanelProps) {
  const list = slideId ? session.animations(slideId) : [];
  const slide = slideId ? session.deck.slides.find((s) => s.id === slideId) : undefined;
  const elements = (scene?.elements ?? []).filter((e) => e.from === "slide");
  const byId = new Map(elements.map((e) => [e.id, e]));
  const current = list.find((a) => a.id === active) ?? null;
  const currentIndex = current ? list.indexOf(current) : -1;
  const [error, setError] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const drag = useRef<{ id: string; from: number; to: number } | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const latest = useRef({ list, slideId, session });
  latest.current = { list, slideId, session };

  useEffect(() => setError(""), [slideId, active]);

  const attempt = (fn: () => void) => {
    if (readOnly) return;
    try {
      fn();
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const add = () =>
    attempt(() => {
      if (!slideId) return;
      const made = addAnimations(session, slideId, selection.filter((id) => byId.has(id)));
      if (made.length) onActive(made[made.length - 1]!.id);
    });
  const remove = (id: string) =>
    attempt(() => {
      if (!slideId) return;
      const at = list.findIndex((a) => a.id === id);
      session.removeAnimations(slideId, [id]);
      const rest = list.filter((a) => a.id !== id);
      onActive(rest[Math.min(at, rest.length - 1)]?.id ?? null);
    });
  const move = (id: string, to: "up" | "down" | number) => attempt(() => slideId && session.moveAnimation(slideId, id, to));
  const duplicate = (id: string) =>
    attempt(() => {
      const src = list.find((a) => a.id === id);
      if (!slideId || !src) return;
      const { id: _id, ...rest } = JSON.parse(JSON.stringify(src)) as Animation;
      const made = session.addAnimation(slideId, rest, list.indexOf(src) + 1);
      onActive(made.id);
    });
  const update = (id: string, change: Patch) =>
    attempt(() => {
      if (!slideId) return;
      const a = session.animations(slideId).find((x) => x.id === id);
      if (!a) return;
      const patch = reshape(a, change);
      if (Object.keys(patch).length) session.updateAnimation(slideId, id, patch);
    });

  const onListKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (!list.length) return;
    const at = currentIndex;
    const mod = e.metaKey || e.ctrlKey;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (e.altKey || mod)) {
      handled();
      if (current) move(current.id, e.key === "ArrowUp" ? "up" : "down");
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      handled();
      onActive(list[Math.max(0, Math.min(list.length - 1, at + (e.key === "ArrowUp" ? -1 : 1)))]!.id);
    } else if (e.key === "Home" || e.key === "End") {
      handled();
      onActive(list[e.key === "Home" ? 0 : list.length - 1]!.id);
    } else if ((e.key === "Delete" || e.key === "Backspace") && current && !readOnly) {
      handled();
      remove(current.id);
    } else if (mod && e.key.toLowerCase() === "d" && current && !readOnly) {
      handled();
      duplicate(current.id);
    }
  };

  // ---- Dragging a row to a new place ----

  const slotFor = (clientY: number, dragged: string) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-animation]") ?? [])].filter((r) => r.dataset.animation !== dragged);
    let n = 0;
    for (const r of rows) {
      const box = r.getBoundingClientRect();
      if (clientY > box.top + box.height / 2) n++;
    }
    return n;
  };
  const onGrip = (e: ReactPointerEvent, id: string, index: number) => {
    if (readOnly || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    drag.current = { id, from: index, to: index };
    onActive(id);
  };
  useEffect(() => {
    const moveTo = (e: PointerEvent | MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      d.to = slotFor(e.clientY, d.id);
      setDropAt(d.to);
    };
    const up = () => {
      const d = drag.current;
      drag.current = null;
      setDropAt(null);
      if (!d || d.to === d.from) return;
      const { session: s, slideId: sid } = latest.current;
      if (!sid) return;
      try {
        s.moveAnimation(sid, d.id, d.to);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    window.addEventListener("pointermove", moveTo as EventListener);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", moveTo as EventListener);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const transition = slide?.transition;
  const target = current ? byId.get(current.target) : undefined;
  const canAdd = !readOnly && !!slideId && selection.some((id) => byId.has(id));
  const dis = !!readOnly;

  return (
    <SidePanel title="Motion" onClose={onClose} className="pli-deck-motion-panel">
      {!slideId ? (
        <p className="pli-deck-empty">Pick a slide.</p>
      ) : (
        <>
          <section className="pli-deck-section" aria-label="Slide transition">
            <h3>Slide transition</h3>
            <div className="pli-deck-row">
              <span className="pli-deck-muted" data-testid="motion-transition">{transition && transition.type !== "none" ? `${transition.type[0]!.toUpperCase()}${transition.type.slice(1)}` : "None"}</span>
              {onTransition && <button type="button" className="pli-button" onClick={onTransition}>Edit transition…</button>}
            </div>
          </section>
          <section className="pli-deck-section" aria-label="Object animations">
            <h3>Object animations</h3>
            {list.length === 0 ? (
              <p className="pli-deck-empty">{readOnly ? "This slide has no animations." : "No animations yet. Select an object on the slide, then add an animation."}</p>
            ) : (
              <ul ref={listRef} className="pli-deck-anim-list" role="listbox" aria-label="Animations" aria-activedescendant={current ? `anim-${current.id}` : undefined} tabIndex={0} onKeyDown={onListKey}>
                {list.map((a, i) => {
                  const el = byId.get(a.target);
                  return (
                    <li
                      key={a.id}
                      id={`anim-${a.id}`}
                      role="option"
                      aria-selected={a.id === current?.id}
                      aria-label={`Animation ${i + 1}: ${describeAnimation(a)}, ${el ? elementLabel(el) : "missing object"}, ${TRIGGER_LABELS[a.trigger ?? "onClick"].toLowerCase()}`}
                      className="pli-deck-anim-row"
                      data-animation={a.id}
                      data-class={a.class}
                      data-selected={a.id === current?.id ? "" : undefined}
                      onClick={() => onActive(a.id)}
                    >
                      <span className="pli-deck-anim-index" aria-hidden="true">{i + 1}</span>
                      <span className="pli-deck-anim-icon" data-class={a.class} title={CLASS_LABELS[a.class]} aria-hidden="true">{CLASS_ICONS[a.class]}</span>
                      <span className="pli-deck-anim-text" aria-hidden="true">
                        <span className="pli-deck-anim-target">{el ? elementLabel(el) : "(missing object)"}</span>
                        <span className="pli-deck-anim-kind">{describeAnimation(a)}</span>
                      </span>
                      <span className="pli-deck-anim-trigger" data-trigger={a.trigger ?? "onClick"} aria-hidden="true">{TRIGGER_BADGES[a.trigger ?? "onClick"]}</span>
                      <span className="pli-deck-anim-duration" aria-hidden="true">{a.kind === "appear" ? "" : seconds(a.duration, 500)}</span>
                      {!readOnly && (
                        <span className="pli-deck-anim-grip" role="presentation" aria-hidden="true" title="Drag to reorder" onPointerDown={(e) => onGrip(e, a.id, i)}>{I.grip}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {dropAt !== null && <span className="pli-deck-muted" role="status" data-drop-index={dropAt}>Move to position {dropAt + 1}</span>}
            <div className="pli-deck-panel-actions" role="group" aria-label="Animation actions">
              <button type="button" className="pli-button pli-button-primary" disabled={!canAdd} title={canAdd ? undefined : "Select an object on the slide first"} onMouseDown={keepFocus} onClick={add}>{I.plus} Add animation</button>
              <button type="button" className="pli-tool" aria-label="Move animation up" title="Move up (Alt+Up)" disabled={dis || !current || currentIndex <= 0} onMouseDown={keepFocus} onClick={() => current && move(current.id, "up")}>{I.up}</button>
              <button type="button" className="pli-tool" aria-label="Move animation down" title="Move down (Alt+Down)" disabled={dis || !current || currentIndex >= list.length - 1} onMouseDown={keepFocus} onClick={() => current && move(current.id, "down")}>{I.down}</button>
              <button type="button" className="pli-tool" aria-label="Duplicate animation" title="Duplicate" disabled={dis || !current} onMouseDown={keepFocus} onClick={() => current && duplicate(current.id)}>{I.copy}</button>
              <button type="button" className="pli-tool" aria-label="Remove animation" title="Remove (Delete)" disabled={dis || !current} onMouseDown={keepFocus} onClick={() => current && remove(current.id)}>{I.trash}</button>
            </div>
            {error && <p role="alert" className="pli-deck-error">{error}</p>}
          </section>

          {current && (
            <section className="pli-deck-section pli-deck-anim-settings" aria-label="Animation settings">
              <h3>Animation {currentIndex + 1}</h3>
              <label className="pli-field-row">
                <span>Object</span>
                <select aria-label="Animation target" value={current.target} disabled={dis} onChange={(e) => update(current.id, { target: e.target.value })}>
                  {elements.map((el) => <option key={el.id} value={el.id}>{elementLabel(el)}</option>)}
                  {!target && <option value={current.target}>(missing object)</option>}
                </select>
              </label>
              <label className="pli-field-row">
                <span>Type</span>
                <select aria-label="Animation class" value={current.class} disabled={dis} onChange={(e) => update(current.id, { class: e.target.value as AnimationClass })}>
                  {(Object.keys(CLASS_LABELS) as AnimationClass[]).map((c) => <option key={c} value={c}>{CLASS_LABELS[c]}</option>)}
                </select>
              </label>
              <label className="pli-field-row">
                <span>Effect</span>
                <select aria-label="Animation effect" value={current.kind} disabled={dis} onChange={(e) => update(current.id, { kind: e.target.value as AnimationKind })}>
                  {KINDS_BY_CLASS[current.class].map((k) => <option key={k} value={k}>{ANIMATION_LABELS[k]}</option>)}
                </select>
              </label>
              {hasDirection(current.kind) && (
                <label className="pli-field-row">
                  <span>Direction</span>
                  <select aria-label="Animation direction" value={current.direction ?? (current.kind === "fly" ? "down" : "left")} disabled={dis} onChange={(e) => update(current.id, { direction: e.target.value as Animation["direction"] })}>
                    {directionLabels(current.kind, current.class).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              )}
              {current.kind === "spin" && (
                <label className="pli-field-row">
                  <span>Rotation (degrees)</span>
                  <NumField label="Animation rotation" value={current.amount ?? 360} step={15} disabled={dis} onCommit={(n) => update(current.id, { amount: n })} />
                </label>
              )}
              {current.kind === "grow" && (
                <label className="pli-field-row">
                  <span>Scale (× original size)</span>
                  <NumField label="Animation scale" value={current.amount ?? 1.5} step={0.1} min={0.1} max={10} disabled={dis} onCommit={(n) => update(current.id, { amount: n })} />
                </label>
              )}
              {current.kind === "pulse" && (
                <label className="pli-field-row">
                  <span>Pulse size (× original)</span>
                  <NumField label="Animation pulse size" value={current.amount ?? 1.1} step={0.05} min={0.1} max={10} disabled={dis} onCommit={(n) => update(current.id, { amount: n })} />
                </label>
              )}
              <label className="pli-field-row">
                <span>Start</span>
                <select aria-label="Animation start" value={current.trigger ?? "onClick"} disabled={dis} onChange={(e) => update(current.id, { trigger: e.target.value as AnimationTrigger })}>
                  {(Object.keys(TRIGGER_LABELS) as AnimationTrigger[]).map((t) => <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>)}
                </select>
              </label>
              {current.kind !== "appear" && (
                <label className="pli-field-row">
                  <span>Duration (seconds)</span>
                  <NumField label="Animation duration" value={(current.duration ?? 500) / 1000} step={0.1} min={0.05} max={60} disabled={dis} onCommit={(n) => update(current.id, { duration: Math.round(n * 1000) })} />
                </label>
              )}
              <label className="pli-field-row">
                <span>Delay (seconds)</span>
                <NumField label="Animation delay" value={(current.delay ?? 0) / 1000} step={0.1} min={0} max={60} disabled={dis} onCommit={(n) => update(current.id, { delay: n > 0 ? Math.round(n * 1000) : null })} />
              </label>
              {current.kind !== "appear" && (
                <>
                  <label className="pli-field-row">
                    <span>Speed curve</span>
                    <select aria-label="Animation easing" value={current.easing ?? "linear"} disabled={dis} onChange={(e) => update(current.id, { easing: e.target.value === "linear" ? null : (e.target.value as AnimationEasing) })}>
                      {(Object.keys(EASING_LABELS) as AnimationEasing[]).map((k) => <option key={k} value={k}>{EASING_LABELS[k]}</option>)}
                    </select>
                  </label>
                  <label className="pli-field-row">
                    <span>Repeat (times)</span>
                    <NumField label="Animation repeat" value={current.repeat ?? 1} step={1} min={1} max={100} disabled={dis} onCommit={(n) => update(current.id, { repeat: n > 1 ? Math.round(n) : null })} />
                  </label>
                </>
              )}
              {current.class !== "emphasis" && hasText(target) && (
                <label className="pli-field-row">
                  <span>Text</span>
                  <select aria-label="Animation text build" value={current.text ?? "all"} disabled={dis} onChange={(e) => update(current.id, { text: e.target.value === "paragraph" ? "paragraph" : null })}>
                    <option value="all">All at once</option>
                    <option value="paragraph">By paragraph</option>
                  </select>
                </label>
              )}
              {current.kind === "motion" && <PathEditor a={current} disabled={dis} onChange={(path) => update(current.id, { path })} />}
            </section>
          )}

          <div className="pli-deck-panel-actions pli-deck-anim-play">
            {playing ? (
              <button type="button" className="pli-button" aria-label="Stop preview" onMouseDown={keepFocus} onClick={onStop}>Stop</button>
            ) : (
              <button type="button" className="pli-button" aria-label="Play animations" disabled={list.length === 0} onMouseDown={keepFocus} onClick={onPlay}>{I.play} Play</button>
            )}
          </div>
        </>
      )}
    </SidePanel>
  );
}

function PathEditor({ a, onChange, disabled }: { a: Animation; onChange: (path: { x: number; y: number }[]) => void; disabled: boolean }) {
  const path = a.path ?? [];
  const set = (i: number, patch: Partial<{ x: number; y: number }>) => onChange(path.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <fieldset className="pli-deck-anim-path">
      <legend>Path (points from where the object is)</legend>
      <ol aria-label="Motion path points">
        {path.map((p, i) => (
          <li key={i} className="pli-deck-anim-point">
            <span>{i === 0 ? "Start" : `Point ${i + 1}`}</span>
            {i === 0 ? (
              <span className="pli-deck-muted">0, 0</span>
            ) : (
              <>
                <NumField label={`Point ${i + 1} X`} value={p.x} step={5} disabled={disabled} onCommit={(x) => set(i, { x })} format={(n) => String(Math.round(n * 100) / 100)} />
                <NumField label={`Point ${i + 1} Y`} value={p.y} step={5} disabled={disabled} onCommit={(y) => set(i, { y })} format={(n) => String(Math.round(n * 100) / 100)} />
                <button type="button" className="pli-tool" aria-label={`Remove point ${i + 1}`} disabled={disabled || path.length <= 2} onClick={() => onChange(path.filter((_, j) => j !== i))}>{I.minus}</button>
              </>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="pli-button" disabled={disabled} onClick={() => { const last = path[path.length - 1] ?? { x: 0, y: 0 }; onChange([...path, { x: last.x + 50, y: last.y }]); }}>{I.plus} Add point</button>
      <p className="pli-deck-muted">Drag the points on the slide too. Points are joined by straight lines.</p>
    </fieldset>
  );
}
