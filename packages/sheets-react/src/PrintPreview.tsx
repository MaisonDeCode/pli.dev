import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFonts } from "@pli.dev/react";
import { columnPixels, printToPdf, usedFonts, rowPixelsOf, type HeaderFooterRun, type PrintedPage, type PrintLayout, type PrintPage, type PrintPdfResult, type Sheet, type SheetImage, type SheetSession } from "@pli.dev/sheets";
import { ChartView } from "./ChartView";
import { NoteContent } from "./NoteContent";
import { PictureBody, pictureBoxStyle } from "./PictureView";
import { browserRasterizer } from "./printPdf";

/** What a host that prints for itself is given when someone presses Print (see `PliSheetProps.onPrint`). */
export interface PliSheetPrintJob {
  /** The sheet's name. */
  sheet: string;
  /** The printout as a PDF file: its name, type and bytes (the same file Download PDF saves). */
  file: { name: string; type: "application/pdf"; data: Uint8Array };
  /** How many pages it has. */
  pages: number;
  /** The paper in points, turned for landscape. */
  paper: { width: number; height: number };
  /** What could not be drawn as it is on the screen (charts and icons need a browser's canvas, for one). */
  warnings: string[];
  /** The pages as Pli lays them out, and each as HTML, for a host that prints them some other way than from the PDF. */
  layout: PrintLayout;
  printed: PrintedPage[];
}

export interface PrintPreviewProps {
  session: SheetSession;
  sheetId: string;
  /** Changes whenever the workbook does, so that the pages are made again. */
  revision: number;
  onClose(): void;
  onSetup(): void;
  /** Pictures that `IMAGE` formulas fetch from the web are drawn when this is on. */
  remoteImages?: boolean;
  /** The spreadsheet's root, which the preview is drawn inside. */
  container: HTMLElement | null;
  /** Saves the PDF (`PliSheet` hands it to `onDownload`, or the browser downloads it). */
  onFile?(name: string, data: Uint8Array, type: string): void;
  /** Where the Print button sends the pages: the host's own print service. Without it there is no Print button, only Download PDF. */
  onPrint?(job: PliSheetPrintJob): void | Promise<void>;
  /** Also offer the browser's own print dialog (the way printing used to work) as "Print with the browser…". */
  browserPrint?: boolean;
}

