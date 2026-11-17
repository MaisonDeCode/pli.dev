import { attr, child, childrenNamed, elements, textOf, type XmlElement } from "@pli.dev/core";
import { MAX_IMAGE_BYTES, readImage, sniffImage, toDataUri } from "./image";
import type { CellPicture } from "./model";
import { relsPathOf, resolve } from "./xlsx-chart";

/*
 * Pictures placed in cells, as Excel writes them ("Place in Cell"): the cell has a `vm` number that points, through
 * `xl/metadata.xml`, at a rich value in `xl/richData/rdrichvalue.xml`. Its structure (`rdrichvaluestructure.xml`) says
 * that it is a local image and which of its values is the number of the picture's relationship in `richValueRel.xml`,
 * and, if it has one, its description (`Text`). Only reading is done: what Pli writes is a picture over the cell.
 */

const first = (el: XmlElement | undefined, name: string): XmlElement | undefined => {
  if (!el) return undefined;
  for (const c of elements(el)) {
    if (c.name === name) return c;
    const deep = first(c, name);
    if (deep) return deep;
  }
  return undefined;
};

/** Looks up the picture behind a cell's `vm` number; null when the workbook has none or the number leads to something else. */
export function richPictures(xml: (path: string) => XmlElement | undefined, bytes: (path: string) => Uint8Array | undefined): ((vm: number) => CellPicture | null) | null {
  const meta = xml("xl/metadata.xml");
  const values = xml("xl/richData/rdrichvalue.xml");
  const structures = xml("xl/richData/rdrichvaluestructure.xml");
  const relList = xml("xl/richData/richValueRel.xml");
  if (!meta || !values || !structures || !relList) return null;
  const valueBks = childrenNamed(child(meta, "valueMetadata"), "bk");
  const futureBks = childrenNamed(
    childrenNamed(meta, "futureMetadata").find((f) => attr(f, "name") === "XLRICHVALUE"),
    "bk",
  );
  const rvs = childrenNamed(values, "rv");
  const shapes = childrenNamed(structures, "s");
  const relIds = childrenNamed(relList, "rel").map((r) => attr(r, "id", "r"));
  const relsPath = relsPathOf("xl/richData/richValueRel.xml");
  const rels = childrenNamed(xml(relsPath), "Relationship");
  return (vm) => {
    const rc = child(valueBks[vm - 1], "rc");
    const bk = futureBks[Number(attr(rc, "v"))];
    const index = Number(attr(first(bk, "rvb"), "i"));
    const rv = rvs[index];
    const shape = shapes[Number(attr(rv, "s"))];
    if (!rv || !shape || attr(shape, "t") !== "_localImage") return null;
    const keys = childrenNamed(shape, "k").map((k) => attr(k, "n"));
    const cells = childrenNamed(rv, "v").map((v) => textOf(v));
    const at = keys.indexOf("_rvRel:LocalImageIdentifier");
    const id = at < 0 ? undefined : relIds[Number(cells[at])];
    const target = id ? rels.find((r) => r.attrs["Id"] === id)?.attrs["Target"] : undefined;
    const data = target ? bytes(resolve("xl/richData/richValueRel.xml", target)) : undefined;
    const info = data && data.length <= MAX_IMAGE_BYTES ? sniffImage(data) : null;
    if (!data || !info) return null;
    const text = keys.indexOf("Text") >= 0 ? cells[keys.indexOf("Text")] : undefined;
    return { src: toDataUri(data, info.type), ...(text ? { alt: text.slice(0, 1000) } : {}) };
  };
}

// ---- writing ----

const NS_RD = "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

export interface RichPicture {
  /** Where the picture is: any key the caller likes (the cell's sheet and address). */
  key: string;
  picture: CellPicture;
}

export interface RichDataFiles {
  /** The part files to add to the package, by path. */
  files: Record<string, Uint8Array>;
  /** For each picture's `key`, the `vm` number its cell holds. */
  vm: Map<string, number>;
  /** Relationships of the workbook, to add. */
  workbookRels: (firstId: number) => string;
  /** Overrides for `[Content_Types].xml`. */
  overrides: string;
  media: { type: "png" | "jpeg" | "gif" }[];
}

const OVERRIDE = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;

/**
 * The parts Excel keeps pictures placed in cells in ("Place in Cell"): each cell says which rich value it holds with `vm`;
 * `xl/metadata.xml` leads from that to a rich value in `rdrichvalue.xml`, whose structure (`_localImage`) says its first value
 * is the number of the picture in `richValueRel.xml`, and, when the picture has a description, its last is the `Text`. The
 * cell itself is written as the error `#VALUE!`, as Excel writes it. `firstMedia` is the number the first picture's file gets.
 */
