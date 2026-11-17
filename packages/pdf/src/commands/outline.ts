import { createId, PliError } from "@pli.dev/core";
import type { OutlineItem } from "../model";
import { eachOutlineItem, findOutlineItem, insertOutlineItem, mapOutlineItem } from "../pages/outline";
import type { PdfSession } from "../session";

export interface OutlineItemOptions {
  /** How far down the page (page space). The top of the page by default. */
  y?: number;
  /** The item to put it under (null or left out: the top level). */
  parent?: string | null;
  /** Its position among its siblings (the end by default). */
  index?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
}

/** What `update` can change on an item. `null` takes a field off. */
export type OutlinePatch = { [K in "title" | "dest" | "uri" | "open" | "bold" | "italic" | "color"]?: OutlineItem[K] | null };

/** Commands on the outline (bookmarks): `session.outline`. Each one is one undo step. */
export class OutlineCommands {
  constructor(protected readonly session: PdfSession) {}

  get items(): readonly OutlineItem[] {
    return this.session.doc.outline;
  }

  /** The item with this id (throws when there is none). */
  get(id: string): OutlineItem {
    const site = findOutlineItem(this.items, id);
    if (!site) throw new PliError("not_found", `bookmark ${id} not found`);
    return site.item;
  }

  /** Replaces the whole outline. */
  set(items: OutlineItem[]): void {
    this.session.transact([{ type: "set_outline", items }]);
  }

  private replace(items: OutlineItem[]): void {
    this.session.transact([{ type: "set_outline", items }]);
  }

  /** Adds a bookmark that goes to a page (`null`: nowhere, a plain heading). Returns its id. */
  add(title: string, pageId: string | null, options: OutlineItemOptions = {}): string {
    if (pageId !== null && !this.session.doc.pages.some((p) => p.id === pageId)) throw new PliError("not_found", `page ${pageId} not found`);
    const parent = options.parent ?? null;
    if (parent !== null) this.get(parent);
    const item: OutlineItem = { id: createId("o_"), title, children: [] };
    if (pageId !== null) item.dest = options.y === undefined ? { page: pageId } : { page: pageId, y: options.y };
    if (options.bold) item.bold = true;
    if (options.italic) item.italic = true;
    if (options.color) item.color = options.color;
    this.replace(insertOutlineItem(this.items, parent, options.index, item));
    return item.id;
  }

  /** Changes a bookmark's title, destination, style or whether it is open. */
  update(id: string, patch: OutlinePatch): void {
    this.get(id);
    this.replace(
      mapOutlineItem(this.items, id, (item) => {
        const next: Record<string, unknown> = { ...item };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) continue;
          if (v === null) delete next[k];
          else next[k] = v;
        }
        return next as unknown as OutlineItem;
      }),
    );
  }

  rename(id: string, title: string): void {
    this.update(id, { title });
  }

  /** Makes a bookmark go to a page (and how far down it). */
  retarget(id: string, pageId: string, y?: number): void {
    if (!this.session.doc.pages.some((p) => p.id === pageId)) throw new PliError("not_found", `page ${pageId} not found`);
    this.update(id, { dest: y === undefined ? { page: pageId } : { page: pageId, y }, uri: null });
  }

  /** Takes a bookmark out, with the bookmarks under it (`promote`: those move up into its place). */
  remove(id: string, options: { promote?: boolean } = {}): void {
    this.get(id);
    this.replace(mapOutlineItem(this.items, id, (item) => (options.promote ? item.children : null)));
  }

  /** Moves a bookmark (with what is under it) under `parent` (null: the top level) at `index` among that parent's other children. */
  move(id: string, parent: string | null, index?: number): void {
    const site = findOutlineItem(this.items, id);
    if (!site) throw new PliError("not_found", `bookmark ${id} not found`);
    if (parent !== null) {
      this.get(parent);
      let inside = false;
      eachOutlineItem([site.item], (i) => {
        if (i.id === parent) inside = true;
      });
      if (inside) throw new PliError("invalid_operation", "a bookmark cannot be moved into itself");
    }
    const without = mapOutlineItem(this.items, id, () => null);
    this.replace(insertOutlineItem(without, parent, index, site.item));
  }

  /** Makes a bookmark a child of the one above it. */
  indent(id: string): void {
    const site = findOutlineItem(this.items, id);
    if (!site) throw new PliError("not_found", `bookmark ${id} not found`);
    const above = site.siblings[site.index - 1];
    if (!above) return;
    this.move(id, above.id);
  }

  /** Makes a bookmark a sibling of its parent, right after it. */
  outdent(id: string): void {
    const site = findOutlineItem(this.items, id);
    if (!site) throw new PliError("not_found", `bookmark ${id} not found`);
    if (!site.parent) return;
    const up = findOutlineItem(this.items, site.parent.id)!;
    this.move(id, up.parent?.id ?? null, up.index + 1);
  }
}
