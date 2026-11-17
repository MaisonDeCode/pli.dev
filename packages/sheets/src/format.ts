import { isError, numberText, serialDate, serialTime, type Value } from "./values";

/** How a value reads with a number format applied. `color` is the format's own colour, such as `Red`, if it sets one. */
export interface Formatted {
  text: string;
  color?: string;
  /** Where a `*` in the format repeats a character to fill the cell: `at` is its place in `text`, which holds one copy of it (as Excel's `TEXT` gives). */
  fill?: { at: number; char: string };
}

type Tok =
  | { k: "lit"; text: string; bare?: true }
  | { k: "fill"; ch: string }
  | { k: "ph"; ch: "0" | "#" | "?" }
  | { k: "dot" }
  | { k: "comma" }
  | { k: "pct" }
  | { k: "exp"; sign: "+" | "-" }
  | { k: "date"; text: string }
  | { k: "elapsed"; unit: "h" | "m" | "s"; width: number }
  | { k: "ampm"; short: boolean }
  | { k: "at" }
  | { k: "general" };

interface Section {
  tokens: Tok[];
  color?: string;
  condition?: { op: string; value: number };
  date: boolean;
}

const COLORS = ["black", "blue", "cyan", "green", "magenta", "red", "white", "yellow"];

function lexSection(src: string): Section {
  const tokens: Tok[] = [];
  let color: string | undefined;
  let condition: Section["condition"];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      const stop = end < 0 ? src.length : end;
      tokens.push({ k: "lit", text: src.slice(i + 1, stop) });
      i = stop + 1;
    } else if (c === "\\" || c === "_") {
      const next = src[i + 1] ?? "";
      tokens.push({ k: "lit", text: c === "_" ? " " : next });
      i += 2;
    } else if (c === "*") {
      tokens.push({ k: "fill", ch: src[i + 1] ?? " " });
      i += 2;
    } else if (c === "[") {
      const end = src.indexOf("]", i);
      const body = src.slice(i + 1, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + 1;
      const lower = body.toLowerCase();
      let m: RegExpExecArray | null;
      if (COLORS.includes(lower) || /^color\s*\d+$/.test(lower)) color = body.replace(/^./, (x) => x.toUpperCase());
      else if ((m = /^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/.exec(body))) condition = { op: m[1]!, value: Number(m[2]) };
      else if ((m = /^(h+|m+|s+)$/i.exec(body))) tokens.push({ k: "elapsed", unit: m[1]![0]!.toLowerCase() as "h" | "m" | "s", width: m[1]!.length });
      else if ((m = /^\$([^-\]]*)/.exec(body))) tokens.push({ k: "lit", text: m[1]! });
    } else if (c === "0" || c === "#" || c === "?") {
      tokens.push({ k: "ph", ch: c });
      i++;
    } else if (c === ".") {
      tokens.push({ k: "dot" });
      i++;
    } else if (c === ",") {
      tokens.push({ k: "comma" });
      i++;
    } else if (c === "%") {
      tokens.push({ k: "pct" });
      i++;
    } else if ((c === "E" || c === "e") && (src[i + 1] === "+" || src[i + 1] === "-")) {
      tokens.push({ k: "exp", sign: src[i + 1] as "+" | "-" });
      i += 2;
    } else if (c === "@") {
      tokens.push({ k: "at" });
      i++;
    } else if (/^(am\/pm|a\/p)/i.test(src.slice(i))) {
      const short = /^a\/p/i.test(src.slice(i));
      tokens.push({ k: "ampm", short });
      i += short ? 3 : 5;
    } else if (/^general/i.test(src.slice(i))) {
      tokens.push({ k: "general" });
      i += 7;
    } else if (/[ymdhsYMDHS]/.test(c)) {
      let j = i;
      while (j < src.length && src[j]!.toLowerCase() === c.toLowerCase()) j++;
      tokens.push({ k: "date", text: src.slice(i, j).toLowerCase() });
      i = j;
    } else {
      tokens.push(c === "/" ? { k: "lit", text: c, bare: true } : { k: "lit", text: c });
      i++;
    }
  }
  const date = tokens.some((t) => t.k === "date" || t.k === "elapsed" || t.k === "ampm");
  return { tokens, ...(color ? { color } : {}), ...(condition ? { condition } : {}), date };
}

