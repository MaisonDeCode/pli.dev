import { useState } from "react";
import { Dialog } from "@pli.dev/react";
import { SLIDE_SIZES, plainText, type Deck, type Fill, type SlideSize } from "@pli.dev/decks";
import { readDataUri } from "./actions";

const SWATCHES = ["#ffffff", "#f1f3f4", "#fff8e1", "#e8f0fe", "#e6f4ea", "#fce8e6", "#202124", "#1a73e8", "#34a853", "#fbbc04", "#ea4335"];
const GRADIENTS: { label: string; fill: Fill }[] = [
  { label: "Blue to teal", fill: { gradient: { angle: 45, stops: [{ at: 0, color: "#4285f4" }, { at: 1, color: "#46bdc6" }] } } },
  { label: "Sunset", fill: { gradient: { angle: 90, stops: [{ at: 0, color: "#fbbc04" }, { at: 1, color: "#ea4335" }] } } },
  { label: "Night", fill: { gradient: { angle: 90, stops: [{ at: 0, color: "#202124" }, { at: 1, color: "#434343" }] } } },
  { label: "Spotlight", fill: { gradient: { kind: "radial", stops: [{ at: 0, color: "#ffffff" }, { at: 1, color: "#d2e3fc" }] } } },
];

export interface BackgroundDialogProps {
  current: Fill | undefined;
  onApply: (fill: Fill | null, all: boolean) => void;
  onClose: () => void;
}

export function BackgroundDialog({ current, onApply, onClose }: BackgroundDialogProps) {
  const [fill, setFill] = useState<Fill | null | undefined>(current);
  const [custom, setCustom] = useState(typeof current === "string" ? current : "#ffffff");
  const [error, setError] = useState("");
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setFill({ image: { src: await readDataUri(file) } });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Dialog
      open
      title="Background"
      onClose={onClose}
      onSubmit={() => {
        onApply(fill ?? null, false);
        onClose();
      }}
      actions={
        <>
          <button type="button" className="pli-button" onClick={() => { onApply(null, false); onClose(); }}>Reset</button>
          <span className="pli-spacer-flex" />
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="button" className="pli-button" onClick={() => { onApply(fill ?? null, true); onClose(); }}>Apply to all slides</button>
          <button type="submit" className="pli-button pli-button-primary">Done</button>
        </>
      }
    >
      <div className="pli-deck-swatches" role="group" aria-label="Background colors">
        {SWATCHES.map((c) => (
          <button key={c} type="button" className="pli-swatch" style={{ background: c }} aria-label={c} aria-pressed={fill === c} onClick={() => setFill(c)} />
        ))}
      </div>
      <label className="pli-field-row">
        <span>Custom color</span>
        <input type="color" aria-label="Custom background color" value={custom} onChange={(e) => { setCustom(e.target.value); setFill(e.target.value); }} />
      </label>
      <div className="pli-deck-gradients" role="group" aria-label="Gradients">
        {GRADIENTS.map((g) => (
          <button key={g.label} type="button" className="pli-button" onClick={() => setFill(g.fill)}>{g.label}</button>
        ))}
      </div>
      <label className="pli-field-row">
        <span>Image</span>
        <input type="file" accept="image/*" aria-label="Background image" onChange={(e) => void pickImage(e.target.files?.[0])} />
      </label>
      {error && <p className="pli-dialog-error" role="alert">{error}</p>}
    </Dialog>
  );
}

export interface PageSetupDialogProps {
  size: SlideSize;
  onApply: (size: SlideSize, scale: boolean) => void;
  onClose: () => void;
}

