import type { Align, Block, Doc, DocStyle, FormattableBlock, Marks, ParagraphFormat, StyleMarks } from "./model";
import { isFormattable } from "./model";

/** The marks a style can set. */
export const STYLE_MARK_KEYS = ["bold", "italic", "underline", "strike", "superscript", "subscript", "color", "highlight", "fontFamily", "fontSize"] as const satisfies readonly (keyof Marks)[];

/** What a style comes to once the styles it is based on are taken in. */
export interface ResolvedStyle {
  marks: StyleMarks;
  align?: Align;
  format?: ParagraphFormat;
}

/** The longest chain of `basedOn` that is followed. Documents are checked for loops when saved; this guards the ones that arrive over a sync. */
const MAX_DEPTH = 16;

/**
 * The look of a style: its own settings over those of the style it is based on, and so on down. Null if the
 * document has no such style (a block that points at a deleted one just looks plain). A style based on one of
 * the other kind, or in a loop, ignores that part.
 */
export function resolveStyle(doc: Pick<Doc, "styles">, id: string | undefined): ResolvedStyle | null {
  if (id === undefined) return null;
  const styles = doc.styles;
  const first = styles?.[id];
  if (!styles || !first) return null;
  const chain: DocStyle[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined = id; at !== undefined && chain.length < MAX_DEPTH; ) {
    const style: DocStyle | undefined = styles[at];
    if (!style || seen.has(at) || style.kind !== first.kind) break;
    seen.add(at);
    chain.push(style);
    at = style.basedOn;
  }
  const out: ResolvedStyle = { marks: {} };
  // The base first, so each style after it overrides.
  for (const style of chain.reverse()) {
    out.marks = { ...out.marks, ...style.marks };
    if (style.align) out.align = style.align;
    if (style.format) out.format = { ...out.format, ...style.format };
  }
  return out;
}

/** The style a block is set to, if the block can have one. */
export function styleOfBlock(block: Block): string | undefined {
  return isFormattable(block) ? block.style : undefined;
}

/**
 * The marks text really has: what its paragraph's style gives, then its character style, then what is set on the
 * text itself. `false` on the text itself turns a style's bold off, as it should.
 */
export function effectiveMarks(doc: Pick<Doc, "styles">, marks: Marks | undefined, paragraphStyle?: string): Marks {
  if (!doc.styles) return marks ?? {};
  const paragraph = resolveStyle(doc, paragraphStyle);
  const character = resolveStyle(doc, marks?.style);
  if (!paragraph && !character) return marks ?? {};
  return { ...paragraph?.marks, ...character?.marks, ...marks };
}

/** A paragraph-like block with its style's alignment and spacing filled in where the block sets none of its own. */
export function withParagraphStyle<B extends Block>(doc: Pick<Doc, "styles">, block: B): B {
  if (!doc.styles || !isFormattable(block) || !block.style) return block;
  const style = resolveStyle(doc, block.style);
  if (!style || (!style.align && !style.format)) return block;
  const formatted = block as FormattableBlock;
  const format = style.format || formatted.format ? { ...style.format, ...formatted.format } : undefined;
  const align = formatted.align ?? style.align;
  return { ...block, ...(align && { align }), ...(format && { format }) };
}

/** The styles of one kind, in alphabetical order by name, for a list. */
export function styleList(doc: Pick<Doc, "styles">, kind: DocStyle["kind"]): { id: string; style: DocStyle }[] {
  return Object.entries(doc.styles ?? {})
    .filter(([, style]) => style.kind === kind)
    .map(([id, style]) => ({ id, style }))
    .sort((a, b) => a.style.name.localeCompare(b.style.name));
}

/** An id for a new style named `name` that no style of the document has: the name, simplified, and a number if it is taken. */
export function newStyleId(doc: Pick<Doc, "styles">, name: string): string {
  const base = name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "style";
  let id = base;
  for (let n = 2; doc.styles?.[id]; n++) id = `${base}-${n}`;
  return id;
}

/** Every style id the blocks use, for carrying them to another document. */
export function stylesUsed(blocks: readonly Block[]): Set<string> {
  const used = new Set<string>();
  const visit = (list: readonly Block[]) => {
    for (const block of list) {
      if (block.type === "table") block.rows.forEach((row) => row.cells.forEach((cell) => visit(cell.blocks)));
      if ("runs" in block) {
        if ("style" in block && block.style) used.add(block.style);
        for (const run of block.runs) if (run.marks?.style) used.add(run.marks.style);
      }
    }
  };
  visit(blocks);
  return used;
}