const parsed = new Map<string, Section[]>();

function sectionsOf(format: string): Section[] {
  let hit = parsed.get(format);
  if (!hit) {
    const parts: string[] = [];
    let cur = "";
    let quoted = false;
    let bracket = false;
    for (let i = 0; i < format.length; i++) {
      const c = format[i]!;
      if (c === "\\" ) {
        cur += c + (format[++i] ?? "");
        continue;
      }
      if (c === '"') quoted = !quoted;
      else if (!quoted && c === "[") bracket = true;
      else if (!quoted && c === "]") bracket = false;
      if (c === ";" && !quoted && !bracket) {
        parts.push(cur);
        cur = "";
      } else cur += c;
    }
    parts.push(cur);
    hit = parts.map(lexSection);
    if (parsed.size > 2000) parsed.clear();
    parsed.set(format, hit);
  }
  return hit;
}

// ---- decimal rounding on the 15 digits Excel keeps ----

/** The number's 15 significant digits laid out as integer and fraction digit strings, never in E notation. */
function decimalDigits(abs: number): { int: string; frac: string } {
  if (abs === 0) return { int: "0", frac: "" };
  const [mant, exp] = abs.toExponential(14).split("e");
  const digits = mant!.replace(".", "");
  const e = Number(exp);
  if (e >= 14) return { int: digits + "0".repeat(e - 14), frac: "" };
  if (e >= 0) return { int: digits.slice(0, e + 1), frac: digits.slice(e + 1) };
  return { int: "0", frac: "0".repeat(-e - 1) + digits };
}

/** `abs` to `places` decimals, half away from zero, as integer and fraction text. */
function rounded(abs: number, places: number): { int: string; frac: string } {
  const { int, frac } = decimalDigits(abs);
  if (frac.length <= places) return { int, frac: frac.padEnd(places, "0") };
  const keep = int + frac.slice(0, places);
  const up = frac.charCodeAt(places) >= 53; // "5"
  let digits = keep.split("");
  if (up) {
    let i = digits.length - 1;
    for (; i >= 0; i--) {
      if (digits[i] === "9") digits[i] = "0";
      else {
        digits[i] = String(Number(digits[i]) + 1);
        break;
      }
    }
    if (i < 0) digits = ["1", ...digits];
  }
  const all = digits.join("");
  const cut = all.length - places;
  return { int: all.slice(0, cut) || "0", frac: all.slice(cut) };
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+$)/g, ",");
}

// ---- numbers ----

/** Where a fraction sits among a section's tokens: a slash with digit placeholders before it, and placeholders or a fixed number after it. */
interface FractionAt {
  /** The first token of the numerator, and the slash. */
  num: number;
  slash: number;
  /** The tokens after the slash that make the denominator, and how many digit placeholders there are (0 for a fixed one). */
  den: number;
  places: number;
  /** A fixed denominator such as 8 or 16. */
  fixed?: number;
}

function fractionAt(tokens: Tok[]): FractionAt | null {
  const slash = tokens.findIndex((t) => t.k === "lit" && t.bare && t.text === "/");
  if (slash < 1 || tokens[slash - 1]!.k !== "ph") return null;
  let num = slash - 1;
  while (num > 0 && tokens[num - 1]!.k === "ph") num--;
  let end = slash + 1;
  if (tokens[end]?.k === "ph") {
    while (tokens[end]?.k === "ph") end++;
    return { num, slash, den: end - slash - 1, places: end - slash - 1 };
  }
  let digits = "";
  while (tokens[end]?.k === "lit" && /^\d$/.test((tokens[end] as { text: string }).text)) digits += (tokens[end++] as { text: string }).text;
  if (!digits || Number(digits) < 1) return null;
  return { num, slash, den: end - slash - 1, places: 0, fixed: Number(digits) };
}

