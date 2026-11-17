/**
 * Glyph names and simple-font encodings, as far as text extraction needs them: a compact subset of the Adobe Glyph
 * List (ASCII, Latin-1, common punctuation, Latin Extended-A, Greek, a few symbols, `uniXXXX`), and the Standard,
 * WinAnsi and MacRoman encodings as code to Unicode tables. Names outside the subset give no character; the font's
 * `/ToUnicode` map (which wins anyway) is the way out for those.
 */

const NAMED = `space 20 exclam 21 quotedbl 22 numbersign 23 dollar 24 percent 25 ampersand 26 quotesingle 27 parenleft 28 parenright 29 asterisk 2A plus 2B comma 2C hyphen 2D period 2E slash 2F
zero 30 one 31 two 32 three 33 four 34 five 35 six 36 seven 37 eight 38 nine 39 colon 3A semicolon 3B less 3C equal 3D greater 3E question 3F at 40
bracketleft 5B backslash 5C bracketright 5D asciicircum 5E underscore 5F grave 60 braceleft 7B bar 7C braceright 7D asciitilde 7E
nbspace A0 nonbreakingspace A0 exclamdown A1 cent A2 sterling A3 currency A4 yen A5 brokenbar A6 section A7 dieresis A8 copyright A9 ordfeminine AA guillemotleft AB logicalnot AC sfthyphen AD softhyphen AD registered AE macron AF overscore AF degree B0 plusminus B1 twosuperior B2 threesuperior B3 acute B4 mu B5 mu1 3BC paragraph B6 periodcentered B7 middot B7 cedilla B8 onesuperior B9 ordmasculine BA guillemotright BB onequarter BC onehalf BD threequarters BE questiondown BF
Agrave C0 Aacute C1 Acircumflex C2 Atilde C3 Adieresis C4 Aring C5 AE C6 Ccedilla C7 Egrave C8 Eacute C9 Ecircumflex CA Edieresis CB Igrave CC Iacute CD Icircumflex CE Idieresis CF Eth D0 Ntilde D1 Ograve D2 Oacute D3 Ocircumflex D4 Otilde D5 Odieresis D6 multiply D7 Oslash D8 Ugrave D9 Uacute DA Ucircumflex DB Udieresis DC Yacute DD Thorn DE germandbls DF
agrave E0 aacute E1 acircumflex E2 atilde E3 adieresis E4 aring E5 ae E6 ccedilla E7 egrave E8 eacute E9 ecircumflex EA edieresis EB igrave EC iacute ED icircumflex EE idieresis EF eth F0 ntilde F1 ograve F2 oacute F3 ocircumflex F4 otilde F5 odieresis F6 divide F7 oslash F8 ugrave F9 uacute FA ucircumflex FB udieresis FC yacute FD thorn FE ydieresis FF
Euro 20AC quotesinglbase 201A florin 192 quotedblbase 201E ellipsis 2026 dagger 2020 daggerdbl 2021 circumflex 2C6 perthousand 2030 Scaron 160 guilsinglleft 2039 OE 152 Zcaron 17D quoteleft 2018 quoteright 2019 quotedblleft 201C quotedblright 201D bullet 2022 endash 2013 emdash 2014 tilde 2DC trademark 2122 scaron 161 guilsinglright 203A oe 153 zcaron 17E Ydieresis 178
ff FB00 fi FB01 fl FB02 ffi FB03 ffl FB04 dotlessi 131 Lslash 141 lslash 142 breve 2D8 dotaccent 2D9 ring 2DA hungarumlaut 2DD ogonek 2DB caron 2C7 fraction 2044 minus 2212 figuredash 2012 quotereversed 201B afii10017 410
Amacron 100 amacron 101 Abreve 102 abreve 103 Aogonek 104 aogonek 105 Cacute 106 cacute 107 Ccaron 10C ccaron 10D Dcaron 10E dcaron 10F Dcroat 110 dcroat 111 Emacron 112 emacron 113 Edotaccent 116 edotaccent 117 Eogonek 118 eogonek 119 Ecaron 11A ecaron 11B Gbreve 11E gbreve 11F Idotaccent 130 Lacute 139 lacute 13A Lcaron 13D lcaron 13E Nacute 143 nacute 144 Ncaron 147 ncaron 148 Ohungarumlaut 150 ohungarumlaut 151 Racute 154 racute 155 Rcaron 158 rcaron 159 Sacute 15A sacute 15B Scedilla 15E scedilla 15F Tcaron 164 tcaron 165 Uring 16E uring 16F Uhungarumlaut 170 uhungarumlaut 171 Zacute 179 zacute 17A Zdotaccent 17B zdotaccent 17C
Alpha 391 Beta 392 Gamma 393 Delta 394 Epsilon 395 Zeta 396 Eta 397 Theta 398 Iota 399 Kappa 39A Lambda 39B Mu 39C Nu 39D Xi 39E Omicron 39F Pi 3A0 Rho 3A1 Sigma 3A3 Tau 3A4 Upsilon 3A5 Phi 3A6 Chi 3A7 Psi 3A8 Omega 3A9
alpha 3B1 beta 3B2 gamma 3B3 delta 3B4 epsilon 3B5 zeta 3B6 eta 3B7 theta 3B8 iota 3B9 kappa 3BA lambda 3BB nu 3BD xi 3BE omicron 3BF pi 3C0 rho 3C1 sigma1 3C2 sigma 3C3 tau 3C4 upsilon 3C5 phi 3C6 chi 3C7 psi 3C8 omega 3C9
infinity 221E summation 2211 product 220F integral 222B radical 221A partialdiff 2202 notequal 2260 lessequal 2264 greaterequal 2265 approxequal 2248 equivalence 2261 arrowleft 2190 arrowup 2191 arrowright 2192 arrowdown 2193 arrowboth 2194 element 2208 emptyset 2205 lozenge 25CA apple F8FF openbullet 25E6 filledbox 25A0 square 25A1 checkmark 2713 asteriskmath 2217 similar 223C proportional 221D therefore 2234 universal 2200 existential 2203 gradient 2207 intersection 2229 union 222A logicaland 2227 logicalor 2228 circlemultiply 2297 circleplus 2295 angle 2220 dotmath 22C5 carriagereturn 21B5 arrowdblboth 21D4 arrowdblright 21D2 arrowdblleft 21D0 Euro1 20AC`;

