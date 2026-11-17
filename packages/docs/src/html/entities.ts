/** The named character references that appear in real clipboard HTML. Unknown names are left as text. */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", sbquo: "‚", bdquo: "„",
  laquo: "«", raquo: "»", bull: "•", middot: "·", deg: "°", plusmn: "±",
  times: "×", divide: "÷", frac12: "½", frac14: "¼", frac34: "¾",
  euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", para: "¶",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔",
  le: "≤", ge: "≥", ne: "≠", asymp: "≈", infin: "∞", check: "✓",
  eacute: "é", egrave: "è", agrave: "à", aacute: "á", uuml: "ü", ouml: "ö", auml: "ä",
  ntilde: "ñ", ccedil: "ç", szlig: "ß", iexcl: "¡", iquest: "¿",
};

/** Decodes `&amp;`, `&#38;` and `&#x26;` style references. Anything it doesn't recognize is kept as written. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:#(\d{1,10})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,8}));?/g, (whole, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
      // Reject surrogates, controls (other than tab and newline) and out-of-range values.
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0) return "�";
      return String.fromCodePoint(code);
    }
    // Named references need their semicolon, except for the few that browsers accept without one.
    const known = NAMED[name as string];
    if (known === undefined) return whole;
    return whole.endsWith(";") || ["amp", "lt", "gt", "quot", "nbsp", "copy", "reg"].includes(name) ? known : whole;
  });
}