/** The numerator and denominator closest to `x` with a denominator of at most `max`. A tie goes to the smaller denominator. */
function nearestFraction(x: number, max: number): [number, number] {
  let best: [number, number] = [Math.round(x), 1];
  let err = Math.abs(x - best[0]);
  for (let d = 2; d <= max && err > 1e-15; d++) {
    const n = Math.round(x * d);
    const e = Math.abs(x - n / d);
    if (e < err - 1e-15) {
      best = [n, d];
      err = e;
    }
  }
  return best;
}

function renderFraction(value: number, flat: Tok[], at: FractionAt, showSign: boolean): string {
  const pre = flat.slice(0, at.num);
  const numTokens = flat.slice(at.num, at.slash) as Extract<Tok, { k: "ph" }>[];
  const denEnd = at.slash + 1 + at.den;
  const denTokens = flat.slice(at.slash + 1, denEnd);
  const tail = flat.slice(denEnd);
  const x = Math.abs(value);
  const improper = !pre.some((t) => t.k === "ph");
  let whole = improper ? 0 : Math.floor(x + 1e-12);
  const rest = improper ? x : Math.max(0, x - whole);
  let [n, d] = at.fixed ? [Math.round(rest * at.fixed), at.fixed] : nearestFraction(rest, 10 ** at.places - 1);
  if (!improper && n === d) {
    whole++;
    n = 0;
  }
  const blank = !improper && n === 0;
  // The numerator is padded on the left, the denominator on the right, as the placeholders say.
  const padWith = (t: Tok | undefined) => (t?.k === "ph" && t.ch === "0" ? "0" : t?.k === "ph" && t.ch === "?" ? " " : "");
  const nText = String(n);
  const nPad = numTokens.slice(0, Math.max(0, numTokens.length - nText.length)).map(padWith).join("");
  const numerator = nPad + nText;
  let denominator: string;
  if (at.fixed) denominator = String(d);
  else {
    const dText = String(d);
    denominator = dText + denTokens.slice(dText.length).map(padWith).join("");
  }
  const fractionText = blank ? " ".repeat(numerator.length + 1 + denominator.length) : `${numerator}/${denominator}`;
  const front = pre.length ? renderNumber(whole, pre, false) : "";
  const end = tail.map((t) => (t.k === "lit" ? t.text : "")).join("");
  const sign = showSign && value < 0 && (n !== 0 || whole !== 0) ? "-" : "";
  return sign + front + fractionText + end;
}

