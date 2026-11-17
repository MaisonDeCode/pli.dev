import type { Thread } from "@pli.dev/core";

/**
 * The editable layer of a PDF, as plain JSON.
 *
 * A PDF file is not edited object by object. `openPdf` reads a file into a `PdfDoc`: the pages (in order, each from
 * a source file or blank), the annotations on each page, the form fields and the outline. Every edit changes that
 * JSON through an invertible `PdfOp` (see `ops.ts`), so undo, redo and live editing work as they do in the other
 * editors. `save` writes the JSON back into the file: annotations become real PDF annotations with appearance
 * streams, so other readers show them.
 *
 * Conventions
 * - Lengths are points (1/72 in).
 * - Page coordinates are "page space": the origin is the top left corner of the page's visible box (CropBox, or
 *   MediaBox) before the page is rotated, x grows right and y grows DOWN. The writer converts to PDF's bottom-left
 *   space. A page's `rotate` only changes how it is shown.
 * - Colours are "#rrggbb".
 * - Ids are strings. Ids of things read from a file are derived from the file (`p:main:3`, `a:main:42`), so two
 *   clients that open the same bytes agree on them. New things get `createId()` ids.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in page space. */
export type Pt = readonly [number, number];

export type Rotation = 0 | 90 | 180 | 270;

// ---- Sources and pages ---------------------------------------------------------------------------------------

/**
 * A PDF file whose pages are used in this document. The bytes are not in the JSON (they would make every operation
 * huge): the session keeps them in a `SourceStore`, by `id`. The first source, `main`, is the file that was opened
 * and is what an incremental save appends to.
 */
export interface Source {
  id: string;
  name: string;
  /** Number of pages in the file. */
  pages: number;
  /** Size in bytes. */
  size: number;
  /** A fingerprint of the bytes, so that other clients can check they hold the same file. */
  hash: string;
  /** Where the bytes can be fetched by another client (a storage URL or key). Set by the app's file storage. */
  location?: string;
}

export interface Page {
  id: string;
  /** Where the page comes from: a page (0-based) of a source file, or null for a blank page of `size`. */
  from: { source: string; index: number } | null;
  /** The size in points before rotation. */
  width: number;
  height: number;
  /** Degrees clockwise the page is shown turned, in addition to what the source page says. Replaces it. */
  rotate: Rotation;
  /** The page label (`ii`, `A-3`) shown by readers. */
  label?: string;
  annots: Annotation[];
  /** Changes to what is drawn on the page itself (text, pictures, redaction), applied when saving. */
  edits?: PageEdit[];
}

// ---- Annotations -----------------------------------------------------------------------------------------------

export interface AnnotBase {
  id: string;
  /** The `PliUser.id` of who made it. Readers show the name saved in `/T`; see `authorName`. */
  author?: string;
  /** The name saved in the PDF's `/T` entry. */
  authorName?: string;
  /** Milliseconds since 1970. */
  created?: number;
  modified?: number;
  /** The text readers show for the annotation (a note's text, or a markup's comment). */
  contents?: string;
  /** 0 clear to 1 solid. */
  opacity?: number;
  /** Id of the comment thread (`@pli.dev/core` `Thread`) this annotation belongs to. */
  thread?: string;
  /** The object it was read from (`12 0`), if it came from the file. Lets the save replace it in place. */
  ref?: string;
  /** Not editable by the user (the annotation's Locked flag). */
  locked?: boolean;
  /** Hidden from print and screen. */
  hidden?: boolean;
  /**
   * Replies to this annotation as the file has them (`/IRT` text annotations), oldest first. They are what
   * `readThreads` makes comments of; once a thread is in `PdfDoc.comments`, the thread is what `save` writes.
   */
  replies?: AnnotReply[];
  /** The review state of the file's replies says the conversation is settled (`/State /Completed`). */
  resolved?: boolean;
}

/** A reply to an annotation, as read from the file: a `/Subtype /Text` annotation with `/IRT`. */
export interface AnnotReply {
  /** `c:<source>:<object number>`. */
  id: string;
  /** The `PliUser.id`, when the file says (Pli writes it), else absent. */
  author?: string;
  /** The name saved in `/T`. */
  authorName?: string;
  body: string;
  created?: number;
  /** The object it was read from (`14 0`). */
  ref?: string;
}

export type LineEnd = "none" | "arrow" | "open-arrow" | "closed-arrow" | "circle" | "square" | "diamond" | "butt" | "slash";

export interface StrokeStyle {
  color: string;
  width: number;
  /** Dash pattern, as in PDF: on, off, on, off... */
  dash?: number[];
}