let nameMap: Map<string, string> | undefined;

function names(): Map<string, string> {
  if (nameMap) return nameMap;
  const m = new Map<string, string>();
  for (let c = 0x41; c <= 0x5a; c++) m.set(String.fromCharCode(c), String.fromCharCode(c));
  for (let c = 0x61; c <= 0x7a; c++) m.set(String.fromCharCode(c), String.fromCharCode(c));
  const t = NAMED.split(/\s+/);
  for (let i = 0; i + 1 < t.length; i += 2) m.set(t[i]!, String.fromCodePoint(parseInt(t[i + 1]!, 16)));
  return (nameMap = m);
}

/** The character(s) a glyph name stands for: `eacute` is é, `uni20AC` is €, `f_i` is fi. Empty when the name isn't known. */
export function glyphNameToUnicode(name: string): string {
  const m = names();
  const hit = m.get(name);
  if (hit !== undefined) return hit;
  const dot = name.indexOf(".");
  if (dot > 0) return glyphNameToUnicode(name.slice(0, dot));
  if (name.includes("_")) return name.split("_").map(glyphNameToUnicode).join("");
  let match = /^uni((?:[0-9A-Fa-f]{4})+)$/.exec(name);
  if (match) {
    let s = "";
    for (let i = 0; i < match[1]!.length; i += 4) s += String.fromCharCode(parseInt(match[1]!.slice(i, i + 4), 16));
    return s;
  }
  match = /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (match) {
    const cp = parseInt(match[1]!, 16);
    if (cp <= 0x10ffff) return String.fromCodePoint(cp);
  }
  return "";
}

/** Windows-1252 for the codes 128 to 159 (0 where undefined). */
const CP1252_HIGH = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178];

function ascii(): string[] {
  const t: string[] = new Array(256).fill("");
  for (let c = 32; c < 127; c++) t[c] = String.fromCharCode(c);
  return t;
}

export type EncodingTable = readonly string[];

function winAnsi(): string[] {
  const t = ascii();
  for (let c = 128; c < 160; c++) t[c] = CP1252_HIGH[c - 128] ? String.fromCharCode(CP1252_HIGH[c - 128]!) : "•";
  for (let c = 160; c < 256; c++) t[c] = String.fromCharCode(c);
  t[127] = "•";
  t[173] = "-";
  return t;
}

const MAC_HIGH =
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü" +
  "†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø" +
  "¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ" +
  "‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

function macRoman(): string[] {
  const t = ascii();
  for (let i = 0; i < 128; i++) t[128 + i] = MAC_HIGH[i]!;
  return t;
}

function standard(): string[] {
  const t = ascii();
  t[0x27] = "’";
  t[0x60] = "‘";
  const hi: Record<number, string> = {
    0xa1: "¡", 0xa2: "¢", 0xa3: "£", 0xa4: "⁄", 0xa5: "¥", 0xa6: "ƒ", 0xa7: "§", 0xa8: "¤", 0xa9: "'", 0xaa: "“", 0xab: "«", 0xac: "‹", 0xad: "›", 0xae: "ﬁ", 0xaf: "ﬂ",
    0xb1: "–", 0xb2: "†", 0xb3: "‡", 0xb4: "·", 0xb6: "¶", 0xb7: "•", 0xb8: "‚", 0xb9: "„", 0xba: "”", 0xbb: "»", 0xbc: "…", 0xbd: "‰", 0xbf: "¿",
    0xc1: "`", 0xc2: "´", 0xc3: "ˆ", 0xc4: "˜", 0xc5: "¯", 0xc6: "˘", 0xc7: "˙", 0xc8: "¨", 0xca: "˚", 0xcb: "¸", 0xcd: "˝", 0xce: "˛", 0xcf: "ˇ", 0xd0: "—",
    0xe1: "Æ", 0xe3: "ª", 0xe8: "Ł", 0xe9: "Ø", 0xea: "Œ", 0xeb: "º", 0xf1: "æ", 0xf5: "ı", 0xf8: "ł", 0xf9: "ø", 0xfa: "œ", 0xfb: "ß",
  };
  for (const [k, v] of Object.entries(hi)) t[Number(k)] = v;
  return t;
}

let cache: Record<string, EncodingTable> | undefined;

/** `WinAnsiEncoding`, `MacRomanEncoding`, `StandardEncoding` as code to character tables (256 entries, "" where undefined). */
export function baseEncoding(name: string): EncodingTable | undefined {
  cache ??= { WinAnsiEncoding: winAnsi(), MacRomanEncoding: macRoman(), StandardEncoding: standard() };
  return cache[name];
}

/** The characters of Latin-1 as a table (what a font with no encoding information is read as). */
export function latin1Table(): string[] {
  const t = ascii();
  for (let c = 160; c < 256; c++) t[c] = String.fromCharCode(c);
  return t;
}
