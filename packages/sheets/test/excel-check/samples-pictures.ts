import { strFromU8, strToU8 } from "fflate";
import { SheetSession, createWorkbook, encodePng, toDataUri } from "../../src";
import { encodeJxr } from "../../src/jxr";
import type { Sample } from "./samples";

/*
 * Kit file 45: the artistic effect of a picture. Excel's own copies of kit files 27 and 37 had no effect left (it kept the
 * picture as drawn and dropped the `a14:imgProps` that makes it an effect), when the original in the layer was a PNG. The
 * layer is now an HD Photo file, the way Excel writes it. This file writes the same Blur eight ways, so that if Excel still
 * drops the effect from the first, the others say which part of the form it wants.
 */

const NOW = () => 45_000.5;

function readMe(s: SheetSession, title: string, see: string[]): void {
  s.setValues("Read me", "A1", [[title], ["Open this in Excel (and upload it to Google Sheets) and look for:"], ...see.map((line, i) => [`${i + 1}. ${line}`])]);
  s.setStyle("Read me", "A1", { bold: true, fontSize: 14 });
  s.setColumnWidth("Read me", 1, 110);
  s.setStyle("Read me", `A3:A${2 + see.length}`, { wrap: true, vAlign: "top" });
}

const W = 120;
const H = 90;
/** The coloured scene the effects are shown on; with `clear`, the corners are see-through. */
function scene(clear: boolean): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = [60 + (x * 140) / W, 120 + (y * 100) / H, 200 - (x * 80) / W];
      if ((x - 42) ** 2 + (y - 40) ** 2 < 600) c = [230, 80, 60];
      if (x > 66 && x < 106 && y > 36 && y < 72) c = [250, 230, 90];
      if (y > 78) c = [70, 130, 70];
      const corner = clear && (x < 14 || x >= W - 14) && (y < 14 || y >= H - 14);
      data.set([...c, corner ? 0 : 255], (y * W + x) * 4);
    }
  }
  return data;
}

/** The forms: the label in the sheet, and what is different about the file. */
const FORMS = [
  ["A. As Pli writes it", "the layer is an HD Photo (.wdp) with one level of overlap, as the reference encoder writes by default"],
  ["B. HD Photo without overlap", "the layer is an HD Photo coded without overlap between blocks"],
  ["C. HD Photo with two levels of overlap", "the layer is an HD Photo coded with two levels of overlap"],
  ["D. Relationship of the plain picture kind", "the layer's relationship is the plain picture one, not the HD Photo one"],
  ["E. Without useLocalDpi", "the picture's second extension (useLocalDpi) is left out"],
  ["F. Layer is a PNG (what the first version wrote)", "the layer is a PNG; this is the form Excel dropped, so it is the control"],
  ["G. With transparent corners", "the original has see-through corners, so the HD Photo has an alpha plane"],
  ["H. Blur at level 40", "the same as A with a stronger Blur, to see whether the radius is kept"],
] as const;

export const PICTURE_SAMPLES: Sample[] = [
  {
    file: "45-pictures-layer-forms.xlsx",
    title: "Pictures: the artistic effect's original written eight ways",
    see: [
      "Excel should open this without a repair message. If it offers to repair the file, say so and what the repair log names (the likeliest cause is the HD Photo parts).",
      `The eight, as they are written: ${FORMS.map(([label, what]) => `${label.slice(0, 1)}: ${what}`).join("; ")}.`,
      "Eight pictures of the same scene, each with a Blur and each named above it (A to H). Each should look blurred. For each one, click it and open Picture Format > Artistic Effects (the button with the little painting). Tell us which of the eight show Blur as the effect picked (and Radius 10 under Format Picture > Picture > Artistic Effects) and which show None. Picture A is the one Pli writes now.",
      "If A shows Blur: the HD Photo original was what Excel was missing, and the others tell how much of the form matters. If A shows None and some other one shows Blur, tell us which: that one is the form Excel wants. If all show None, the layer is read but dropped for something else, so say so.",
      "Then save the file into excel-check/back/ with the same name (45-pictures-layer-forms.xlsx). Whether the effect is in Excel's copy is what tells the reader which parts Excel keeps.",
      "F is the old form (a PNG as the layer) and Excel is expected to show None for it; if it shows Blur, the layer's form was never the cause.",
    ],
    build() {
      const s = new SheetSession(createWorkbook("Pictures, layer forms", ["Read me", "Forms"]), { now: NOW });
      FORMS.forEach(([label], i) => {
        const row = 3 + Math.floor(i / 4) * 7;
        const col = 2 + (i % 4) * 3;
        s.setValues("Forms", `${String.fromCharCode(64 + col)}${row - 1}`, [[label]]);
        const data = scene(i === 6);
        const src = toDataUri(encodePng({ width: W, height: H, data }), "png");
        s.addImage("Forms", { src, from: { row, col }, width: W, height: H, alt: label.slice(0, 1), artistic: { kind: "blur", level: i === 7 ? 40 : 10 } });
      });
      s.setColumnWidth("Forms", 1, 3);
      readMe(s, "Pictures, the artistic effect's original written eight ways", this.see);
      return s;
    },
    expected: /an effect's layer \(rId\d+\) isn't an HD Photo/,
    patch(files) {
      const drawing = Object.keys(files).find((k) => /^xl\/drawings\/drawing\d+\.xml$/.test(k))!;
      const relsName = drawing.replace("xl/drawings/", "xl/drawings/_rels/") + ".rels";
      let xml = strFromU8(files[drawing]!);
      let rels = strFromU8(files[relsName]!);
      /** The relationship of the layer of the picture whose description is `alt`. */
      const layer = (alt: string) => {
        const pic = new RegExp(`descr="${alt}"[\\s\\S]*?<a14:imgLayer r:embed="(rId\\d+)"`).exec(xml)!;
        const rel = new RegExp(`<Relationship Id="${pic[1]}" Type="([^"]+)" Target="\\.\\./media/([^"]+)"/>`).exec(rels)!;
        return { id: pic[1]!, xml: rel[0], type: rel[1]!, file: `xl/media/${rel[2]!}`, name: rel[2]! };
      };
      const plain = (data: Uint8ClampedArray) => ({ width: W, height: H, data });
      // B and C: other codings of the same pixels
      files[layer("B").file] = encodeJxr(plain(scene(false)), { overlap: 0 });
      files[layer("C").file] = encodeJxr(plain(scene(false)), { overlap: 2 });
      // D: the relationship of a plain picture
      const d = layer("D");
      rels = rels.replace(d.xml, d.xml.replace(d.type, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"));
      // E: no useLocalDpi in the picture
      const e = new RegExp(`(descr="E"[\\s\\S]*?)<a:ext uri="\\{28A0092B-C50C-407E-A947-70E740481C1C\\}">.*?</a:ext>`).exec(xml)!;
      xml = xml.replace(e[0], e[1]!);
      // F: a PNG as the layer
      const f = layer("F");
      const png = encodePng({ width: W, height: H, data: scene(false) });
      const pngName = "xl/media/image900.png";
      files[pngName] = png;
      delete files[f.file];
      rels = rels.replace(f.xml, f.xml.replace(f.type, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image").replace(f.name, "image900.png"));
      files[drawing] = strToU8(xml);
      files[relsName] = strToU8(rels);
    },
  },
];