export type MarkupAnnot = AnnotBase & {
  type: "highlight" | "underline" | "strikeout" | "squiggly";
  color: string;
  /** One rectangle per line of selected text. */
  rects: Rect[];
  /** The selected text, kept for the comment list and for search. */
  quote?: string;
};

export type InkAnnot = AnnotBase & {
  type: "ink";
  /** Each stroke is a list of points, in drawing order. */
  strokes: Pt[][];
  stroke: StrokeStyle;
};

export type ShapeAnnot = AnnotBase & {
  type: "square" | "circle";
  rect: Rect;
  stroke: StrokeStyle;
  fill?: string;
};

export type LineAnnot = AnnotBase & {
  type: "line";
  from: Pt;
  to: Pt;
  stroke: StrokeStyle;
  startEnd?: LineEnd;
  endEnd?: LineEnd;
};

export type PolyAnnot = AnnotBase & {
  type: "polygon" | "polyline";
  points: Pt[];
  stroke: StrokeStyle;
  fill?: string;
};

export interface TextStyle {
  /** A family known to `@pli.dev/core` fonts, or one of the standard PDF fonts (Helvetica, Times, Courier). */
  family: string;
  size: number;
  bold?: boolean;
  italic?: boolean;
  color: string;
  align?: "left" | "center" | "right";
}

export type FreeTextAnnot = AnnotBase & {
  type: "freetext";
  rect: Rect;
  text: string;
  style: TextStyle;
  fill?: string;
  stroke?: StrokeStyle;
};

/** A sticky note: an icon with a comment. The thread of replies lives in the comments (`thread`). */
export type NoteAnnot = AnnotBase & {
  type: "note";
  /** Top left corner of the icon (24 by 24 points). */
  x: number;
  y: number;
  icon?: "comment" | "note" | "help" | "insert" | "key" | "paragraph";
  color?: string;
  open?: boolean;
};

/** A picture. `src` is a data URI or a URL (PNG or JPEG). */
export interface PdfPicture {
  src: string;
  /** Pixel size, when known. */
  width?: number;
  height?: number;
}

export type StampAnnot = AnnotBase & {
  type: "stamp";
  rect: Rect;
  /** A standard stamp: `Approved`, `Draft`, `Confidential`, `Final`, `NotApproved`, `Void`... Drawn as text in a box. Or a picture. */
  stamp: { name: string; label?: string; color?: string } | { picture: PdfPicture };
};

/** A signature the user drew, typed or uploaded. Saved as a stamp-like annotation with the signature's appearance. */
export type SignatureAnnot = AnnotBase & {
  type: "signature";
  rect: Rect;
  mode: "draw" | "type" | "image";
  /** `draw`: strokes in a box of `rect`'s size, 0..w and 0..h. */
  strokes?: Pt[][];
  /** `type`: the name, set in a script font. */
  text?: string;
  font?: string;
  /** `image`: an uploaded picture. */
  picture?: PdfPicture;
  color?: string;
  /** The line width for strokes. */
  width?: number;
  /**
   * The name of the signature field this signs (a form field of type `signature`). The field then draws nothing of its own (no
   * caption, no wash): see `signatureOf` and `forms.sign`. Kept in the file with the signature.
   */
  field?: string;
};

export type ImageAnnot = AnnotBase & {
  type: "image";
  rect: Rect;
  picture: PdfPicture;
};

/** A link. Either to a web address or to a place in this document. */
export type LinkAnnot = AnnotBase & {
  type: "link";
  rect: Rect;
  uri?: string;
  dest?: { page: string; y?: number };
};

/**
 * A mark for redaction. It only shows a box until the redactions are applied (`session.content.applyRedactions()`),
 * which removes what is under it from the page for good.
 */
export type RedactAnnot = AnnotBase & {
  type: "redact";
  rects: Rect[];
  /** The colour of the box left behind. */
  fill?: string;
  /** Text written in the box. */
  overlay?: string;
};

export type Annotation =
  | MarkupAnnot
  | InkAnnot
  | ShapeAnnot
  | LineAnnot
  | PolyAnnot
  | FreeTextAnnot
  | NoteAnnot
  | StampAnnot
  | SignatureAnnot
  | ImageAnnot
  | LinkAnnot
  | RedactAnnot;

export type AnnotationType = Annotation["type"];

// ---- Forms -----------------------------------------------------------------------------------------------------

export type FieldType = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button";

export interface FieldFlags {
  readOnly?: boolean;
  required?: boolean;
  /** Text: several lines. */
  multiline?: boolean;
  password?: boolean;
  /** Text: spread over `maxLength` equal cells. */
  comb?: boolean;
  maxLength?: number;
  /** Dropdown: the person may type a value that isn't listed. */
  editable?: boolean;
  /** List: several choices. */
  multiSelect?: boolean;
  /** Radio: the buttons can all be off. */
  noToggleToOff?: boolean;
}

