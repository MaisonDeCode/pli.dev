import { useEffect, useRef, useState } from "react";
import { Dialog } from "@pli.dev/react";
import { DEFAULT_MARGINS, PAPER_SIZES, headerPictureFrom, scaleHeaderPicture, withPictureCode, type HeaderFooterParts, type HeaderFooterPicture, type HeaderFooterPictures, type HeaderFooterSection, type PageSetup, type PaperSize } from "@pli.dev/sheets";
import { imageFromFile } from "./imageFile";

/** What the dialog changes: each field of a page setup, `null` to put it back to its default. */
export type PageSetupPatch = { [K in keyof PageSetup]?: PageSetup[K] | null };

export interface SheetPageDialogProps {
  open: boolean;
  sheetName: string;
  page: PageSetup;
  /** The rows and columns repeated, as `1:2` and `A:B`. */
  titles: { rows?: string; cols?: string };
  onClose(): void;
  /** Returns why it was refused, if it was. */
  onSave(patch: PageSetupPatch, titles: { rows: string | null; cols: string | null }): string | void;
}

type Section = "left" | "center" | "right";
type Kind = "header" | "footer" | "firstHeader" | "firstFooter";

const CODES: { code: string; label: string }[] = [
  { code: "&P", label: "Page number" },
  { code: "&N", label: "Number of pages" },
  { code: "&D", label: "Date" },
  { code: "&T", label: "Time" },
  { code: "&F", label: "File name" },
  { code: "&A", label: "Sheet name" },
  { code: "&B", label: "Bold on or off" },
  { code: "&I", label: "Italic on or off" },
];

