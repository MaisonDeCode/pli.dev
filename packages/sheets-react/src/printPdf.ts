import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { iconSvg, type PdfRasterizer, type SheetSession } from "@pli.dev/sheets";
import { ChartView } from "./ChartView";

/*
 * What a PDF can't hold as lines and text, drawn in the browser: a chart (its SVG, drawn on paper's colours) and the icons of
 * conditional formats, as pixels from a canvas. The engine's `printToPdf` asks for them one at a time.
 */

type Pixels = NonNullable<Awaited<ReturnType<PdfRasterizer>>>;

/** The properties copied from computed style into an SVG that is drawn on its own, where the page's stylesheet doesn't reach. */
const PAINT = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline"] as const;

/** Paper's colours for the variables the charts take their colours from, so a dark theme still prints dark on white. */
const PAPER = "--pli-bg:#ffffff;--pli-fg:#000000;--pli-border:#d4d4d4;--pli-font:Calibri,'Segoe UI',Arial,sans-serif";

/** Draws SVG markup into a canvas and gives its pixels, or undefined where there is no canvas (or the picture can't be loaded). */
async function svgToPixels(svg: string, width: number, height: number, scale = 2): Promise<Pixels | undefined> {
  if (typeof document === "undefined" || typeof Image === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const img = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (!(await loaded)) return undefined;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { rgba: new Uint8Array(data.data.buffer.slice(0)), width: data.width, height: data.height };
  } catch {
    return undefined;
  }
}

/** The SVG of a chart as a standalone picture, with the style it gets from the stylesheet written into it. */
export async function chartSvg(session: SheetSession, sheetId: string, chartId: string, width: number, height: number): Promise<string | undefined> {
  const chart = session.state.sheets.find((s) => s.id === sheetId)?.charts?.find((c) => c.id === chartId);
  if (!chart || typeof document === "undefined") return undefined;
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.className = "pli-spreadsheet";
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;overflow:hidden;${PAPER}`;
  document.body.append(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(createElement(ChartView, { chart, data: session.chartData(sheetId, chartId) })));
    const svg = host.querySelector("svg");
    if (!svg) return undefined;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const from = [svg, ...svg.querySelectorAll("*")];
    const to = [clone, ...clone.querySelectorAll("*")];
    from.forEach((el, i) => {
      const style = getComputedStyle(el);
      const target = to[i] as SVGElement;
      for (const prop of PAINT) {
        const v = style.getPropertyValue(prop);
        if (v) target.style.setProperty(prop, v);
      }
    });
    clone.querySelectorAll("title").forEach((t) => t.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    return new XMLSerializer().serializeToString(clone);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** The rasterizer the engine's `printToPdf` is given in a browser: charts and icons drawn by the page's own canvas. */
export function browserRasterizer(session: SheetSession): PdfRasterizer {
  return async (request) => {
    if (request.kind === "icon") return svgToPixels(iconSvg(request.set, request.index, request.count, request.size), request.size, request.size, 1);
    const svg = await chartSvg(session, request.sheet, request.chart.id, request.width, request.height);
    return svg ? svgToPixels(svg, request.width, request.height) : undefined;
  };
}