/** One place on a page where a field is drawn. A field can have several (a radio group has one per button). */
export interface Widget {
  id: string;
  page: string;
  rect: Rect;
  /** Checkbox and radio: the value this widget stands for when it is on (`Yes`, `Option1`). */
  on?: string;
  ref?: string;
}

export interface FieldAppearance {
  /** The font's name as the file has it (`Helvetica`, `Times-Roman`, `ArialMT`). Standard fonts need no file; others come from `SaveOptions.fonts`. */
  font?: string;
  /** Points; 0 (or left out) sizes the text to fit the field. */
  size?: number;
  /** The text colour. */
  color?: string;
  /** The background. Left out: transparent. */
  fill?: string;
  /** The border colour. Left out: no border. */
  border?: string;
  borderWidth?: number;
  align?: "left" | "center" | "right";
  /** Checkbox and radio: the mark drawn when on. */
  checkStyle?: "check" | "cross" | "circle" | "square" | "diamond" | "star";
}

export interface FormField {
  id: string;
  /** The full name, parts joined by dots: `person.name`. */
  name: string;
  type: FieldType;
  /** Text and dropdown: the text. Checkbox: true or false. Radio: the `on` value chosen, or null. List: the chosen values. */
  value: string | boolean | string[] | null;
  defaultValue?: string | boolean | string[] | null;
  /** Dropdown and list: the choices. `value` is what is stored, `label` what is shown. */
  options?: { value: string; label?: string }[];
  flags?: FieldFlags;
  tooltip?: string;
  appearance?: FieldAppearance;
  /** Button: the text on it. */
  caption?: string;
  /** Signature: the field holds a digital signature. Pli.PDF keeps it (an update of the file leaves it valid) but cannot make or check one. */
  signed?: boolean;
  widgets: Widget[];
  ref?: string;
}

// ---- Outline, comments, content edits ------------------------------------------------------------------------

export interface OutlineItem {
  id: string;
  title: string;
  /** Where it goes: a page (and how far down it, in page space). */
  dest?: { page: string; y?: number };
  uri?: string;
  open?: boolean;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  children: OutlineItem[];
}

/**
 * Where a comment thread is attached (`Thread<PdfAnchor>` from `@pli.dev/core`): a place on a page, and the annotation
 * it belongs to, if it has one (a sticky note, or a highlight with a comment). The same stores, servers and payloads
 * as every other editor.
 */
export interface PdfAnchor {
  page: string;
  annot?: string;
  /** The point (top left of a note, or the middle of the quoted text). */
  x: number;
  y: number;
  quote?: string;
}

/**
 * A change to what is drawn on the page itself, applied by the save. Staged and honest: see the Pli.PDF
 * documentation for what `text` and `image` can do. `redact` removes what is under the rectangles for good.
 */
export type PageEdit = { id: string } & (
  | {
      type: "text";
      /** The run (from `session.content.runs(page)`) this replaces. */
      run: string;
      /** The new text. Empty removes the run. */
      text: string;
      family?: string;
      size?: number;
      color?: string;
      bold?: boolean;
      italic?: boolean;
      /** What to do when the new text is wider than the old: `none` keeps the size (and the save says so), `shrink` narrows it by up to 30%. */
      fit?: "none" | "shrink";
      /** The text that was there, kept so the edit reads well in a list (the file is the truth at save). */
      oldText?: string;
    }
  | {
      type: "image";
      /** The picture (from `session.content.images(page)`) this replaces. */
      target: string;
      /** The new picture, or null to remove it. */
      picture: PdfPicture | null;
      /** `contain` (default): inside the old box, same proportions, centred. `stretch`: fills the box. */
      fit?: "contain" | "stretch";
    }
  | { type: "redact"; rects: Rect[]; fill?: string; overlay?: string }
);

// ---- The document ---------------------------------------------------------------------------------------------

export interface PdfMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
}

export interface PdfDoc {
  /** Names the document for comments and storage. */
  id: string;
  /**
   * Comment threads kept in the document (the default), so they travel with the file: `save` writes them as PDF
   * text annotations and replies (`/IRT`), and `openPdf` reads those back. Hosts with their own database pass a
   * `CommentStore` instead (`session.comments.enable({ store })`) and this stays empty.
   */
  comments?: Record<string, Thread<PdfAnchor>>;
  name?: string;
  meta: PdfMeta;
  sources: Source[];
  pages: Page[];
  outline: OutlineItem[];
  fields: FormField[];
}

export const MAIN_SOURCE = "main";
