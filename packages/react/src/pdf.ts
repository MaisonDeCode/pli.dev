import { PliError, toPdf, type PdfImage, type PdfItem, type PdfLink, type PdfOptions, type PdfPage } from "@pli.dev/docs";

/** CSS pixels to PDF points. */
const PT = 0.75;

export interface PdfExportOptions extends Omit<PdfOptions, "warnings"> {
  /**
   * The largest a picture is stored, as a multiple of the size it is shown at. Larger pictures are scaled down so the
   * file stays small. Default 2.
   */
  imageDetail?: number;
}

export interface PdfExport {
  bytes: Uint8Array;
  /** What couldn't be done as written: a character no font has, a picture from another site. */
  warnings: string[];
}

/** Things drawn on the page by the editor only: markers, handles, hints and other people's cursors. */
const SKIP = [
  ".pli-spacer", ".pli-measure", ".pli-region-hint", ".pli-region-bar-page", ".pli-page-break", ".pli-section-break", ".pli-col-resizer",
  ".pli-row-resizer", ".pli-table-grip", ".pli-image-handle", ".pli-remote-layer", ".pli-note-done", ".pli-region-done", "style", "script",
  "[data-pli-spacer]", "[data-pli-editor-chrome]",
].join(",");

/** The next frame, or a moment later if the page is hidden and the browser isn't drawing frames. */
const nextFrame = () => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, 60);
  requestAnimationFrame(() => {
    clearTimeout(timer);
    resolve();
  });
});

/** `rgb()` and `rgba()` as a hex color, with see-through colors mixed with white, or null for nothing to draw. */
function paint(css: string): string | null {
  const m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.%]+))?\s*\)$/i.exec(css.trim());
  if (!m) return css === "transparent" || css === "" ? null : css.startsWith("#") ? css : null;
  let alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (!(alpha > 0.02)) return null;
  alpha = Math.min(alpha, 1);
  const channel = (v: string) => Math.round(255 - (255 - parseFloat(v)) * alpha);
  return `#${[m[1]!, m[2]!, m[3]!].map((v) => channel(v).toString(16).padStart(2, "0")).join("")}`;
}

const px = (value: string): number => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

/** Pictures that can go in the file as they are. */
function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: 1 | 3 | 4 } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)) {
      const components = bytes[at + 9]!;
      if (components !== 1 && components !== 3 && components !== 4) return null;
      return { height: (bytes[at + 5]! << 8) | bytes[at + 6]!, width: (bytes[at + 7]! << 8) | bytes[at + 8]!, components };
    }
    at += 2 + length;
  }
  return null;
}

