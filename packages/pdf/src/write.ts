/**
 * The writing half of the engine: serialising objects, the mutable `Overlay` with `incremental()` and `rewrite()`,
 * page tree helpers, a content stream builder, standard and embedded fonts, and pictures.
 */
export { ByteWriter, createPdf, formatNumber, randomId, serializeObject, writeIncremental, writeIndirect, writeRewrite } from "./cos/writer";
export type { IncrementalOptions, RewriteOptions, SerializeOptions } from "./cos/writer";
export { Overlay, cloneDirect } from "./cos/overlay";
export type { PdfFileLike, PageInfoLike } from "./cos/overlay";
export { INHERITED_PAGE_KEYS, ensureArray, inheritedPageAttr, pageRefs, setPages } from "./cos/pagetree";
export type { TreeReader } from "./cos/pagetree";
export { ContentBuilder, ResourceNames, hex, literal, parseHexColor } from "./cos/content";
export { addStandardFont, encodeWinAnsi, measure, standardFamilyFor, standardFontName, standardWidth, winAnsiCode } from "./fonts/standard";
export type { FontStyle, StandardFamily } from "./fonts/standard";
export { embedTrueType } from "./fonts/embed";
export type { EmbedOptions, EmbeddedFont } from "./fonts/embed";
export { decodePng, jpegInfo, makeImageXObject } from "./image";
export type { ImageSource, ImageXObject, JpegInfo, Raster } from "./image";
