import { attr, child, childrenNamed, elements, type XmlElement } from "@pli.dev/core";
import type { ConditionalStyle, SlicerStyleDef } from "./model";
import { SLICER_STYLE_PARTS, cleanSlicerStyle, cleanSlicerStyleName, type SlicerStylePart } from "./slicerstyle";

/*
 * Slicer styles of your own in an .xlsx file ([MS-XLSX] 2.3.2.4). A slicer style is a table style (`pivot="0" table="0"`) that
 * gives the look of the whole slicer and its heading (`wholeTable`, `headerRow`), and a `slicerStyle` of the same name in the
 * stylesheet's extension list that gives the looks of the buttons (`slicerStyleElement`s). Looks are entries of the `dxfs`.
 */

const X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main";
/** The extension of the stylesheet that holds `slicerStyles`. */
export const SLICER_STYLES_URI = "{EB79DEF2-80B8-43e5-95BD-54CBDDF9020C}";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

const TABLE_PARTS: SlicerStylePart[] = ["wholeTable", "headerRow"];

/** What a stylesheet needs for slicer styles: their table styles, and the `ext` (or "" when there are none). `dxf` gives the position of a look in the stylesheet. */
export function slicerStylesXml(defs: Record<string, SlicerStyleDef> | undefined, dxf: (look: ConditionalStyle) => number): { tableStyles: string[]; ext: string } {
  const entries = Object.entries(defs ?? {});
  if (!entries.length) return { tableStyles: [], ext: "" };
  const tableStyles = entries.map(([name, def]) => {
    const parts = TABLE_PARTS.filter((p) => def[p]);
    return `<tableStyle name="${esc(name)}" pivot="0" table="0" count="${parts.length}">${parts.map((p) => `<tableStyleElement type="${p}" dxfId="${dxf(def[p]!)}"/>`).join("")}</tableStyle>`;
  });
  const styles = entries
    .map(([name, def]) => {
      const parts = SLICER_STYLE_PARTS.filter((p) => !TABLE_PARTS.includes(p) && def[p]);
      return `<x14:slicerStyle name="${esc(name)}">${parts.length ? `<x14:slicerStyleElements>${parts.map((p) => `<x14:slicerStyleElement type="${p}" dxfId="${dxf(def[p]!)}"/>`).join("")}</x14:slicerStyleElements>` : ""}</x14:slicerStyle>`;
    })
    .join("");
  return { tableStyles, ext: `<extLst><ext uri="${SLICER_STYLES_URI}" xmlns:x14="${X14}"><x14:slicerStyles defaultSlicerStyle="SlicerStyleLight1">${styles}</x14:slicerStyles></ext></extLst>` };
}

/** The slicer styles of your own in a stylesheet; `dxfs` is its table of looks. */
export function readSlicerStyles(root: XmlElement | undefined, dxfs: readonly ConditionalStyle[]): Record<string, SlicerStyleDef> {
  const out: Record<string, SlicerStyleDef> = {};
  const tables = new Map<string, XmlElement>();
  for (const el of childrenNamed(child(root, "tableStyles"), "tableStyle")) tables.set(attr(el, "name") ?? "", el);
  for (const ext of childrenNamed(child(root, "extLst"), "ext")) {
    for (const group of elements(ext)) {
      if (group.name.replace(/^.*:/, "") !== "slicerStyles") continue;
      for (const style of elements(group)) {
        if (style.name.replace(/^.*:/, "") !== "slicerStyle") continue;
        const name = attr(style, "name");
        if (!name) continue;
        const def: SlicerStyleDef = {};
        const take = (part: string, id: string | undefined) => {
          const look = id === undefined ? undefined : dxfs[Number(id)];
          if (look && (SLICER_STYLE_PARTS as readonly string[]).includes(part)) def[part as SlicerStylePart] = look;
        };
        for (const el of childrenNamed(tables.get(name), "tableStyleElement")) take(attr(el, "type") ?? "", attr(el, "dxfId"));
        for (const holder of elements(style)) for (const el of elements(holder)) take(attr(el, "type") ?? "", attr(el, "dxfId"));
        try {
          out[cleanSlicerStyleName(name)] = cleanSlicerStyle(def);
        } catch {
          // a style that is Excel's own, or can't be read, is left out
        }
      }
    }
  }
  return out;
}
