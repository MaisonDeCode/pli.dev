import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { userInitials } from "@pli.dev/core";
import { Dialog, useDocumentFonts, useFonts } from "@pli.dev/react";
import type { PdfPicture, Pt } from "@pli.dev/pdf";
import { finishStroke, smoothPathData, thinPoints } from "./annotGeometry";
import type { AnnotController } from "./annotController";
import { cleanPicture, fileToPicture, normaliseStrokes, saveSignature, type SignatureValue } from "./signatures";
import { customStamp } from "./stamps";
import { SWATCHES } from "./annotStyles";
import { useController } from "./annotUi";

const PAD_W = 440;
const PAD_H = 160;
const INKS = ["#0b2a6b", "#111111", "#c62828", "#1b5e20"];

/** Script and handwriting families to offer for a typed signature: the pleasant ones the catalogue has, then any others it lists. */
export const SIGNATURE_FONTS = ["Dancing Script", "Caveat", "Pacifico", "Satisfy", "Great Vibes", "Homemade Apple", "Sacramento", "Kaushan Script", "Segoe Script", "Brush Script MT", "Segoe Print", "Comic Sans MS"];

export function useSignatureFonts(c: AnnotController): { names: string[]; fonts: ReturnType<typeof useFonts> } {
  const fonts = useFonts(c.options.fonts || undefined);
  const names = useMemo(() => {
    const preferred = SIGNATURE_FONTS.filter((n) => fonts.find(n));
    const more = fonts.search({ category: "handwriting" }).map((f) => f.family).filter((n) => !preferred.includes(n));
    return [...preferred, ...more].slice(0, 6);
  }, [fonts]);
  return { names: names.length ? names : ["cursive"], fonts };
}

/** The pad you sign on: an SVG that follows the pointer (a finger or a pen too) and keeps the strokes. */
function Pad({ strokes, onChange, color, lineWidth }: { strokes: Pt[][]; onChange: (s: Pt[][]) => void; color: string; lineWidth: number }) {
  const [live, setLive] = useState<Pt[] | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const at = (e: ReactPointerEvent): Pt => {
    const box = ref.current?.getBoundingClientRect();
    const k = box && box.width > 0 ? PAD_W / box.width : 1;
    return [Math.max(0, Math.min(PAD_W, (e.clientX - (box?.left ?? 0)) * k)), Math.max(0, Math.min(PAD_H, (e.clientY - (box?.top ?? 0)) * k))];
  };
  return (
    <svg
      ref={ref}
      className="pli-pdf-sigpad"
      viewBox={`0 0 ${PAD_W} ${PAD_H}`}
      role="img"
      aria-label="Signature pad: draw your signature here"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // a synthetic event
        }
        setLive([at(e)]);
      }}
      onPointerMove={(e) => {
        if (!live) return;
        const native = e.nativeEvent as PointerEvent;
        const batch = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
        setLive((l) => (l ? [...l, ...(batch.length > 1 ? batch.map((b) => at(b as unknown as ReactPointerEvent)) : [at(e)])] : l));
      }}
      onPointerUp={(e) => {
        if (!live) return;
        const done = finishStroke(thinPoints([...live, at(e)], 0.8));
        setLive(null);
        if (done.length > 0) onChange([...strokes, done]);
      }}
      onPointerCancel={() => setLive(null)}
    >
      <line x1={16} y1={PAD_H - 36} x2={PAD_W - 16} y2={PAD_H - 36} className="pli-pdf-sigline" />
      <g fill="none" stroke={color} strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round">
        {strokes.map((s, i) => (
          <path key={i} d={smoothPathData(s)} data-stroke={i} />
        ))}
        {live && <path d={smoothPathData(live)} />}
      </g>
    </svg>
  );
}