const IN = 72;
export function PageSetupDialog({ size, onApply, onClose }: PageSetupDialogProps) {
  const known = Object.entries(SLIDE_SIZES).find(([, s]) => s.width === size.width && s.height === size.height)?.[0] ?? "custom";
  const [choice, setChoice] = useState(known);
  const [w, setW] = useState(String(Math.round((size.width / IN) * 100) / 100));
  const [h, setH] = useState(String(Math.round((size.height / IN) * 100) / 100));
  const [scale, setScale] = useState(true);
  const result = (): SlideSize | null => {
    if (choice !== "custom") return SLIDE_SIZES[choice] ?? null;
    const width = Number(w) * IN;
    const height = Number(h) * IN;
    return width >= 72 && height >= 72 && width <= 5184 && height <= 5184 ? { width, height } : null;
  };
  const apply = () => {
    const r = result();
    if (r) {
      onApply(r, scale);
      onClose();
    }
  };
  return (
    <Dialog open title="Page setup" onClose={onClose} onSubmit={apply} actions={<><span className="pli-spacer-flex" /><button type="button" className="pli-button" onClick={onClose}>Cancel</button><button type="submit" className="pli-button pli-button-primary" disabled={!result()}>Apply</button></>}>
      <label className="pli-field-row">
        <span>Size</span>
        <select aria-label="Slide size" value={choice} onChange={(e) => setChoice(e.target.value)}>
          {Object.keys(SLIDE_SIZES).map((n) => <option key={n} value={n}>{n}</option>)}
          <option value="custom">Custom</option>
        </select>
      </label>
      {choice === "custom" && (
        <>
          <label className="pli-field-row"><span>Width (in)</span><input type="number" step="0.1" aria-label="Width in inches" value={w} onChange={(e) => setW(e.target.value)} /></label>
          <label className="pli-field-row"><span>Height (in)</span><input type="number" step="0.1" aria-label="Height in inches" value={h} onChange={(e) => setH(e.target.value)} /></label>
        </>
      )}
      <label className="pli-checkbox-row">
        <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} />
        <span>Scale content to fit the new size</span>
      </label>
    </Dialog>
  );
}

export function UrlDialog({ title, label, onApply, onClose }: { title: string; label: string; onApply: (url: string) => void; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const apply = () => {
    if (url.trim()) {
      onApply(url.trim());
      onClose();
    }
  };
  return (
    <Dialog open title={title} onClose={onClose} onSubmit={apply} actions={<><span className="pli-spacer-flex" /><button type="button" className="pli-button" onClick={onClose}>Cancel</button><button type="submit" className="pli-button pli-button-primary" disabled={!url.trim()}>Insert</button></>}>
      <label className="pli-field-row"><span>{label}</span><input type="text" aria-label={label} value={url} autoFocus placeholder="https://" onChange={(e) => setUrl(e.target.value)} /></label>
    </Dialog>
  );
}

export function wordCount(deck: Deck): { slides: number; words: number; characters: number; notesWords: number } {
  let text = "";
  let notes = "";
  const visit = (list: Deck["slides"][number]["elements"]) => {
    for (const e of list) {
      if (e.type === "shape" && e.text) text += plainText(e.text.paragraphs) + "\n";
      else if (e.type === "table") for (const r of e.rows) for (const c of r.cells) text += plainText(c.paragraphs) + "\n";
      else if (e.type === "group") visit(e.children);
    }
  };
  for (const s of deck.slides) {
    visit(s.elements);
    notes += s.notes + "\n";
  }
  const words = (t: string) => (t.match(/\S+/g) ?? []).length;
  return { slides: deck.slides.length, words: words(text), characters: text.replace(/\s/g, "").length, notesWords: words(notes) };
}

export function WordCountDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const c = wordCount(deck);
  return (
    <Dialog open title="Word count" onClose={onClose} actions={<><span className="pli-spacer-flex" /><button type="submit" className="pli-button pli-button-primary">Close</button></>} onSubmit={onClose}>
      <dl className="pli-deck-counts">
        <dt>Slides</dt><dd>{c.slides}</dd>
        <dt>Words on slides</dt><dd>{c.words}</dd>
        <dt>Characters (no spaces)</dt><dd>{c.characters}</dd>
        <dt>Words in speaker notes</dt><dd>{c.notesWords}</dd>
      </dl>
    </Dialog>
  );
}
