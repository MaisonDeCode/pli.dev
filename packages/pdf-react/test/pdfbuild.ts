/** A tiny PDF writer for tests: pages with Helvetica text and filled rectangles, an optional outline. No external files. */
export interface TestPage {
  width: number;
  height: number;
  /** The page's own /Rotate. */
  rotate?: number;
  /** Text lines: x and y are measured from the BOTTOM left, as in PDF. */
  texts?: { x: number; y: number; size: number; text: string }[];
  /** Filled rectangles, bottom left origin, colour as r g b in 0..1. */
  rects?: { x: number; y: number; w: number; h: number; rgb: [number, number, number] }[];
}

export interface TestOutline {
  title: string;
  page: number;
  children?: TestOutline[];
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => "\\" + c);

export function buildPdf(pages: TestPage[], outline: TestOutline[] = []): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body) && objs.length; // returns object number
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageNums: number[] = [];
  for (const p of pages) {
    let content = "";
    for (const r of p.rects ?? []) content += `${r.rgb.join(" ")} rg ${r.x} ${r.y} ${r.w} ${r.h} re f\n`;
    for (const t of p.texts ?? []) content += `0 g BT /F1 ${t.size} Tf ${t.x} ${t.y} Td (${esc(t.text)}) Tj ET\n`;
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    const num = add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${p.width} ${p.height}] ${p.rotate ? `/Rotate ${p.rotate} ` : ""}/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`,
    );
    pageNums.push(num);
  }
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageNums.length} >>`;
  let outlines = "";
  if (outline.length) {
    const root = add("");
    const build = (items: TestOutline[], parent: number): number[] => {
      const nums = items.map(() => add(""));
      items.forEach((it, i) => {
        const kids = it.children?.length ? build(it.children, nums[i]!) : [];
        const links = `${i > 0 ? `/Prev ${nums[i - 1]} 0 R ` : ""}${i < items.length - 1 ? `/Next ${nums[i + 1]} 0 R ` : ""}`;
        const sub = kids.length ? `/First ${kids[0]} 0 R /Last ${kids[kids.length - 1]} 0 R /Count ${kids.length} ` : "";
        objs[nums[i]! - 1] = `<< /Title (${esc(it.title)}) /Parent ${parent} 0 R ${links}${sub}/Dest [${pageNums[it.page]} 0 R /XYZ 0 0 null] >>`;
      });
      return nums;
    };
    const tops = build(outline, root);
    objs[root - 1] = `<< /Type /Outlines /First ${tops[0]} 0 R /Last ${tops[tops.length - 1]} 0 R /Count ${tops.length} >>`;
    outlines = ` /Outlines ${root} 0 R`;
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${outlines} >>`;
  let out = "%PDF-1.7\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
