import { strToU8, zipSync, type Zippable } from "fflate";
import { PliError } from "@pli.dev/core";

/**
 * A small writer for Open Packaging Conventions packages (the zip layout behind PPTX, DOCX and XLSX): parts, the
 * relationships between them, and `[Content_Types].xml`. It writes bytes that depend only on its input and the date
 * it is given, so the same deck always produces the same file.
 */

export const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// XML 1.0 forbids most control characters, even escaped.
const INVALID_XML = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]", "g");

/** Escapes text for an XML text node or a double-quoted attribute value. */
export function xmlEscape(value: string): string {
  return value.replace(INVALID_XML, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_BASE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** Relationship types used by a presentation. */
export const REL = {
  officeDocument: `${REL_BASE}/officeDocument`,
  coreProperties: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  extendedProperties: `${REL_BASE}/extended-properties`,
  slideMaster: `${REL_BASE}/slideMaster`,
  slideLayout: `${REL_BASE}/slideLayout`,
  slide: `${REL_BASE}/slide`,
  notesMaster: `${REL_BASE}/notesMaster`,
  notesSlide: `${REL_BASE}/notesSlide`,
  theme: `${REL_BASE}/theme`,
  presProps: `${REL_BASE}/presProps`,
  viewProps: `${REL_BASE}/viewProps`,
  tableStyles: `${REL_BASE}/tableStyles`,
  image: `${REL_BASE}/image`,
  hyperlink: `${REL_BASE}/hyperlink`,
  chart: `${REL_BASE}/chart`,
  package: `${REL_BASE}/package`,
  worksheet: `${REL_BASE}/worksheet`,
  styles: `${REL_BASE}/styles`,
} as const;

/** Content types of the parts of a presentation. */
export const CT = {
  rels: "application/vnd.openxmlformats-package.relationships+xml",
  xml: "application/xml",
  presentation: "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
  template: "application/vnd.openxmlformats-officedocument.presentationml.template.main+xml",
  slideMaster: "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml",
  slideLayout: "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml",
  slide: "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
  notesMaster: "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
  notesSlide: "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
  theme: "application/vnd.openxmlformats-officedocument.theme+xml",
  presProps: "application/vnd.openxmlformats-officedocument.presentationml.presProps+xml",
  viewProps: "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml",
  tableStyles: "application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml",
  core: "application/vnd.openxmlformats-package.core-properties+xml",
  app: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  workbook: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  worksheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  sheetStyles: "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
} as const;

/** Content types the zip can declare once per file extension instead of once per part. */
const EXTENSION_DEFAULTS: Record<string, string> = {
  rels: CT.rels,
  xml: CT.xml,
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  tiff: "image/tiff",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export interface Relationship {
  id: string;
  type: string;
  /** A part name (`ppt/slides/slide1.xml`) for an internal relationship, or a URI for an external one. */
  target: string;
  external?: boolean;
}

/** One file of the package, with the relationships it is the source of. */
export class Part {
  readonly rels: Relationship[] = [];

  constructor(
    /** The name without a leading slash: `ppt/slides/slide1.xml`. */
    readonly name: string,
    /** Overrides the content type the extension implies. */
    readonly contentType: string | undefined,
    public data: string | Uint8Array = "",
  ) {}

  /** Adds a relationship to `target` (reusing an existing one with the same type and target) and returns its id. */
  relate(type: string, target: string, external = false): string {
    const found = this.rels.find((r) => r.type === type && r.target === target && !!r.external === external);
    if (found) return found.id;
    const id = `rId${this.rels.length + 1}`;
    this.rels.push({ id, type, target, ...(external ? { external: true } : {}) });
    return id;
  }
}

/** `../media/image1.png` for the target `ppt/media/image1.png` as seen from the part `ppt/slides/slide1.xml`. */
export function relativeTarget(from: string, to: string): string {
  const a = from.split("/").slice(0, -1);
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array<string>(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

/** The name of the relationships part that belongs to a part (`""` is the package itself). */
export function relsNameOf(partName: string): string {
  const at = partName.lastIndexOf("/");
  return `${partName.slice(0, at + 1)}_rels/${partName.slice(at + 1)}.rels`;
}

export function relationshipsXml(source: string, rels: readonly Relationship[]): string {
  const items = rels.map((r) => {
    const target = r.external ? r.target : relativeTarget(source, r.target);
    return `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEscape(target)}"${r.external ? ' TargetMode="External"' : ""}/>`;
  });
  return `${XML_DECL}<Relationships xmlns="${REL_NS}">${items.join("")}</Relationships>`;
}

export interface WriteOptions {
  /** The modification time written into the zip entries. */
  date: Date;
}

export class OpcPackage {
  private readonly parts = new Map<string, Part>();
  /** The package's own relationships (`_rels/.rels`). */
  readonly rels: Relationship[] = [];

  add<T extends Part>(part: T): T {
    if (part.name.startsWith("/") || part.name === "" || part.name.includes("//")) throw new PliError("invalid_document", `Not a valid part name: ${part.name}`);
    const key = part.name.toLowerCase();
    for (const existing of this.parts.keys()) if (existing.toLowerCase() === key) throw new PliError("invalid_document", `Duplicate part name: ${part.name}`);
    this.parts.set(part.name, part);
    return part;
  }

  has(name: string): boolean {
    return this.parts.has(name);
  }

  relate(type: string, target: string): string {
    const id = `rId${this.rels.length + 1}`;
    this.rels.push({ id, type, target });
    return id;
  }

  contentTypesXml(): string {
    const defaults = new Map<string, string>([["rels", CT.rels], ["xml", CT.xml]]);
    const overrides: string[] = [];
    const extOf = (name: string) => {
      const dot = name.lastIndexOf(".");
      return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
    };
    for (const part of this.parts.values()) {
      const ext = extOf(part.name);
      const known = EXTENSION_DEFAULTS[ext];
      const type = part.contentType ?? known;
      if (!type) throw new PliError("invalid_document", `No content type for part ${part.name}`);
      if (known === type && ext !== "xml") defaults.set(ext, type);
      else overrides.push(`<Override PartName="/${xmlEscape(part.name)}" ContentType="${type}"/>`);
    }
    const defaultXml = [...defaults].map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`).join("");
    return `${XML_DECL}<Types xmlns="${CT_NS}">${defaultXml}${overrides.join("")}</Types>`;
  }

  /** Checks that every internal relationship points at a part of the package. */
  private check(): void {
    const sources: [string, readonly Relationship[]][] = [["", this.rels], ...[...this.parts.values()].map((p): [string, readonly Relationship[]] => [p.name, p.rels])];
    for (const [source, rels] of sources) {
      const ids = new Set<string>();
      for (const r of rels) {
        if (ids.has(r.id)) throw new PliError("invalid_document", `Duplicate relationship id ${r.id} in ${source || "package"}`);
        ids.add(r.id);
        if (!r.external && !this.parts.has(r.target)) throw new PliError("invalid_document", `Relationship ${r.id} of ${source || "package"} points at the missing part ${r.target}`);
      }
    }
  }

  /** The zip file. Entry order is fixed: content types, relationships, then the parts in the order they were added. */
  write(options: WriteOptions): Uint8Array {
    this.check();
    // The zip stores local time; use the UTC fields so the bytes don't depend on the machine's time zone.
    const d = options.date;
    const mtime = new Date(Math.max(1980, d.getUTCFullYear()), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds() - (d.getUTCSeconds() % 2));
    const files: Zippable = {};
    const put = (name: string, data: string | Uint8Array) => {
      files[name] = [typeof data === "string" ? strToU8(data) : data, { mtime }];
    };
    put("[Content_Types].xml", this.contentTypesXml());
    put("_rels/.rels", relationshipsXml("", this.rels));
    for (const part of this.parts.values()) {
      put(part.name, part.data);
      if (part.rels.length > 0) put(relsNameOf(part.name), relationshipsXml(part.name, part.rels));
    }
    return zipSync(files);
  }
}
