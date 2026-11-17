/*
 * Excel's `mso-number-format`: the CSS property its HTML (the clipboard, "Save as web page") uses to say how a cell is
 * shown. Its value is an Excel number format written as a CSS string, so punctuation is backslash-escaped (`"0\.00"`,
 * `"\@"`, `"\0022$\0022\#\,\#\#0\.00"`, `"yyyy\\-mm\\-dd"`) and a character can be given by four hex digits (`\0022` is `"`),
 * or one of a few names (`Percent`, `Short Date`, `Fixed`…). This reads it into a Pli number format and writes one back.
 */

/** The names Excel (and Access) use for its standard formats, in lower case. */
const NAMED: Record<string, string> = {
  "general": "General",
  "general number": "General",
  "general date": "m/d/yyyy h:mm",
  "long date": "dddd, mmmm d, yyyy",
  "medium date": "d-mmm-yy",
  "short date": "m/d/yyyy",
  "long time": "h:mm:ss AM/PM",
  "medium time": "h:mm AM/PM",
  "short time": "h:mm",
  "currency": "$#,##0.00;($#,##0.00)",
  "euro currency": "[$€-2] #,##0.00",
  "fixed": "0.00",
  "standard": "#,##0.00",
  "percent": "0.00%",
  "scientific": "0.00E+00",
  "yes/no": '"Yes";"Yes";"No"',
  "true/false": '"True";"True";"False"',
  "on/off": '"On";"On";"Off"',
};

/** What a CSS string says once its escapes are taken out: `\.` is `.`, `\\` is `\`, `\0022` is `"`. */
export function cssUnescape(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const hex = /^[0-9a-fA-F]{4}/.exec(text.slice(i + 1));
    if (hex) {
      out += String.fromCodePoint(parseInt(hex[0], 16));
      i += 4;
      continue;
    }
    if (i + 1 < text.length) out += text[++i];
  }
  return out;
}

/** The value of `mso-number-format` with its outer quotes off. */
function unquote(value: string): string {
  const v = value.trim();
  const q = v[0];
  return (q === '"' || q === "'") && v.length >= 2 && v.endsWith(q) ? v.slice(1, -1) : v;
}

/**
 * The Pli number format that `mso-number-format` stands for: `"General"` for none, `"@"` for text, or an Excel format
 * code. `undefined` when the value says nothing usable. Locale tags (`[$-409]`, `[$-F800]`, `[ENG]`) are taken off, as
 * the format then reads in the reader's own locale, as Excel's system dates do.
 */
export function fromMsoNumberFormat(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const inner = unquote(value.replace(/!important/i, ""));
  if (inner === "") return undefined;
  const named = NAMED[inner.trim().toLowerCase()];
  if (named) return named;
  let code = cssUnescape(inner);
  code = code.replace(/\[\$-[0-9A-Fa-f]+\]/g, "").replace(/\[ENG\]/gi, "");
  code = code.trim() === "" ? "" : code;
  if (code === "" || /[\u0000-\u001f]/.test(code)) return undefined;
  return code;
}

/**
 * `mso-number-format`'s value (with its quotes) for a Pli number format, or `undefined` for General. Every character that is
 * not a letter, digit, space, `_` or `?` is escaped, as Excel does.
 */
export function toMsoNumberFormat(format: string | undefined): string | undefined {
  if (format === undefined || format === "" || /^general$/i.test(format) || /[\u0000-\u001f]/.test(format)) return undefined;
  let out = "";
  for (const c of format) {
    if (c === '"') out += "\\0022";
    else if (c === "\\") out += "\\\\";
    else if (/[A-Za-z0-9_ ?]/.test(c) || c.charCodeAt(0) > 126) out += c;
    else out += "\\" + c;
  }
  return `"${out}"`;
}
