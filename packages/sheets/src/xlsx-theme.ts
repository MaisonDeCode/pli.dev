import type { Workbook } from "./model";
import { OFFICE_HYPERLINKS, OFFICE_THEME } from "./xlsx-format";
import { isThemeColor, officeThemeColors } from "./sparkline";

/*
 * A workbook's theme colours in an .xlsx file: the colour scheme of `xl/theme/theme1.xml`. Pli reads it (a colour that comes from
 * the theme is turned into its `#rrggbb` where cells use it) and keeps the palette in `Workbook.themeColors` only when it isn't
 * Office's own. The part is written only when a sparkline is coloured from the theme or the workbook has a palette of its own,
 * so that a theme colour means the same colour in Excel as it does here.
 */

export const THEME_PART = "xl/theme/theme1.xml";
export const THEME_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.theme+xml";
export const THEME_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";

/** The palette as Pli keeps it when it isn't Office's own (`#rrggbb`: ten colours, twelve when the hyperlink colours aren't Office's either); nothing when it is. */
export function ownPalette(theme: readonly string[]): string[] | undefined {
  const same = OFFICE_THEME.every((c, i) => theme[i]?.toUpperCase() === c);
  const links = OFFICE_HYPERLINKS.every((c, i) => (theme[10 + i] ?? c).toUpperCase() === c);
  if (same && links) return undefined;
  return theme.slice(0, links ? 10 : 12).map((c) => `#${c.toLowerCase()}`);
}

/** Whether the workbook needs a theme part: it has a palette, or a sparkline uses a colour from it. */
export function needsTheme(wb: Workbook): boolean {
  if (wb.themeColors) return true;
  return wb.sheets.some((s) => s.sparklines?.some((g) => [g.color, g.negativeColor, g.markerColor, g.firstColor, g.lastColor, g.highColor, g.lowColor, g.axisColor].some(isThemeColor)));
}

const NAMES = ["lt1", "dk1", "lt2", "dk2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];

/** `xl/theme/theme1.xml`: the colour scheme with the fonts and effects Office's theme has (a theme must have all three schemes). */
export function themeXml(wb: Workbook): string {
  const colors = wb.themeColors ?? officeThemeColors();
  // The file lists the colours in the schema's order, dark 1 before light 1 and dark 2 before light 2 (Excel repairs a file whose theme says otherwise once a cell uses a theme colour); the model's own order is light 1, dark 1, light 2, dark 2.
  const FILE_ORDER = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9];
  const scheme = FILE_ORDER.map((i) => {
    const name = NAMES[i]!;
    const hex = colors[i]!.slice(1).toUpperCase();
    // The two text and two background colours are system colours in Office's own theme; a plain RGB value keeps them as they are.
    return `<a:${name}><a:srgbClr val="${hex}"/></a:${name}>`;
  }).join("");
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (w: number) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr">${fill}<a:prstDash val="solid"/></a:ln>`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Pli"><a:themeElements>` +
    `<a:clrScheme name="Pli">${scheme}<a:hlink><a:srgbClr val="${(colors[10] ?? `#${OFFICE_HYPERLINKS[0]}`).slice(1).toUpperCase()}"/></a:hlink><a:folHlink><a:srgbClr val="${(colors[11] ?? `#${OFFICE_HYPERLINKS[1]}`).slice(1).toUpperCase()}"/></a:folHlink></a:clrScheme>` +
    `<a:fontScheme name="Pli"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
    `<a:fmtScheme name="Pli"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst>` +
    `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
    `<a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
  );
}