export function richDataFiles(pictures: readonly RichPicture[], firstMedia: number): RichDataFiles | null {
  if (!pictures.length) return null;
  const files: Record<string, Uint8Array> = {};
  const enc = (s: string) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`);
  const unique: { src: string; name: string; type: "png" | "jpeg" | "gif"; bytes: Uint8Array }[] = [];
  const vm = new Map<string, number>();
  let anyText = false;
  const values = pictures.map((p, i) => {
    let at = unique.findIndex((u) => u.src === p.picture.src);
    if (at < 0) {
      const { type, bytes } = readImage(p.picture.src);
      at = unique.length;
      unique.push({ src: p.picture.src, name: `image${firstMedia + at}.${type}`, type, bytes });
    }
    vm.set(p.key, i + 1);
    const text = p.picture.alt;
    if (text) anyText = true;
    return `<rv s="${text ? 1 : 0}"><v>${at}</v><v>5</v>${text ? `<v>${esc(text)}</v>` : ""}</rv>`;
  });
  for (const u of unique) files[`xl/media/${u.name}`] = u.bytes;
  const structures = [
    `<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s>`,
    ...(anyText ? [`<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/><k n="Text" t="s"/></s>`] : []),
  ];
  files["xl/richData/rdrichvalue.xml"] = enc(`<rvData xmlns="${NS_RD}" count="${pictures.length}">${values.join("")}</rvData>`);
  files["xl/richData/rdrichvaluestructure.xml"] = enc(`<rvStructures xmlns="${NS_RD}" count="${structures.length}">${structures.join("")}</rvStructures>`);
  const flags = ["_Self", "_DisplayString", "_Flags", "_Format", "_SubLabel", "_Attribution", "_Icon", "_Display", "_CanonicalPropertyNames", "_ClassificationId"];
  files["xl/richData/rdRichValueTypes.xml"] = enc(
    `<rvTypesInfo xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata2" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x" xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><global><keyFlags>` +
      flags.map((k) => `<key name="${k}">${k === "_Self" ? '<flag name="ExcludeFromFile" value="1"/>' : ""}<flag name="ExcludeFromCalcComparison" value="1"/></key>`).join("") +
      `</keyFlags></global></rvTypesInfo>`,
  );
  files["xl/richData/richValueRel.xml"] = enc(
    `<richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="${NS_R}">${unique.map((_, i) => `<rel r:id="rId${i + 1}"/>`).join("")}</richValueRels>`,
  );
  files["xl/richData/_rels/richValueRel.xml.rels"] = enc(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${unique.map((u, i) => `<Relationship Id="rId${i + 1}" Type="${NS_R}/image" Target="../media/${u.name}"/>`).join("")}</Relationships>`,
  );
  files["xl/metadata.xml"] = enc(
    `<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:xlrd="${NS_RD}"><metadataTypes count="1"><metadataType name="XLRICHVALUE" minSupportedVersion="120000" copy="1" pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" clearComments="1" assign="1" coerce="1"/></metadataTypes>` +
      `<futureMetadata name="XLRICHVALUE" count="${pictures.length}">${pictures.map((_, i) => `<bk><extLst><ext uri="{3e2802c4-a4d2-4d8b-9148-e3be6c30e623}"><xlrd:rvb i="${i}"/></ext></extLst></bk>`).join("")}</futureMetadata>` +
      `<valueMetadata count="${pictures.length}">${pictures.map((_, i) => `<bk><rc t="1" v="${i}"/></bk>`).join("")}</valueMetadata></metadata>`,
  );
  return {
    files,
    vm,
    media: unique.map((u) => ({ type: u.type })),
    workbookRels: (firstId) =>
      `<Relationship Id="rId${firstId}" Type="${NS_R}/sheetMetadata" Target="metadata.xml"/>` +
      `<Relationship Id="rId${firstId + 1}" Type="http://schemas.microsoft.com/office/2022/10/relationships/richValueRel" Target="richData/richValueRel.xml"/>` +
      `<Relationship Id="rId${firstId + 2}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValue" Target="richData/rdrichvalue.xml"/>` +
      `<Relationship Id="rId${firstId + 3}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueStructure" Target="richData/rdrichvaluestructure.xml"/>` +
      `<Relationship Id="rId${firstId + 4}" Type="http://schemas.microsoft.com/office/2017/06/relationships/rdRichValueTypes" Target="richData/rdRichValueTypes.xml"/>`,
    overrides:
      OVERRIDE("/xl/metadata.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheetMetadata+xml") +
      OVERRIDE("/xl/richData/rdrichvalue.xml", "application/vnd.ms-excel.rdrichvalue+xml") +
      OVERRIDE("/xl/richData/rdrichvaluestructure.xml", "application/vnd.ms-excel.rdrichvaluestructure+xml") +
      OVERRIDE("/xl/richData/rdRichValueTypes.xml", "application/vnd.ms-excel.rdrichvaluetypes+xml") +
      OVERRIDE("/xl/richData/richValueRel.xml", "application/vnd.ms-excel.richvaluerel+xml"),
  };
}