function renderNumber(value: number, tokens: Tok[], showSign: boolean): string {
  // Percent signs scale by 100 and are written where they stand.
  const flat: Tok[] = tokens.map((t) => (t.k === "pct" ? ({ k: "lit", text: "%" } as Tok) : t));
  const percents = tokens.filter((t) => t.k === "pct").length;
  if (!flat.some((t) => t.k === "ph")) return flat.map((t) => (t.k === "lit" ? t.text : "")).join("");
  const fraction = fractionAt(flat);
  if (fraction) return renderFraction(value, flat, fraction, showSign);
  const expAt = flat.findIndex((t) => t.k === "exp");
  const mantissa = expAt < 0 ? flat : flat.slice(0, expAt);
  const expTok = expAt < 0 ? undefined : (flat[expAt] as Extract<Tok, { k: "exp" }>);
  const expDigits = expAt < 0 ? 0 : flat.slice(expAt + 1).filter((t) => t.k === "ph").length;
  const expTail = expAt < 0 ? [] : flat.slice(expAt + 1).filter((t) => t.k === "lit");

  const dotAt = mantissa.findIndex((t) => t.k === "dot");
  const intPart = dotAt < 0 ? mantissa : mantissa.slice(0, dotAt);
  const fracPart = dotAt < 0 ? [] : mantissa.slice(dotAt + 1);

  // A comma between digit placeholders groups thousands; one after the last digit placeholder divides by 1000.
  let scale = 0;
  let grouping = false;
  const phAfter = (list: Tok[], i: number) => list.slice(i + 1).some((t) => t.k === "ph");
  const phBefore = (list: Tok[], i: number) => list.slice(0, i).some((t) => t.k === "ph");
  const clean = (list: Tok[]) =>
    list.flatMap((t, i): Tok[] => {
      if (t.k !== "comma") return [t];
      if (phBefore(list, i) && phAfter(list, i)) {
        grouping = true;
        return [];
      }
      if (phBefore(list, i)) {
        scale++;
        return [];
      }
      return [{ k: "lit", text: "," }];
    });
  const intTokens = clean(intPart);
  const fracTokens = clean(fracPart);

  let n = value * 100 ** percents;
  n /= 1000 ** scale;
  const abs = Math.abs(n);
  const places = fracTokens.filter((t) => t.k === "ph").length;
  const intPh = Math.max(1, intTokens.filter((t) => t.k === "ph").length);

  let exponent = 0;
  let r: { int: string; frac: string };
  if (expTok) {
    exponent = abs === 0 ? 0 : Math.floor(Math.log10(abs));
    exponent -= ((exponent % intPh) + intPh) % intPh;
    r = rounded(abs / 10 ** exponent, places);
    if (r.int.replace(/^0+/, "").length > intPh) {
      exponent += intPh;
      r = rounded(abs / 10 ** exponent, places);
    }
  } else r = rounded(abs, places);

  // The integer part, filled in from the right; extra digits go before the leftmost placeholder.
  const digits = r.int.replace(/^0+/, "");
  const out: string[] = [];
  let used = 0;
  const putDigit = (ch: string) => {
    if (grouping && used > 0 && used % 3 === 0) out.unshift(",");
    out.unshift(ch);
  };
  for (let i = intTokens.length - 1; i >= 0; i--) {
    const t = intTokens[i]!;
    if (t.k === "ph") {
      const d = used < digits.length ? digits[digits.length - 1 - used]! : "";
      if (d !== "") putDigit(d);
      else if (t.ch === "0") putDigit("0");
      else if (t.ch === "?") out.unshift(" ");
      else {
        used++;
        continue;
      }
      used++;
    } else if (t.k === "lit") out.unshift(t.text);
  }
  // Excess digits belong in front of the first placeholder, after any literal that opens the format.
  let lead = "";
  while (used < digits.length) {
    if (grouping && used % 3 === 0 && used > 0) lead = "," + lead;
    lead = digits[digits.length - 1 - used]! + lead;
    used++;
  }
  let intText = out.join("");
  if (lead) {
    const at = intTokens.findIndex((t) => t.k === "ph");
    const opening = intTokens.slice(0, at < 0 ? 0 : at).filter((t) => t.k === "lit").map((t) => (t as { text: string }).text).join("");
    intText = opening + lead + intText.slice(opening.length);
  }

  // The fraction, dropping the zeros a # leaves out and blanking the ones a ? does.
  const fracChars = fracTokens.filter((t) => t.k === "ph").map((_, k) => r.frac[k] ?? "0");
  const kinds = fracTokens.filter((t) => t.k === "ph") as Extract<Tok, { k: "ph" }>[];
  for (let k = fracChars.length - 1; k >= 0 && fracChars[k] === "0"; k--) {
    if (kinds[k]!.ch === "0") break;
    fracChars[k] = kinds[k]!.ch === "?" ? " " : "";
  }
  let fi = 0;
  let fracText = "";
  for (const t of fracTokens) {
    if (t.k === "ph") fracText += fracChars[fi++]!;
    else if (t.k === "lit") fracText += t.text;
  }

  let text = intText + (dotAt >= 0 ? "." + fracText : "");
  if (expTok) {
    const sign = exponent < 0 ? "-" : expTok.sign === "+" ? "+" : "";
    text += "E" + sign + String(Math.abs(exponent)).padStart(Math.max(1, expDigits), "0") + expTail.map((t) => (t as { text: string }).text).join("");
  }
  const zero = !/[1-9]/.test(r.int + r.frac);
  return (showSign && n < 0 && !zero ? "-" : "") + text;
}