/** Create a signature or initials: draw them, type them in a script font, or upload a picture. */
export function SignatureDialog({ c }: { c: AnnotController }) {
  useController(c);
  const kind = c.dialog === "initials" ? "initials" : "signature";
  const user = c.user;
  const [tab, setTab] = useState<"draw" | "type" | "upload">("draw");
  const [color, setColor] = useState(c.style("signature").color);
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const lineWidth = 2.4;
  const [name, setName] = useState(kind === "initials" && user?.name ? userInitials({ name: user.name }) : (user?.name ?? ""));
  const { names, fonts } = useSignatureFonts(c);
  const [font, setFont] = useState(names[0]!);
  useDocumentFonts(fonts, names, name);
  const [picture, setPicture] = useState<PdfPicture | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [trim, setTrim] = useState(true);
  const [raw, setRaw] = useState<PdfPicture | null>(null);
  const [save, setSave] = useState(true);
  const [error, setError] = useState("");

  // The uploaded picture is cleaned again when the options change.
  useEffect(() => {
    let live = true;
    if (!raw) return setPicture(null);
    const isPng = raw.src.startsWith("data:image/png");
    void cleanPicture(raw, { removeWhite: removeWhite && isPng, trim }).then((p) => live && setPicture(p));
    return () => {
      live = false;
    };
  }, [raw, removeWhite, trim]);

  const value = (): SignatureValue | null => {
    if (tab === "draw") {
      if (strokes.length === 0) return null;
      const n = normaliseStrokes(strokes, lineWidth);
      return { mode: "draw", strokes: n.strokes, width: n.width, height: n.height, color, lineWidth };
    }
    if (tab === "type") return name.trim() ? { mode: "type", text: name.trim(), font, color } : null;
    return picture ? { mode: "image", picture } : null;
  };
  const close = () => c.openDialog(null);
  const submit = () => {
    const v = value();
    if (!v) return setError(tab === "draw" ? "Draw your signature first" : tab === "type" ? "Type your name first" : "Choose a picture first");
    if (save) saveSignature(c.namespace, user?.id, kind, v, c.now());
    // (the signature is made before the dialog is closed: closing it forgets which field it was for)
    c.chooseSignature(v, kind === "initials" ? 70 : 150);
    close();
  };
  const tabs = [
    ["draw", "Draw"],
    ["type", "Type"],
    ["upload", "Upload"],
  ] as const;
  const label = kind === "initials" ? "initials" : "signature";
  return (
    <Dialog
      open
      title={kind === "initials" ? "Add initials" : "Add a signature"}
      onClose={close}
      onSubmit={submit}
      actions={
        <>
          <button type="button" className="pli-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="pli-button pli-button-primary">
            Use {label}
          </button>
        </>
      }
    >
      <div className="pli-pdf-sig">
        <div role="tablist" aria-label="How to make it" className="pli-pdf-sigtabs">
          {tabs.map(([id, text]) => (
            <button key={id} type="button" role="tab" id={`pli-sig-tab-${id}`} aria-selected={tab === id} aria-controls="pli-sig-panel" className="pli-pdf-tab" onClick={() => (setTab(id), setError(""))}>
              {text}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="pli-sig-panel" aria-labelledby={`pli-sig-tab-${tab}`} className="pli-pdf-sigpanel">
          {tab === "draw" && (
            <>
              <Pad strokes={strokes} onChange={setStrokes} color={color} lineWidth={lineWidth} />
              <div className="pli-pdf-sigtools">
                <button type="button" className="pli-button" disabled={strokes.length === 0} onClick={() => setStrokes((s) => s.slice(0, -1))}>
                  Undo stroke
                </button>
                <button type="button" className="pli-button" disabled={strokes.length === 0} onClick={() => setStrokes([])}>
                  Clear
                </button>
              </div>
            </>
          )}
          {tab === "type" && (
            <>
              <label className="pli-pdf-field">
                <span className="pli-pdf-field-label">{kind === "initials" ? "Your initials" : "Your name"}</span>
                <input type="text" aria-label={kind === "initials" ? "Your initials" : "Your name"} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              </label>
              <div role="radiogroup" aria-label="Style" className="pli-pdf-sigfonts">
                {names.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={font === n} className="pli-pdf-sigfont" onClick={() => setFont(n)}>
                    <span style={{ fontFamily: fonts.stack(n), color }}>{name.trim() || "Your name"}</span>
                    <small>{n}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          {tab === "upload" && (
            <>
              <label className="pli-pdf-field">
                <span className="pli-pdf-field-label">A picture of your {label} (PNG or JPEG)</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  aria-label="Picture file"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setRaw(await fileToPicture(file));
                      setError("");
                    } catch {
                      setError("That file could not be read");
                    }
                  }}
                />
              </label>
              <label className="pli-pdf-check">
                <input type="checkbox" checked={removeWhite} onChange={(e) => setRemoveWhite(e.target.checked)} /> Remove the white background (PNG)
              </label>
              <label className="pli-pdf-check">
                <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> Trim empty space around it
              </label>
              {picture && <img className="pli-pdf-sigpreview" src={picture.src} alt={`Your ${label}`} />}
            </>
          )}
        </div>
        {tab !== "upload" && (
          <div className="pli-pdf-swatches" role="group" aria-label="Ink colour">
            {INKS.map((ink) => (
              <button key={ink} type="button" className="pli-swatch" style={{ background: ink }} aria-label={`Ink ${ink}`} aria-pressed={color === ink} onClick={() => setColor(ink)} />
            ))}
          </div>
        )}
        <label className="pli-pdf-check">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Remember it on this device
        </label>
        {error && (
          <p className="pli-dialog-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** The text of a custom stamp. */
export function StampTextDialog({ c }: { c: AnnotController }) {
  const [text, setText] = useState("");
  const [color, setColor] = useState<string>("#c62828");
  const close = () => c.openDialog(null);
  return (
    <Dialog
      open
      title="Custom stamp"
      onClose={close}
      onSubmit={() => {
        if (!text.trim()) return;
        close();
        c.chooseStamp(customStamp(text, color));
      }}
      actions={
        <>
          <button type="button" className="pli-button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="pli-button pli-button-primary" disabled={!text.trim()}>
            Use stamp
          </button>
        </>
      }
    >
      <label className="pli-pdf-field">
        <span className="pli-pdf-field-label">Text</span>
        <input type="text" aria-label="Stamp text" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} autoFocus />
      </label>
      <div className="pli-pdf-swatches" role="group" aria-label="Stamp colour">
        {SWATCHES.slice(1, 8).map((sw) => (
          <button key={sw} type="button" className="pli-swatch" style={{ background: sw }} aria-label={`Stamp ${sw}`} aria-pressed={color === sw} onClick={() => setColor(sw)} />
        ))}
      </div>
    </Dialog>
  );
}

/** Asks before the redactions are applied: it cannot be undone once the file is saved. */
export function ApplyRedactionsDialog({ c }: { c: AnnotController }) {
  const { marks, pages } = c.redactionCount();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const close = () => c.openDialog(null);
  return (
    <Dialog
      open
      title="Apply redactions"
      onClose={close}
      onSubmit={async () => {
        setBusy(true);
        const r = await c.applyRedactions();
        setBusy(false);
        if (!r.ok) setResult(r.message);
      }}
      actions={
        <>
          <button type="button" className="pli-button" onClick={close}>
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button type="submit" className="pli-button pli-button-danger" disabled={busy || marks === 0}>
              Apply redactions
            </button>
          )}
        </>
      }
    >
      <p>
        {marks === 0
          ? "There is nothing marked for redaction."
          : `This permanently removes the text and pictures under ${marks} ${marks === 1 ? "mark" : "marks"} on ${pages} ${pages === 1 ? "page" : "pages"}.`}
      </p>
      <p className="pli-dialog-note">
        <strong>It can't be undone</strong> once the file is saved: the removed content is gone from the file, not just hidden. Keep a copy of the original if you may need it.
      </p>
      {result && (
        <p className="pli-dialog-error" role="alert">
          {result}
        </p>
      )}
    </Dialog>
  );
}