const runStyle = (r: HeaderFooterRun): CSSProperties => ({
  fontWeight: r.bold ? "bold" : undefined,
  fontStyle: r.italic ? "italic" : undefined,
  textDecoration: [r.underline ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
  fontSize: r.size ? `${r.size}pt` : undefined,
  fontFamily: r.font,
  color: r.color,
});

/** A picture in a header or footer: its size on paper, with the parts cropped away left out. */
function HeaderPicture({ picture, mono }: { picture: NonNullable<HeaderFooterRun["picture"]>; mono: boolean }) {
  const c = picture.crop ?? {};
  const keepW = 1 - (c.left ?? 0) - (c.right ?? 0);
  const keepH = 1 - (c.top ?? 0) - (c.bottom ?? 0);
  return (
    <span className="pli-print-hfpic" style={{ display: "inline-block", position: "relative", overflow: "hidden", verticalAlign: "middle", width: `${picture.width}pt`, height: `${picture.height}pt` }}>
      <img
        src={picture.src}
        alt={picture.alt ?? ""}
        draggable={false}
        style={{ position: "absolute", display: "block", maxWidth: "none", width: `${picture.width / keepW}pt`, height: `${picture.height / keepH}pt`, left: `${(-(c.left ?? 0) * picture.width) / keepW}pt`, top: `${(-(c.top ?? 0) * picture.height) / keepH}pt`, filter: mono || picture.grayscale ? "grayscale(1)" : undefined }}
      />
    </span>
  );
}

const Runs = ({ runs, mono }: { runs: HeaderFooterRun[]; mono: boolean }): ReactNode => runs.map((r, i) => (r.picture ? <HeaderPicture key={i} picture={r.picture} mono={mono} /> : <span key={i} style={runStyle(r)}>{r.text}</span>));

/** The sheet pixels from the top left of the sheet to the top left of a cell, and a little way into it. */
const offsetOf = (sheet: Sheet, row: number, col: number, dx = 0, dy = 0) => {
  let x = dx;
  for (let c = 1; c < col; c++) x += columnPixels(sheet, c);
  let y = dy;
  for (let r = 1; r < row; r++) y += rowPixelsOf(sheet, r);
  return { x, y };
};

/** One printed page: the paper, with its header and footer in the margins and the cells, charts and pictures inside them. */
function PageView({ session, sheet, layout, page, printed }: { session: SheetSession; sheet: Sheet; layout: PrintLayout; page: PrintPage; printed: PrintedPage }) {
  const setup = sheet.page;
  const { paper, margins, scale } = layout;
  const k = scale / 100;
  const availW = paper.width - margins.left - margins.right;
  const availH = paper.height - margins.top - margins.bottom;
  const shownW = printed.width * k;
  const shownH = printed.height * k;
  const left = setup?.centerHorizontally ? Math.max(0, (availW - shownW) / 2) : 0;
  const top = setup?.centerVertically ? Math.max(0, (availH - shownH) / 2) : 0;
  // Draft quality prints no charts or pictures.
  const objects = !printed.graphics ? [] : [
    ...(sheet.images ?? []).map((o) => ({ kind: "image" as const, o })),
    ...(sheet.charts ?? []).map((o) => ({ kind: "chart" as const, o })),
  ];
  const area = { x: printed.origin.x, y: printed.origin.y };
  // The part of the sheet this page's cells cover, in pixels, so that only objects reaching into it are drawn.
  const mainPx = { w: printed.main.width / 0.75, h: printed.main.height / 0.75 };
  const hf = (parts: PrintedPage["header"], style: CSSProperties) => (
    <div className="pli-print-hf" style={{ left: `${margins.left}pt`, right: `${margins.right}pt`, ...style }}>
      <span className="pli-print-hf-left"><Runs runs={parts.left} mono={printed.mono} /></span>
      <span className="pli-print-hf-center"><Runs runs={parts.center} mono={printed.mono} /></span>
      <span className="pli-print-hf-right"><Runs runs={parts.right} mono={printed.mono} /></span>
    </div>
  );
  return (
    <div className="pli-print-page" data-page={page.number} style={{ width: `${paper.width}pt`, height: `${paper.height}pt` }}>
      {hf(printed.header, { top: `${margins.header}pt` })}
      <div className="pli-print-content" style={{ left: `${margins.left}pt`, top: `${margins.top}pt`, width: `${availW}pt`, height: `${availH}pt`, filter: setup?.blackAndWhite ? "grayscale(1)" : undefined }}>
        <div className="pli-print-scaled" style={{ left: `${left}pt`, top: `${top}pt`, width: `${printed.width}pt`, height: `${printed.height}pt`, transform: `scale(${k})` }}>
          <div dangerouslySetInnerHTML={{ __html: printed.html }} />
          <div className="pli-print-objects" style={{ left: `${printed.main.x}pt`, top: `${printed.main.y}pt`, width: `${printed.main.width}pt`, height: `${printed.main.height}pt` }}>
            {objects.map(({ kind, o }) => {
              const at = offsetOf(sheet, o.from.row, o.from.col, o.from.dx, o.from.dy);
              const x = at.x - area.x;
              const y = at.y - area.y;
              if (x > mainPx.w || y > mainPx.h || x + o.width < 0 || y + o.height < 0) return null;
              return (
                <div key={o.id} style={{ position: "absolute", left: `${x}px`, top: `${y}px`, width: `${o.width}px`, height: `${o.height}px`, ...(kind === "image" ? pictureBoxStyle(o as SheetImage) : {}) }}>
                  {kind === "image" ? <PictureBody image={o as SheetImage} w={o.width} h={o.height} /> : <ChartView chart={o as NonNullable<Sheet["charts"]>[number]} data={session.chartData(sheet.id, o.id)} />}
                </div>
              );
            })}
          </div>
          {printed.notes.length > 0 && (
            <div className="pli-print-notes" style={{ left: `${printed.main.x}pt`, top: `${printed.main.y}pt`, width: `${printed.main.width}pt`, height: `${printed.main.height}pt` }}>
              {printed.notes.map((n) => (
                <div key={n.cell} className="pli-print-note" data-cell={n.cell} style={{ left: `${n.x}pt`, top: `${n.y}pt`, width: `${n.width}pt`, height: `${n.height}pt`, ...(printed.mono ? { background: "#fff" } : {}) }}><NoteContent info={{ text: n.text, ...(n.runs ? { runs: n.runs } : {}), ...(n.author ? { author: n.author } : {}) }} /></div>
              ))}
            </div>
          )}
        </div>
      </div>
      {hf(printed.footer, { bottom: `${margins.footer}pt` })}
    </div>
  );
}

/** Sends the pages to the printer through a page of their own, so that nothing else on screen is printed. */
function printPages(pages: HTMLElement, layout: PrintLayout): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.append(frame);
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) return frame.remove();
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print</title></head><body></body></html>`);
  doc.close();
  // The page's own styles, for the charts and the cells' look.
  for (const node of document.querySelectorAll("style, link[rel=stylesheet]")) doc.head.append(doc.importNode(node, true));
  const style = doc.createElement("style");
  style.textContent = `@page{size:${layout.paper.width}pt ${layout.paper.height}pt;margin:0}html,body{margin:0;padding:0;background:#fff}.pli-print-page{break-after:page;page-break-after:always;box-shadow:none!important;margin:0!important}.pli-print-page:last-child{break-after:auto;page-break-after:auto}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
  doc.head.append(style);
  const root = doc.createElement("div");
  root.className = "pli-spreadsheet pli-print-root";
  root.style.height = "auto";
  for (const page of pages.querySelectorAll(".pli-print-page")) root.append(doc.importNode(page, true));
  doc.body.append(root);
  const finish = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener("afterprint", finish);
  setTimeout(() => {
    win.focus();
    win.print();
    // Some browsers never say the printing is over.
    setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  }, 50);
}