const SECTION_LABELS: Record<HeaderFooterSection, string> = { header: "Header", footer: "Footer", firstHeader: "First page header", firstFooter: "First page footer", evenHeader: "Even pages header", evenFooter: "Even pages footer" };
const PLACES = ["left", "center", "right"] as const;
/** How tall a picture added to a header or footer starts out, at most, in points. */
const START_HEIGHT = 36;

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/** Page setup for a sheet: paper and scale, margins, header and footer, and what is printed. */
export function SheetPageDialog({ open, sheetName, page, titles, onClose, onSave }: SheetPageDialogProps) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [paper, setPaper] = useState<PaperSize>("letter");
  const [sizing, setSizing] = useState<"scale" | "fit">("scale");
  const [scale, setScale] = useState("100");
  const [wide, setWide] = useState("1");
  const [tall, setTall] = useState("1");
  const [first, setFirst] = useState("");
  const [margins, setMargins] = useState<Record<keyof typeof DEFAULT_MARGINS, string>>({ top: "", bottom: "", left: "", right: "", header: "", footer: "" });
  const [centerH, setCenterH] = useState(false);
  const [centerV, setCenterV] = useState(false);
  const [text, setText] = useState<Record<Kind, Record<Section, string>>>({ header: { left: "", center: "", right: "" }, footer: { left: "", center: "", right: "" }, firstHeader: { left: "", center: "", right: "" }, firstFooter: { left: "", center: "", right: "" } });
  const [differentFirst, setDifferentFirst] = useState(false);
  const [area, setArea] = useState("");
  const [rows, setRows] = useState("");
  const [cols, setCols] = useState("");
  const [gridlines, setGridlines] = useState(false);
  const [headings, setHeadings] = useState(false);
  const [blackAndWhite, setBlackAndWhite] = useState(false);
  const [order, setOrder] = useState<"down" | "over">("down");
  const [comments, setComments] = useState<"none" | "end" | "sheet">("none");
  const [errors, setErrors] = useState<"displayed" | "blank" | "dash" | "na">("displayed");
  const [draft, setDraft] = useState(false);
  const [pics, setPics] = useState<HeaderFooterPictures>({});
  const [picSection, setPicSection] = useState<Kind>("header");
  const [picPlace, setPicPlace] = useState<Section>("left");
  const [problem, setProblem] = useState<string | null>(null);
  /** The text box the code buttons write into: the one that was last in. */
  const last = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const parts = (p: HeaderFooterParts | undefined): Record<Section, string> => ({ left: p?.left ?? "", center: p?.center ?? "", right: p?.right ?? "" });
    setOrientation(page.orientation ?? "portrait");
    setPaper(page.paper ?? "letter");
    setSizing(page.fit ? "fit" : "scale");
    setScale(String(page.scale ?? 100));
    setWide(String(page.fit?.wide ?? 1));
    setTall(String(page.fit?.tall ?? 1));
    setFirst(page.firstPageNumber !== undefined ? String(page.firstPageNumber) : "");
    setMargins({ top: String(page.margins?.top ?? DEFAULT_MARGINS.top), bottom: String(page.margins?.bottom ?? DEFAULT_MARGINS.bottom), left: String(page.margins?.left ?? DEFAULT_MARGINS.left), right: String(page.margins?.right ?? DEFAULT_MARGINS.right), header: String(page.margins?.header ?? DEFAULT_MARGINS.header), footer: String(page.margins?.footer ?? DEFAULT_MARGINS.footer) });
    setCenterH(!!page.centerHorizontally);
    setCenterV(!!page.centerVertically);
    setText({ header: parts(page.header), footer: parts(page.footer), firstHeader: parts(page.firstHeader), firstFooter: parts(page.firstFooter) });
    setDifferentFirst(!!page.differentFirstPage);
    setArea((page.printArea ?? []).join(", "));
    setRows(titles.rows ?? "");
    setCols(titles.cols ?? "");
    setGridlines(!!page.gridlines);
    setHeadings(!!page.headings);
    setBlackAndWhite(!!page.blackAndWhite);
    setOrder(page.order === "over" ? "over" : "down");
    setComments(page.comments ?? "none");
    setErrors(page.errors ?? "displayed");
    setDraft(!!page.draft);
    setPics(page.pictures ?? {});
    setProblem(null);
  }, [open, page, titles.rows, titles.cols]);

  const insertCode = (code: string) => {
    const el = last.current;
    if (!el) return;
    const [from, to] = [el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length];
    const [kind, section] = (el.dataset["slot"] ?? "").split(":") as [Kind, Section];
    if (!kind || !section) return;
    setText((t) => ({ ...t, [kind]: { ...t[kind], [section]: t[kind][section].slice(0, from) + code + t[kind][section].slice(to) } }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(from + code.length, from + code.length);
    });
  };

  /** Puts a picture file in a header or footer part (and the code that says where in its text). */
  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { src, alt } = await imageFromFile(file);
      let pic: HeaderFooterPicture = headerPictureFrom(src);
      if (pic.height > START_HEIGHT) pic = scaleHeaderPicture(pic, { height: START_HEIGHT });
      pic = { ...pic, ...(alt ? { alt } : {}) };
      setPics((p) => ({ ...p, [picSection]: { ...p[picSection], [picPlace]: pic } }));
      setText((t) => ({ ...t, [picSection]: { ...t[picSection], [picPlace]: withPictureCode(t[picSection][picPlace], true) } }));
      if (picSection === "firstHeader" || picSection === "firstFooter") setDifferentFirst(true);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const removePicture = (section: HeaderFooterSection, at: Section) => {
    setPics((p) => {
      const here = { ...p[section] };
      delete here[at];
      const next = { ...p };
      if (Object.keys(here).length) next[section] = here;
      else delete next[section];
      return next;
    });
    if (section in text) setText((t) => ({ ...t, [section]: { ...t[section as Kind], [at]: withPictureCode(t[section as Kind][at], false) } }));
  };
  const sizePicture = (section: HeaderFooterSection, at: Section, axis: "width" | "height", value: string) => {
    const n = Number(value);
    const old = pics[section]?.[at];
    if (!old || !(n > 0)) return;
    try {
      setPics((p) => ({ ...p, [section]: { ...p[section], [at]: scaleHeaderPicture(old, { [axis]: n }) } }));
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const save = () => {
    const parts = (k: Kind): HeaderFooterParts | null => {
      const p = text[k];
      const out: HeaderFooterParts = { ...(p.left ? { left: p.left } : {}), ...(p.center ? { center: p.center } : {}), ...(p.right ? { right: p.right } : {}) };
      return Object.keys(out).length ? out : null;
    };
    const m: NonNullable<PageSetup["margins"]> = {};
    for (const k of Object.keys(DEFAULT_MARGINS) as (keyof typeof DEFAULT_MARGINS)[]) {
      const v = num(margins[k]);
      if (v === null || Number.isNaN(v)) return setProblem(`The ${k} margin is a number of inches.`);
      m[k] = v;
    }
    const patch: PageSetupPatch = {
      orientation: orientation === "landscape" ? "landscape" : null,
      paper: paper === "letter" ? null : paper,
      margins: m,
      centerHorizontally: centerH ? true : null,
      centerVertically: centerV ? true : null,
      gridlines: gridlines ? true : null,
      headings: headings ? true : null,
      blackAndWhite: blackAndWhite ? true : null,
      draft: draft ? true : null,
      comments: comments === "none" ? null : comments,
      errors: errors === "displayed" ? null : errors,
      pictures: Object.keys(pics).length ? pics : null,
      order: order === "over" ? "over" : null,
      firstPageNumber: first.trim() === "" ? null : Number(first),
      printArea: area.trim() === "" ? null : area.split(/[,;]\s*/).map((r) => r.trim()).filter(Boolean),
      header: parts("header"),
      footer: parts("footer"),
      differentFirstPage: differentFirst ? true : null,
      firstHeader: differentFirst ? parts("firstHeader") : null,
      firstFooter: differentFirst ? parts("firstFooter") : null,
    };
    if (sizing === "fit") {
      const w = num(wide);
      const t = num(tall);
      if (w === null || t === null || Number.isNaN(w) || Number.isNaN(t)) return setProblem("Fit to a number of pages wide and tall (0 for as many as needed).");
      patch.fit = { wide: w, tall: t };
      patch.scale = null;
    } else {
      const sc = num(scale);
      if (sc === null || Number.isNaN(sc)) return setProblem("The scale is a number of percent.");
      patch.scale = sc;
      patch.fit = null;
    }
    const refused = onSave(patch, { rows: rows.trim() === "" ? null : rows.trim(), cols: cols.trim() === "" ? null : cols.trim() });
    if (refused) setProblem(refused);
  };

  const box = (kind: Kind, section: Section, label: string) => (
    <label key={`${kind}${section}`}>
      {label}
      <input type="text" data-slot={`${kind}:${section}`} value={text[kind][section]} onFocus={(e) => (last.current = e.currentTarget)} onChange={(e) => setText((t) => ({ ...t, [kind]: { ...t[kind], [section]: e.target.value } }))} />
    </label>
  );
  const trio = (kind: Kind) => <div className="pli-pagesetup-trio">{(["left", "center", "right"] as const).map((s) => box(kind, s, s[0]!.toUpperCase() + s.slice(1)))}</div>;

  return (
    <Dialog
      open={open}
      title={`Page setup: ${sheetName}`}
      onClose={onClose}
      onSubmit={save}
      actions={
        <>
          <button type="button" className="pli-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="pli-button pli-button-primary">Save</button>
        </>
      }
    >
      <div className="pli-chartform pli-ruleform pli-pagesetup">
        <fieldset>
          <legend>Page</legend>
          <label className="pli-ruleform-check"><input type="radio" name="orientation" checked={orientation === "portrait"} onChange={() => setOrientation("portrait")} /> Portrait</label>
          <label className="pli-ruleform-check"><input type="radio" name="orientation" checked={orientation === "landscape"} onChange={() => setOrientation("landscape")} /> Landscape</label>
          <label>
            Paper
            <select aria-label="Paper" value={paper} onChange={(e) => setPaper(e.target.value as PaperSize)}>
              {(Object.keys(PAPER_SIZES) as PaperSize[]).map((p) => <option key={p} value={p}>{PAPER_SIZES[p].label}</option>)}
            </select>
          </label>
          <label className="pli-ruleform-check"><input type="radio" name="sizing" checked={sizing === "scale"} onChange={() => setSizing("scale")} /> Scale to <input type="number" aria-label="Scale in percent" min={10} max={400} value={scale} disabled={sizing !== "scale"} onChange={(e) => setScale(e.target.value)} /> % of normal size</label>
          <label className="pli-ruleform-check">
            <input type="radio" name="sizing" checked={sizing === "fit"} onChange={() => setSizing("fit")} /> Fit to <input type="number" aria-label="Pages wide" min={0} value={wide} disabled={sizing !== "fit"} onChange={(e) => setWide(e.target.value)} /> pages wide by{" "}
            <input type="number" aria-label="Pages tall" min={0} value={tall} disabled={sizing !== "fit"} onChange={(e) => setTall(e.target.value)} /> tall
          </label>
          <label>
            First page number
            <input type="number" aria-label="First page number" min={0} value={first} placeholder="1" onChange={(e) => setFirst(e.target.value)} />
          </label>
        </fieldset>
        <fieldset>
          <legend>Margins (inches)</legend>
          <div className="pli-pagesetup-trio">
            {(Object.keys(DEFAULT_MARGINS) as (keyof typeof DEFAULT_MARGINS)[]).map((k) => (
              <label key={k}>
                {k[0]!.toUpperCase() + k.slice(1)}
                <input type="number" aria-label={`${k} margin`} step="0.05" min={0} value={margins[k]} onChange={(e) => setMargins((m) => ({ ...m, [k]: e.target.value }))} />
              </label>
            ))}
          </div>
          <label className="pli-ruleform-check"><input type="checkbox" checked={centerH} onChange={(e) => setCenterH(e.target.checked)} /> Centre on the page, across</label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={centerV} onChange={(e) => setCenterV(e.target.checked)} /> Centre on the page, down</label>
        </fieldset>
        <fieldset>
          <legend>Header and footer</legend>
          <p className="pli-ruleform-hint">Click a box, then pick a code to put in it. &amp;P is the page number, &amp;N the number of pages.</p>
          <select aria-label="Insert a code" value="" onChange={(e) => e.target.value && insertCode(e.target.value)}>
            <option value="">Insert a code…</option>
            {CODES.map((c) => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
          </select>
          <strong>Header</strong>
          {trio("header")}
          <strong>Footer</strong>
          {trio("footer")}
          <label className="pli-ruleform-check"><input type="checkbox" checked={differentFirst} onChange={(e) => setDifferentFirst(e.target.checked)} /> A different first page</label>
          {differentFirst && (
            <>
              <strong>First page header</strong>
              {trio("firstHeader")}
              <strong>First page footer</strong>
              {trio("firstFooter")}
            </>
          )}
        </fieldset>
        <fieldset>
          <legend>Pictures in the header and footer</legend>
          {(Object.keys(SECTION_LABELS) as HeaderFooterSection[]).flatMap((section) =>
            PLACES.map((at) => {
              const pic = pics[section]?.[at];
              if (!pic) return null;
              return (
                <div key={`${section}:${at}`} className="pli-pagesetup-pic" data-section={section} data-place={at}>
                  <img src={pic.src} alt={pic.alt ?? ""} height={Math.min(24, pic.height)} />
                  <span>{SECTION_LABELS[section]}, {at}</span>
                  <input type="number" aria-label={`${SECTION_LABELS[section]} ${at} picture width`} min={1} step="1" value={Math.round(pic.width * 10) / 10} onChange={(e) => sizePicture(section, at, "width", e.target.value)} />
                  <span>×</span>
                  <input type="number" aria-label={`${SECTION_LABELS[section]} ${at} picture height`} min={1} step="1" value={Math.round(pic.height * 10) / 10} onChange={(e) => sizePicture(section, at, "height", e.target.value)} />
                  <span>pt</span>
                  <button type="button" className="pli-button" onClick={() => removePicture(section, at)}>Remove</button>
                </div>
              );
            }),
          )}
          <p className="pli-ruleform-hint">The picture goes where the &amp;G code is in the text of its part. Pick where it goes, then a picture file.</p>
          <div className="pli-pagesetup-trio">
            <label>
              In the
              <select aria-label="Picture in" value={picSection} onChange={(e) => setPicSection(e.target.value as Kind)}>
                {(["header", "footer", "firstHeader", "firstFooter"] as Kind[]).map((k) => <option key={k} value={k}>{SECTION_LABELS[k]}</option>)}
              </select>
            </label>
            <label>
              At the
              <select aria-label="Picture at" value={picPlace} onChange={(e) => setPicPlace(e.target.value as Section)}>
                {PLACES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label>
              Picture
              <input type="file" aria-label="Picture file" accept="image/*" onChange={(e) => { void addPicture(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Sheet</legend>
          <label>
            Print area (ranges such as A1:D20, with commas between)
            <input type="text" aria-label="Print area" value={area} placeholder="Everything" onChange={(e) => setArea(e.target.value)} />
          </label>
          <label>
            Rows to repeat at the top
            <input type="text" aria-label="Rows to repeat" value={rows} placeholder="1:2" onChange={(e) => setRows(e.target.value)} />
          </label>
          <label>
            Columns to repeat at the left
            <input type="text" aria-label="Columns to repeat" value={cols} placeholder="A:B" onChange={(e) => setCols(e.target.value)} />
          </label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={gridlines} onChange={(e) => setGridlines(e.target.checked)} /> Print gridlines</label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={headings} onChange={(e) => setHeadings(e.target.checked)} /> Print row numbers and column letters</label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={blackAndWhite} onChange={(e) => setBlackAndWhite(e.target.checked)} /> Black and white</label>
          <label className="pli-ruleform-check"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Draft quality (no gridlines or graphics)</label>
          <label>
            Comments
            <select aria-label="Comments" value={comments} onChange={(e) => setComments(e.target.value as typeof comments)}>
              <option value="none">(None)</option>
              <option value="end">At end of sheet</option>
              <option value="sheet">As displayed on sheet</option>
            </select>
          </label>
          <label>
            Cell errors as
            <select aria-label="Cell errors as" value={errors} onChange={(e) => setErrors(e.target.value as typeof errors)}>
              <option value="displayed">displayed</option>
              <option value="blank">&lt;blank&gt;</option>
              <option value="dash">--</option>
              <option value="na">#N/A</option>
            </select>
          </label>
          <label className="pli-ruleform-check"><input type="radio" name="order" checked={order === "down"} onChange={() => setOrder("down")} /> Pages go down, then over</label>
          <label className="pli-ruleform-check"><input type="radio" name="order" checked={order === "over"} onChange={() => setOrder("over")} /> Pages go over, then down</label>
        </fieldset>
        {problem && <p className="pli-dropdown-error" role="alert">{problem}</p>}
      </div>
    </Dialog>
  );
}
