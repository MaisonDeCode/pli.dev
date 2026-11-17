import { isError, toNumber, toText, VALUE } from "../values";
import { scalar } from "./helpers";
import type { Arg, FunctionDef } from "./types";

const HTTPS = /^https:\/\/[^\s/][^\s]*$/i;
const DATA = /^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_SOURCE = 2083;

/**
 * `IMAGE(source, [alt_text], [sizing], [height], [width])` shows a picture in the cell. The picture is not a value that
 * formulas can use: the cell's value is the text that goes with it (the description, or the address when there is none),
 * and the grid draws the picture over that text. `source` is an `https://` address, or a `data:` URI of a PNG, JPEG or GIF.
 * Sizing is 0 to fit the cell (the default), 1 to fill it, 2 to keep the picture's own size, 3 for the height and width given.
 */
export const imageFunctions: Record<string, FunctionDef> = {
  IMAGE: {
    min: 1,
    max: 5,
    fn: (args, ctx) => {
      const source = scalar(args[0] as Arg, ctx);
      if (isError(source)) return source;
      const src = String(toText(source)).trim();
      if (src.length > MAX_SOURCE * 40 || (!DATA.test(src) && (src.length > MAX_SOURCE || !HTTPS.test(src)))) return VALUE;
      let alt: string | undefined;
      if (args[1] !== undefined) {
        const a = scalar(args[1] as Arg, ctx);
        if (isError(a)) return a;
        const text = a === null ? "" : String(toText(a));
        if (text !== "") alt = text.slice(0, 1000);
      }
      let sizing: 0 | 1 | 2 | 3 = 0;
      if (args[2] !== undefined) {
        const z = toNumber(scalar(args[2] as Arg, ctx));
        if (isError(z)) return z;
        if (z !== 0 && z !== 1 && z !== 2 && z !== 3) return VALUE;
        sizing = z;
      }
      let height: number | undefined;
      let width: number | undefined;
      if (sizing === 3) {
        const h = args[3] === undefined ? Number.NaN : toNumber(scalar(args[3] as Arg, ctx));
        const w = args[4] === undefined ? Number.NaN : toNumber(scalar(args[4] as Arg, ctx));
        if (isError(h)) return h;
        if (isError(w)) return w;
        if (!(h > 0 && h <= 4000 && w > 0 && w <= 4000)) return VALUE;
        height = h;
        width = w;
      }
      const text = alt ?? (DATA.test(src) ? "" : src);
      ctx.host.image({ src, text, ...(alt ? { alt } : {}), sizing, ...(height !== undefined ? { height, width } : {}) });
      return text;
    },
  },
};