// ---- dates ----

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function renderDate(serial: number, tokens: Tok[]): string | null {
  if (serial < 0 || serial >= 2_958_466) return null;
  const whole = Math.floor(serial);
  // Rounding to the second can carry into the next day.
  const secsTotal = Math.round((serial - whole) * 86400);
  const day = serialDate(secsTotal >= 86400 ? whole + 1 : whole);
  const time = serialTime(secsTotal >= 86400 ? 0 : serial);
  const hasAmPm = tokens.some((t) => t.k === "ampm");
  const out: string[] = [];
  tokens.forEach((t, i) => {
    switch (t.k) {
      case "lit":
        out.push(t.text);
        break;
      case "ampm":
        out.push(t.short ? (time.hour < 12 ? "A" : "P") : time.hour < 12 ? "AM" : "PM");
        break;
      case "elapsed": {
        const total = serial * 86400;
        const v = t.unit === "h" ? Math.floor(total / 3600) : t.unit === "m" ? Math.floor(total / 60) : Math.floor(total);
        out.push(String(v).padStart(t.width, "0"));
        break;
      }
      case "date": {
        const text = t.text;
        const c = text[0]!;
        if (c === "y") out.push(text.length <= 2 ? String(day.year % 100).padStart(2, "0") : String(day.year).padStart(4, "0"));
        else if (c === "d") {
          if (text.length === 1) out.push(String(day.day));
          else if (text.length === 2) out.push(String(day.day).padStart(2, "0"));
          else if (text.length === 3) out.push(DAY_NAMES[day.weekday]!.slice(0, 3));
          else out.push(DAY_NAMES[day.weekday]!);
        } else if (c === "h") {
          const h = hasAmPm ? time.hour % 12 || 12 : time.hour;
          out.push(text.length === 1 ? String(h) : String(h).padStart(2, "0"));
        } else if (c === "s") {
          out.push(text.length === 1 ? String(time.second) : String(time.second).padStart(2, "0"));
          const next = tokens[i + 1];
          const after = tokens[i + 2];
          if (next?.k === "dot" && after?.k === "ph" ) {
            const frac = Math.round(((serial - whole) * 86400 - Math.floor((serial - whole) * 86400)) * 1000);
            out.push("." + String(frac).padStart(3, "0").slice(0, tokens.slice(i + 2).filter((x) => x.k === "ph").length));
          }
        } else if (c === "m") {
          // Minutes when next to hours or seconds, months otherwise.
          const before = [...tokens.slice(0, i)].reverse().find((x) => x.k === "date" || x.k === "elapsed");
          const next = tokens.slice(i + 1).find((x) => x.k === "date" || x.k === "elapsed");
          const isMinute = (before && (before.k === "elapsed" ? before.unit === "h" : before.text[0] === "h")) || (next && (next.k === "elapsed" ? next.unit === "s" : next.text[0] === "s"));
          if (isMinute) out.push(text.length === 1 ? String(time.minute) : String(time.minute).padStart(2, "0"));
          else if (text.length === 1) out.push(String(day.month));
          else if (text.length === 2) out.push(String(day.month).padStart(2, "0"));
          else if (text.length === 3) out.push(MONTH_NAMES[day.month - 1]!.slice(0, 3));
          else if (text.length === 4) out.push(MONTH_NAMES[day.month - 1]!);
          else out.push(MONTH_NAMES[day.month - 1]![0]!);
        }
        break;
      }
      case "dot":
        if (!(tokens[i - 1]?.k === "date" && (tokens[i - 1] as { text: string }).text[0] === "s" && tokens[i + 1]?.k === "ph")) out.push(".");
        break;
      case "ph":
        if (!(tokens[i - 1]?.k === "ph" || tokens[i - 1]?.k === "dot")) out.push("");
        break;
      case "comma":
        out.push(",");
        break;
      default:
        break;
    }
  });
  return out.join("");
}