function bytesOfDataUri(src: string): Uint8Array | null {
  const m = /^data:[^;,]+;base64,(.*)$/is.exec(src);
  if (!m) return null;
  try {
    const binary = atob(m[1]!);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Fonts' ascent, by the CSS font, as the browser measures them: where the baseline sits in a line of text. */
const ascents = new Map<string, number>();
let measuring: CanvasRenderingContext2D | null = null;
function ascentOf(font: string): number {
  let value = ascents.get(font);
  if (value === undefined) {
    measuring ??= document.createElement("canvas").getContext("2d");
    if (measuring) {
      measuring.font = font;
      const m = measuring.measureText("Mg");
      value = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
    }
    value ??= 0;
    ascents.set(font, value);
  }
  return value;
}

function widthOf(font: string, text: string): number {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (!measuring) return text.length * 6;
  measuring.font = font;
  return measuring.measureText(text).width;
}

interface Sheet {
  element: HTMLElement;
  rect: DOMRect;
  /** Client pixels per CSS pixel: the zoom the pages are shown at. */
  scale: number;
  page: PdfPage;
}

/**
 * Reads what the editor drew on each page and returns it as a PDF. The pages are exactly as laid out: every
 * line of text is where the browser put it, every border and shading where the browser drew it. The editor
 * must be showing pages, not the continuous view. Pass the `.pli-document` element (or any element around the pages).
 *
 * Pages are drawn in a light theme whatever the editor is showing, so a document read in dark mode still prints black on white.
 */
export async function exportPdf(root: HTMLElement, options: PdfExportOptions = {}): Promise<PdfExport> {
  const document_ = root.ownerDocument;
  const container = (root.matches(".pli-document") ? root : root.closest(".pli-document")) ?? root;
  const sheetsFound = [...root.querySelectorAll<HTMLElement>(".pli-sheet[data-page]")];
  if (sheetsFound.length === 0) throw new PliError("unsupported", "PDF export needs the page view: switch from Pageless to Pages first");

  // Light paper, whatever the theme, and the fonts loaded: layout is read from what the browser has drawn.
  const had = container.getAttribute("data-paper");
  container.setAttribute("data-paper", "light");
  try {
    await document_.fonts?.ready;
    await nextFrame();
    await nextFrame();
    return await render(root, [...root.querySelectorAll<HTMLElement>(".pli-sheet[data-page]")], options);
  } finally {
    if (had === null) container.removeAttribute("data-paper");
    else container.setAttribute("data-paper", had);
  }
}

async function render(root: HTMLElement, elements: HTMLElement[], options: PdfExportOptions): Promise<PdfExport> {
  const warnings: string[] = [];
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  const sheets: Sheet[] = elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      element,
      rect,
      scale: element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1,
      page: { width: (element.offsetWidth || rect.width) * PT, height: (element.offsetHeight || rect.height) * PT, items: [], links: [] },
    };
  });

  /** Which sheet a point is on. */
  const sheetAt = (clientY: number, clientX: number): Sheet | undefined => sheets.find((s) => clientY >= s.rect.top - 1 && clientY < s.rect.bottom + 1 && clientX >= s.rect.left - 1 && clientX <= s.rect.right + 1);
  const toPage = (sheet: Sheet, clientX: number, clientY: number) => ({ x: ((clientX - sheet.rect.left) / sheet.scale) * PT, y: ((clientY - sheet.rect.top) / sheet.scale) * PT });
  const length = (sheet: Sheet, clientPx: number) => (clientPx / sheet.scale) * PT;

  const pending: Promise<void>[] = [];
  const footnoteOrder = new Map<string, number>();
  for (const ref of root.querySelectorAll<HTMLElement>(".pli-editor-paged [data-footnote]")) {
    const id = ref.getAttribute("data-footnote")!;
    if (!footnoteOrder.has(id)) footnoteOrder.set(id, footnoteOrder.size + 1);
  }

  const fill = (sheet: Sheet, left: number, top: number, width: number, height: number, color: string) => {
    const a = toPage(sheet, left, top);
    sheet.page.items.push({ type: "rect", x: a.x, y: a.y, width: length(sheet, width), height: length(sheet, height), fill: color });
  };
  const rule = (sheet: Sheet, x1: number, y1: number, x2: number, y2: number, color: string, widthPx: number) => {
    const a = toPage(sheet, x1, y1);
    const b = toPage(sheet, x2, y2);
    sheet.page.items.push({ type: "line", x1: a.x, y1: a.y, x2: b.x, y2: b.y, color, width: Math.max(0.25, length(sheet, widthPx)) });
  };

  const drawBox = (el: Element, rect: DOMRect, cs: CSSStyleDeclaration, inset: boolean, noBackground = false) => {
    const sheet = sheetAt(rect.top + rect.height / 2, rect.left + rect.width / 2);
    if (!sheet || rect.width <= 0 || rect.height <= 0) return;
    const bg = noBackground ? null : paint(cs.backgroundColor);
    if (bg && bg !== "#ffffff") fill(sheet, rect.left, rect.top, rect.width, rect.height, bg);
    const sides = [
      ["Top", rect.left, rect.top, rect.right, rect.top],
      ["Right", rect.right, rect.top, rect.right, rect.bottom],
      ["Bottom", rect.left, rect.bottom, rect.right, rect.bottom],
      ["Left", rect.left, rect.top, rect.left, rect.bottom],
    ] as const;
    for (const [side, x1, y1, x2, y2] of sides) {
      const width = px(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
      const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
      const color = paint(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
      if (width <= 0 || !color || style === "none" || style === "hidden") continue;
      const shift = inset ? width / 2 : 0;
      const dx = side === "Left" ? shift : side === "Right" ? -shift : 0;
      const dy = side === "Top" ? shift : side === "Bottom" ? -shift : 0;
      rule(sheet, x1 + dx, y1 + dy, x2 + dx, y2 + dy, color, width);
    }
    void el;
  };

  // ---- Text ----

  const decorationsOf = (el: Element): { underline: boolean; strike: boolean } => {
    let underline = false;
    let strike = false;
    for (let at: Element | null = el, depth = 0; at && depth < 8; at = at.parentElement, depth++) {
      const style = view.getComputedStyle(at);
      const line = style.textDecorationLine;
      if (line.includes("underline")) underline = true;
      if (line.includes("line-through")) strike = true;
      if (style.display !== "inline" && at !== el) break;
    }
    return { underline, strike };
  };

  const text = (node: Text) => {
    const el = node.parentElement;
    if (!el || !node.data) return;
    const cs = view.getComputedStyle(el);
    if (cs.visibility === "hidden") return;
    const size = px(cs.fontSize);
    const bold = cs.fontWeight === "bold" || parseInt(cs.fontWeight, 10) >= 600;
    const italic = cs.fontStyle !== "normal";
    const family = cs.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
    const cssFont = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    const ascent = ascentOf(cssFont);
    const color = paint(cs.color) ?? "#000000";
    const { underline, strike } = decorationsOf(el);
    const upper = cs.textTransform === "uppercase" ? (s: string) => s.toUpperCase() : cs.textTransform === "lowercase" ? (s: string) => s.toLowerCase() : (s: string) => s;

    const range = doc.createRange();
    interface Fragment { text: string; left: number; right: number; top: number }
    const fragments: Fragment[] = [];
    let current: Fragment | null = null;
    let lastRight = 0;
    let lastTop = 0;
    for (let i = 0; i < node.data.length; ) {
      const code = node.data.codePointAt(i)!;
      const step = code > 0xffff ? 2 : 1;
      const ch = node.data.slice(i, i + step);
      range.setStart(node, i);
      range.setEnd(node, i + step);
      i += step;
      const rects = range.getClientRects();
      const r = rects[0];
      if (!r || (r.width === 0 && /\s|​/.test(ch))) continue;
      const newLine = !current || Math.abs(r.top - lastTop) > size * 0.3 || r.left < lastRight - 2;
      if (newLine) {
        current = { text: "", left: r.left, right: r.right, top: r.top };
        fragments.push(current);
      }
      current!.text += ch;
      if (!/\s/.test(ch)) current!.right = r.right;
      lastRight = r.right;
      lastTop = r.top;
    }
    for (const fragment of fragments) {
      const shown = upper(fragment.text.replace(/\s+$/, ""));
      if (shown.trim() === "" && !underline) continue;
      const sheet = sheetAt(fragment.top + size / 2, fragment.left + 1);
      if (!sheet) continue;
      const baseline = fragment.top + ascent;
      const where = toPage(sheet, fragment.left, baseline);
      const item: PdfItem = { type: "text", x: where.x, y: where.y, text: shown.replace(/\t/g, " "), font: { family, bold, italic }, size: length(sheet, size), color, width: length(sheet, fragment.right - fragment.left) };
      sheet.page.items.push(item);
      const thickness = Math.max(0.5, length(sheet, size / 16));
      if (underline) rule(sheet, fragment.left, baseline + size * 0.1, fragment.right, baseline + size * 0.1, color, thickness / PT * sheet.scale);
      if (strike) rule(sheet, fragment.left, baseline - size * 0.28, fragment.right, baseline - size * 0.28, color, thickness / PT * sheet.scale);
    }
  };

  // ---- Pictures ----

  const image = (img: HTMLImageElement, cs: CSSStyleDeclaration) => {
    const rect = img.getBoundingClientRect();
    const sheet = sheetAt(rect.top + rect.height / 2, rect.left + rect.width / 2);
    if (!sheet || rect.width <= 0 || rect.height <= 0 || cs.visibility === "hidden") return;
    const where = toPage(sheet, rect.left, rect.top);
    const placed: { x: number; y: number; width: number; height: number; clip?: { x: number; y: number; width: number; height: number } } = { x: where.x, y: where.y, width: length(sheet, rect.width), height: length(sheet, rect.height) };
    // A cropped picture is drawn bigger than its frame, which hides the rest: only what is inside the frame goes on the page.
    const frame = img.parentElement && getComputedStyle(img.parentElement).overflow === "hidden" ? img.parentElement.getBoundingClientRect() : null;
    if (frame) {
      const at = toPage(sheet, frame.left, frame.top);
      placed.clip = { x: at.x, y: at.y, width: length(sheet, frame.width), height: length(sheet, frame.height) };
    }
    const bytes = bytesOfDataUri(img.currentSrc || img.src);
    const jpeg = bytes ? jpegInfo(bytes) : null;
    if (bytes && jpeg) {
      sheet.page.items.push({ type: "image", ...placed, image: { jpeg: bytes, ...jpeg } satisfies PdfImage });
      return;
    }
    const item: PdfItem = { type: "image", ...placed, image: { rgba: new Uint8Array(4), width: 1, height: 1 } };
    sheet.page.items.push(item);
    pending.push(
      (async () => {
        try {
          // A picture the page already has needs no waiting for; one still arriving is given a moment.
          if (!(img.complete && img.naturalWidth > 0)) await Promise.race([img.decode?.().catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
          const detail = options.imageDetail ?? 2;
          const wanted = Math.max(1, Math.ceil(rect.width / sheet.scale * detail));
          const ratio = Math.min(1, wanted / (img.naturalWidth || wanted));
          const width = Math.max(1, Math.round((img.naturalWidth || rect.width) * ratio));
          const height = Math.max(1, Math.round((img.naturalHeight || rect.height) * ratio));
          const canvas = doc.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d")!;
          context.drawImage(img, 0, 0, width, height);
          item.image = { rgba: new Uint8Array(context.getImageData(0, 0, width, height).data.buffer), width, height };
        } catch {
          warnings.push("A picture couldn't be read (it comes from another site that doesn't allow it) and was left as a gray box");
          Object.assign(item, { type: "rect", fill: "#e5e7eb" });
        }
      })(),
    );
  };

  // ---- The walk ----

  const hasLink = (a: HTMLAnchorElement) => {
    const href = a.getAttribute("href");
    if (!href) return;
    for (const r of a.getClientRects()) {
      const sheet = sheetAt(r.top + r.height / 2, r.left + 1);
      if (!sheet || r.width < 1) continue;
      const where = toPage(sheet, r.left, r.top);
      (sheet.page.links as PdfLink[]).push({ x: where.x, y: where.y, width: length(sheet, r.width), height: length(sheet, r.height), url: a.href });
    }
  };

  const listMarker = (el: HTMLElement, rect: DOMRect, cs: CSSStyleDeclaration) => {
    const marker = el.getAttribute("data-marker");
    if (!marker) return;
    const before = view.getComputedStyle(el, "::before");
    const size = px(cs.fontSize);
    const cssFont = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    const ascent = ascentOf(cssFont);
    const descent = measuring?.measureText("Mg").fontBoundingBoxDescent ?? size * 0.25;
    const lineHeight = cs.lineHeight === "normal" ? ascent + descent : px(cs.lineHeight);
    const top = rect.top + px(cs.paddingTop) + px(cs.borderTopWidth) + (lineHeight - (ascent + descent)) / 2;
    const boxLeft = rect.left + px(cs.borderLeftWidth) + px(before.left);
    const right = boxLeft + px(before.width);
    const sheet = sheetAt(top + size / 2, right);
    if (!sheet) return;
    const textWidth = widthOf(cssFont, marker);
    const where = toPage(sheet, right - textWidth, top + ascent);
    const family = cs.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
    sheet.page.items.push({
      type: "text",
      x: where.x,
      y: where.y,
      text: marker,
      font: { family, bold: cs.fontWeight === "bold" || parseInt(cs.fontWeight, 10) >= 600, italic: cs.fontStyle !== "normal" },
      size: length(sheet, size),
      color: paint(cs.color) ?? "#000000",
      width: length(sheet, textWidth),
    });
  };

  const footnoteNumber = (el: HTMLElement) => {
    const id = el.getAttribute("data-footnote");
    const n = id ? footnoteOrder.get(id) : undefined;
    if (n === undefined) return;
    const after = view.getComputedStyle(el, "::after");
    const parent = view.getComputedStyle(el.parentElement ?? el);
    const size = px(after.fontSize) || px(parent.fontSize) * 0.72;
    const rects = (() => {
      const range = doc.createRange();
      range.selectNodeContents(el);
      return range.getClientRects();
    })();
    const r = rects[0] ?? el.getBoundingClientRect();
    const parentSize = px(parent.fontSize);
    const cssFont = `${after.fontStyle} ${after.fontWeight} ${size}px ${parent.fontFamily}`;
    const baseline = r.top + ascentOf(`${parent.fontStyle} ${parent.fontWeight} ${parentSize}px ${parent.fontFamily}`) - parentSize * 0.35;
    const sheet = sheetAt(baseline, r.left + 1);
    if (!sheet) return;
    const label = String(n);
    const where = toPage(sheet, r.left, baseline);
    const family = parent.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
    sheet.page.items.push({ type: "text", x: where.x, y: where.y, text: label, font: { family, bold: true }, size: length(sheet, size), color: paint(after.color) ?? "#000000", width: length(sheet, widthOf(cssFont, label)) });
  };

  /** A rule drawn by CSS on `::before`, such as the short line above a page's footnotes. */
  const pseudoRule = (el: Element, rect: DOMRect, cs: CSSStyleDeclaration) => {
    const before = view.getComputedStyle(el, "::before");
    if (before.content === "none" || before.content === "normal" || before.position !== "absolute") return;
    const width = px(before.borderTopWidth);
    const color = paint(before.borderTopColor);
    if (width <= 0 || !color || before.borderTopStyle === "none") return;
    const left = rect.left + px(cs.borderLeftWidth) + px(before.left);
    const top = rect.top + px(cs.borderTopWidth) + px(before.top);
    const sheet = sheetAt(top, left + 1);
    if (sheet) rule(sheet, left, top + width / 2, left + px(before.width), top + width / 2, color, width);
  };

  const walk = (el: Element): void => {
    if (el.matches(SKIP)) return;
    const cs = view.getComputedStyle(el);
    if (cs.display === "none") return;
    const rect = el.getBoundingClientRect();
    const isSheet = el.classList.contains("pli-sheet");
    if (!isSheet && cs.visibility !== "hidden" && !el.classList.contains("pli-comment")) {
      const table = el.closest("table");
      const collapsed = !!table && view.getComputedStyle(table).borderCollapse === "collapse" && /^(td|th)$/i.test(el.tagName);
      drawBox(el, rect, cs, !collapsed);
    }
    if (el instanceof HTMLImageElement) return image(el, cs);
    if (el.matches('[data-type="list_item"]')) listMarker(el as HTMLElement, rect, cs);
    if (el.classList.contains("pli-notes")) pseudoRule(el, rect, cs);
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text(child as Text);
      else if (child.nodeType === Node.ELEMENT_NODE) walk(child as Element);
    }
    if (el.classList.contains("pli-footnote-ref")) footnoteNumber(el as HTMLElement);
    if (el instanceof HTMLAnchorElement) hasLink(el);
  };

  // The sheets hold the headers, footers and notes; the body is the editor beside them. Both are read.
  const canvas = elements[0]!.parentElement!;
  for (const child of canvas.children) walk(child);
  await Promise.all(pending);

  const pages = sheets.map((s) => s.page);
  const own: string[] = [];
  const bytes = toPdf(pages, { ...options, warnings: own });
  return { bytes, warnings: [...warnings, ...own] };
}
