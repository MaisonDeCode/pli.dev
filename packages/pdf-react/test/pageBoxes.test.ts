// @vitest-environment node
// The page the viewer lays out (the engine's `Page.width` and `height`) and the picture the renderer draws must be the same page:
// the same size, drawn to fill the canvas exactly, whatever the page's boxes, user unit and turn. The overlay layers (annotations,
// text, form fields) are scaled by exactly `scale`, so a picture that is a hair bigger or smaller, or drawn for another box, would
// carry the page content away from them.
import { describe, expect, it } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPdf } from "@pli.dev/pdf";
import { buildClassic, simpleDoc } from "../../pdf/test/support/handmade";
import { pdfjsRenderer } from "../src/pdfjs";
import { turnedSize } from "../src/geometry";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/pdfjs-dist");
const make = () => pdfjsRenderer({ pdfjs: pdfjs as never, standardFontDataUrl: path.join(root, "standard_fonts") + "/" });

/** `box` is the visible box in user space [x0, y0, x1, y1]: the CropBox, or the MediaBox. */
const cases: { name: string; mediaBox: string; extra: string; box: [number, number, number, number]; size: [number, number]; rotate: number }[] = [
  { name: "a plain page", mediaBox: "[0 0 612 792]", extra: "", box: [0, 0, 612, 792], size: [612, 792], rotate: 0 },
  { name: "a media box with an origin", mediaBox: "[-50 -20 562 772]", extra: "", box: [-50, -20, 562, 772], size: [612, 792], rotate: 0 },
  { name: "a crop box with an origin", mediaBox: "[0 0 612 792]", extra: "/CropBox [40 60 340 460]", box: [40, 60, 340, 460], size: [300, 400], rotate: 0 },
  { name: "a user unit of 2", mediaBox: "[0 0 300 400]", extra: "/UserUnit 2", box: [0, 0, 300, 400], size: [300, 400], rotate: 0 },
  { name: "a page turned 90 degrees", mediaBox: "[0 0 300 400]", extra: "/Rotate 90", box: [0, 0, 300, 400], size: [300, 400], rotate: 90 },
  { name: "a page turned 180 degrees", mediaBox: "[0 0 300 400]", extra: "/Rotate 180", box: [0, 0, 300, 400], size: [300, 400], rotate: 180 },
  { name: "a crop box, a user unit and 270 degrees together", mediaBox: "[0 0 612 792]", extra: "/CropBox [40 60 340 460] /UserUnit 2 /Rotate 270", box: [40, 60, 340, 460], size: [300, 400], rotate: 270 },
];

/** A page with a black line, one point wide, along each edge of the visible box. */
const frame = ([x0, y0, x1, y1]: [number, number, number, number]) => `0 g ${x0} ${y0} 1 ${y1 - y0} re f ${x1 - 1} ${y0} 1 ${y1 - y0} re f ${x0} ${y0} ${x1 - x0} 1 re f ${x0} ${y1 - 1} ${x1 - x0} 1 re f`;

// Scales with a fraction in them, so that the canvas (rounded up) is not the page times the scale.
const SCALES = [0.9, 1.5, 2.2501, 3.3333];

for (const c of cases) {
  describe(`the engine and the renderer agree on ${c.name}`, () => {
    const bytes = buildClassic(simpleDoc(1, { mediaBox: c.mediaBox, pageExtra: () => c.extra, text: () => frame(c.box) })).bytes;

    it("the model's page size is the renderer's, and the page's own turn is the same", async () => {
      const page = (await openPdf(bytes)).doc.pages[0]!;
      expect([page.width, page.height, page.rotate]).toEqual([c.size[0], c.size[1], c.rotate]);
      const rendered = await (await make().open(bytes.slice())).page(0);
      expect([rendered.width, rendered.height, rendered.rotate]).toEqual([c.size[0], c.size[1], c.rotate]);
    });

    for (const scale of SCALES) {
      it(`draws a canvas of the page at ${scale} (rounded up) with the page filling all of it, at every turn of the view`, async () => {
        const rendered = await (await make().open(bytes.slice())).page(0);
        for (const turn of [0, 90, 180, 270]) {
          const rotation = (c.rotate + turn) % 360;
          const canvas = createCanvas(1, 1) as unknown as HTMLCanvasElement;
          await rendered.render({ canvas, scale, rotation });
          const t = turnedSize(c.size[0], c.size[1], rotation);
          // The size is the page's (not the user unit times it), as documented: the viewer allots memory by it.
          expect([canvas.width, canvas.height], `turn ${turn}`).toEqual([Math.max(1, Math.ceil(t.width * scale)), Math.max(1, Math.ceil(t.height * scale))]);
          // The line along each edge is on the canvas's last pixels: the picture is stretched over the whole canvas, not drawn a fraction
          // of a pixel short of it (which moves everything on it, by up to a pixel at the far edge, away from the layers laid over it).
          const ctx = (canvas as never as { getContext(t: string): CanvasRenderingContext2D }).getContext("2d");
          const mx = Math.floor(canvas.width / 2);
          const my = Math.floor(canvas.height / 2);
          for (const [x, y, edge] of [[canvas.width - 1, my, "right"], [0, my, "left"], [mx, canvas.height - 1, "bottom"], [mx, 0, "top"]] as const) {
            const [r] = ctx.getImageData(x, y, 1, 1).data;
            expect(r, `turn ${turn} at ${scale}: the ${edge} edge`).toBeLessThan(110);
          }
        }
      });
    }
  });
}