const safeName = (title: string) => (title.trim() || "Untitled").replace(/[\\/:*?"<>|]+/g, "-");

/** The pages a sheet prints on, as they will come out, with page by page navigation and buttons to download them as a PDF or hand them to the host's printing. */
export function PrintPreview({ session, sheetId, revision, onClose, onSetup, container, remoteImages = false, onFile, onPrint, browserPrint = false }: PrintPreviewProps) {
  const sheet = session.state.sheets.find((s) => s.id === sheetId)!;
  const [zoom, setZoom] = useState(0.6);
  const [current, setCurrent] = useState(1);
  const [single, setSingle] = useState(false);
  const [busy, setBusy] = useState<"pdf" | "print" | null>(null);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const { layout, printed } = useMemo(() => {
    const l = session.printLayout(sheetId);
    return { layout: l, printed: l.pages.map((p) => session.printPage(sheetId, p, { remoteImages })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, sheetId, revision, remoteImages]);
  useEffect(() => overlay.current?.focus(), []);
  // The browser's dialog prints every page there is on screen, so all of them have to be.
  const [pendingBrowser, setPendingBrowser] = useState(false);
  useEffect(() => {
    if (!pendingBrowser || single || !pagesRef.current) return;
    setPendingBrowser(false);
    printPages(pagesRef.current, layout);
  }, [pendingBrowser, single, layout]);
  const count = layout.pages.length;
  const at = Math.min(Math.max(1, current), Math.max(1, count));
  const go = (n: number) => {
    const next = Math.min(Math.max(1, n), Math.max(1, count));
    setCurrent(next);
    // In the list of all pages, bring that page to the top.
    const el = pagesRef.current?.children[next - 1] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "start" });
  };
  /** The page nearest the top of the list of all pages, as the person scrolls. */
  const follow = (e: React.UIEvent<HTMLDivElement>) => {
    if (single || !pagesRef.current) return;
    const top = e.currentTarget.scrollTop;
    const kids = [...pagesRef.current.children] as HTMLElement[];
    if (!kids.some((k) => k.offsetTop > 0)) return;
    let best = 0;
    kids.forEach((k, i) => {
      if (k.offsetTop - 24 <= top) best = i;
    });
    setCurrent(best + 1);
  };

  const fonts = useFonts();
  const makePdf = async (): Promise<PrintPdfResult> => {
    // Google families and the like are embedded (fetched from the fonts registry's source) instead of drawn as Helvetica.
    const fetched = await fonts.pdfFonts(usedFonts(session.state));
    const result = await printToPdf(session, sheetId, { remoteImages, title: session.state.title, rasterize: browserRasterizer(session), fonts: fetched.fonts });
    result.warnings.push(...fetched.warnings);
    return result;
  };
  const pdfName = `${safeName(session.state.title)}${session.state.sheets.length > 1 ? ` - ${safeName(sheet.name)}` : ""}.pdf`;
  const run = async (kind: "pdf" | "print") => {
    if (busy || count === 0) return;
    setBusy(kind);
    setStatus({ text: "Preparing the PDF…" });
    try {
      const result = await makePdf();
      if (kind === "pdf") {
        onFile?.(pdfName, result.bytes, "application/pdf");
        setStatus({ text: `Saved ${pdfName}${result.warnings.length ? `. Note: ${result.warnings.join("; ")}` : ""}` });
      } else {
        await onPrint?.({ sheet: sheet.name, file: { name: pdfName, type: "application/pdf", data: result.bytes }, pages: result.pages, paper: layout.paper, warnings: result.warnings, layout, printed });
        setStatus({ text: `Sent ${result.pages} page${result.pages === 1 ? "" : "s"} to print${result.warnings.length ? `. Note: ${result.warnings.join("; ")}` : ""}` });
      }
    } catch (e) {
      setStatus({ text: `That couldn't be done${e instanceof Error && e.message ? `: ${e.message}` : ""}`, error: true });
    } finally {
      setBusy(null);
    }
  };
  const shown = single ? [at - 1] : layout.pages.map((_, i) => i);

  return createPortal(
    <div
      ref={overlay}
      className="pli-print-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Print preview"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") return onClose();
        const el = e.target as HTMLElement;
        if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
        if (e.key === "PageDown" || (e.key === "ArrowRight" && single)) (e.preventDefault(), go(at + 1));
        else if (e.key === "PageUp" || (e.key === "ArrowLeft" && single)) (e.preventDefault(), go(at - 1));
        else if (e.key === "Home") (e.preventDefault(), go(1));
        else if (e.key === "End") (e.preventDefault(), go(count));
      }}
    >
      <div className="pli-print-bar">
        <strong>Print preview</strong>
        <span aria-live="polite">{count === 0 ? "Nothing to print" : `${count} page${count === 1 ? "" : "s"} at ${layout.scale}%`}</span>
        <span className="pli-print-pager" role="group" aria-label="Pages">
          <button type="button" className="pli-button" aria-label="First page" disabled={count === 0 || at === 1} onClick={() => go(1)}>{"⏮"}</button>
          <button type="button" className="pli-button" aria-label="Previous page" disabled={count === 0 || at === 1} onClick={() => go(at - 1)}>{"◀"}</button>
          <label>
            Page
            <input type="number" aria-label="Page number" min={1} max={Math.max(1, count)} value={at} disabled={count === 0} onChange={(e) => e.target.value !== "" && go(Number(e.target.value))} />
          </label>
          <span aria-label="Number of pages">of {count}</span>
          <button type="button" className="pli-button" aria-label="Next page" disabled={count === 0 || at === count} onClick={() => go(at + 1)}>{"▶"}</button>
          <button type="button" className="pli-button" aria-label="Last page" disabled={count === 0 || at === count} onClick={() => go(count)}>{"⏭"}</button>
        </span>
        <label className="pli-print-single">
          <input type="checkbox" aria-label="One page at a time" checked={single} onChange={(e) => setSingle(e.target.checked)} />
          One page at a time
        </label>
        <span className="pli-print-spacer" />
        <label>
          Zoom
          <select aria-label="Zoom" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {[0.4, 0.6, 0.8, 1].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
          </select>
        </label>
        <button type="button" className="pli-button" onClick={onSetup}>Page setup…</button>
        <button type="button" className={`pli-button${onPrint ? "" : " pli-button-primary"}`} disabled={count === 0 || busy !== null} onClick={() => void run("pdf")}>Download PDF</button>
        {onPrint && <button type="button" className="pli-button pli-button-primary" disabled={count === 0 || busy !== null} onClick={() => void run("print")}>Print</button>}
        {browserPrint && <button type="button" className="pli-button" disabled={count === 0} onClick={() => (setSingle(false), setPendingBrowser(true))}>Print with the browser…</button>}
        <button type="button" className="pli-button" onClick={onClose}>Close</button>
        {status && <span className="pli-print-status" role="status" data-error={status.error ? "" : undefined}>{status.text}</span>}
      </div>
      <div className="pli-print-scroll" onScroll={follow}>
        {count === 0 ? (
          <p className="pli-print-empty">There is nothing on this sheet to print.</p>
        ) : (
          <div ref={pagesRef} className="pli-print-pages">
            {shown.map((i) => {
              const p = layout.pages[i]!;
              return (
                <div key={p.number + ":" + i} className="pli-print-sheet" data-index={i + 1} aria-current={i + 1 === at ? "page" : undefined} style={{ width: `${layout.paper.width * (4 / 3) * zoom}px`, height: `${layout.paper.height * (4 / 3) * zoom}px` }}>
                  <div style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: `${layout.paper.width}pt`, height: `${layout.paper.height}pt` }}>
                    <PageView session={session} sheet={sheet} layout={layout} page={p} printed={printed[i]!} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>,
    container ?? document.body,
  );
}