// ---- the entry point ----

/** The value as it shows in a cell with this number format. Without a format it is General. */
export function formatValue(value: Value, format?: string): Formatted {
  if (isError(value)) return { text: value.error };
  if (typeof value === "boolean") return { text: value ? "TRUE" : "FALSE" };
  if (value === null) return { text: "" };
  if (format === undefined || format === "" || /^general$/i.test(format)) {
    return { text: typeof value === "number" ? numberText(value) : value };
  }
  const sections = sectionsOf(format);
  if (typeof value === "string") {
    const textSection = sections.length >= 4 ? sections[3]! : sections.find((s) => s.tokens.some((t) => t.k === "at"));
    if (!textSection) return { text: value };
    const text = withFill(textSection.tokens).map((t) => (t.k === "at" ? value : t.k === "lit" ? t.text : "")).join("");
    return finish(text, textSection.color);
  }
  let index = 0;
  const conditional = sections.some((s) => s.condition);
  if (conditional) {
    const found = sections.findIndex((s, i) => (s.condition ? test(value, s.condition) : i === sections.length - 1 || false));
    index = found < 0 ? sections.length - 1 : found;
  } else if (sections.length >= 3 && value === 0) index = 2;
  else if (sections.length >= 2 && value < 0) index = 1;
  const picked = sections[Math.min(index, sections.length - 1)]!;
  const section: Section = { ...picked, tokens: withFill(picked.tokens) };
  const explicitNegative = index === 1 && !conditional;
  const color = section.color ? { color: section.color } : {};
  if (section.tokens.some((t) => t.k === "general")) {
    return finish(section.tokens.map((t) => (t.k === "general" ? numberText(value) : t.k === "lit" ? t.text : "")).join(""), section.color);
  }
  if (section.date) {
    const text = renderDate(value, section.tokens);
    return text === null ? { text: "#".repeat(10), ...color } : finish(text, section.color);
  }
  return finish(renderNumber(explicitNegative ? Math.abs(value) : value, section.tokens, !explicitNegative), section.color);
}

/** The place a `*` leaves in text while it is worked out: a marker and the character to repeat. */
const FILL = "\uE000";

/** The tokens with each `*` turned into a literal marker that comes through the rendering. */
function withFill(tokens: Tok[]): Tok[] {
  return tokens.some((t) => t.k === "fill") ? tokens.map((t) => (t.k === "fill" ? ({ k: "lit", text: FILL + t.ch } as Tok) : t)) : tokens;
}

/** The text with its fill marker (if any) replaced by one copy of the character, and where that is. */
function finish(text: string, color?: string): Formatted {
  const at = text.indexOf(FILL);
  const out: Formatted = { text };
  if (at >= 0) {
    const char = String.fromCodePoint(text.codePointAt(at + 1) ?? 32);
    out.text = text.slice(0, at) + char + text.slice(at + 1 + char.length);
    out.fill = { at, char };
  }
  if (color) out.color = color;
  return out;
}

function test(v: number, c: { op: string; value: number }): boolean {
  switch (c.op) {
    case "<":
      return v < c.value;
    case ">":
      return v > c.value;
    case "<=":
      return v <= c.value;
    case ">=":
      return v >= c.value;
    case "<>":
      return v !== c.value;
    default:
      return v === c.value;
  }
}

/** Whether a number format shows dates or times. */
export function isDateFormat(format: string): boolean {
  return sectionsOf(format).some((s) => s.date);
}
