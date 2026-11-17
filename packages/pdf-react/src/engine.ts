import { PliError } from "@pli.dev/core";
import type { Page, PdfSession, Source } from "@pli.dev/pdf";
import { abortError, type OpenOptions, type PdfRenderer, type RenderedDocument, type RenderedOutlineItem, type RenderedPage, type RenderOptions, type TextRun } from "./renderer";

/** A source whose bytes the session's `SourceStore` does not have (yet): a peer added the file and it has not arrived. */
export class SourceMissing extends PliError {
  constructor(readonly source: Source) {
    super("not_found", `the file ${source.name || source.id} is not available`);
  }
}

/** A page that is all white (a blank page of the document). */
export function blankPage(width: number, height: number): RenderedPage {
  return {
    width,
    height,
    rotate: 0,
    async render({ canvas, scale, rotation, signal }: RenderOptions) {
      if (signal?.aborted) throw abortError();
      const turned = rotation % 180 !== 0;
      canvas.width = Math.max(1, Math.ceil((turned ? height : width) * scale));
      canvas.height = Math.max(1, Math.ceil((turned ? width : height) * scale));
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    },
    async text() {
      return [];
    },
    destroy() {},
  };
}

/** A page held by the cache: someone is using it while `refs` is above zero. */
interface Entry {
  promise: Promise<RenderedPage>;
  refs: number;
  page?: RenderedPage;
  doc?: string;
}

export interface PageLease {
  /** The page, once the renderer has it (or why it could not). */
  readonly promise: Promise<RenderedPage>;
  /** Say you are done with the page, so the cache may free it. */
  release(): void;
}

export interface PageSourcesOptions {
  /** The password of an encrypted file, or a function that gives it. */
  password?: string | ((source: Source) => string | undefined);
  /** How many pages nobody is using are kept (default 24). */
  maxIdle?: number;
  /** The pause before asking again for a file that is missing, in ms; it doubles each time up to 30 s (default 1000). */
  retryMs?: number;
}

const sourceKey = (s: Source) => `${s.id}:${s.hash}`;

/**
 * Hands out rendered pages for the pages of a document. It opens each source file (the `main` file and any that were
 * merged in) with the renderer once, keeps the pages people are looking at, frees the others, and forgets a file when it
 * is no longer a source of the document or its bytes changed. A blank page is white.
 */
export class PageSources {
  readonly session: PdfSession;
  readonly renderer: PdfRenderer;
  private readonly options: PageSourcesOptions;
  private docs = new Map<string, Promise<RenderedDocument>>();
  private entries = new Map<string, Entry>();
  private idle: string[] = [];
  private texts = new Map<string, Promise<TextRun[]>>();
  private lastSources: readonly Source[] | undefined;
  /** The pause (ms) before asking again for a missing file, after `attempt` tries. */
  retryDelay(attempt: number): number {
    return Math.min(30_000, (this.options.retryMs ?? 1000) * 2 ** Math.min(attempt, 10));
  }
  /** What happened, for tests and diagnostics. */
  readonly stats = { opened: 0, pagesLoaded: 0, pagesFreed: 0 };

  constructor(session: PdfSession, renderer: PdfRenderer, options: PageSourcesOptions = {}) {
    this.session = session;
    this.renderer = renderer;
    this.options = options;
  }

  private sourceOf(page: Page): Source | undefined {
    return page.from ? this.session.doc.sources.find((s) => s.id === page.from!.source) : undefined;
  }

  /** The key a page is cached under: the same for two pages that show the same source page. */
  key(page: Page): string {
    if (!page.from) return `blank:${page.id}:${page.width}x${page.height}`;
    const source = this.sourceOf(page);
    return `${source ? sourceKey(source) : page.from.source + ":?"}#${page.from.index}`;
  }

  /** Forgets files that are no longer sources of the document, or whose bytes changed. */
  sync(): void {
    const sources = this.session.doc.sources;
    if (sources === this.lastSources) return;
    this.lastSources = sources;
    this.texts.clear();
    const live = new Set(sources.map(sourceKey));
    for (const [key, doc] of [...this.docs]) {
      if (live.has(key)) continue;
      this.docs.delete(key);
      doc.then((d) => d.destroy()).catch(() => {});
      for (const [pk, entry] of [...this.entries]) {
        if (entry.doc !== key) continue;
        this.entries.delete(pk);
        this.idle = this.idle.filter((k) => k !== pk);
        entry.promise.then((p) => p.destroy()).catch(() => {});
      }
    }
  }

  private document(source: Source): Promise<RenderedDocument> {
    const key = sourceKey(source);
    let doc = this.docs.get(key);
    if (!doc) {
      doc = (async () => {
        const bytes = await this.session.sources.get(source);
        if (!bytes) throw new SourceMissing(source);
        const password = typeof this.options.password === "function" ? this.options.password(source) : this.options.password;
        const open: OpenOptions = password ? { password } : {};
        this.stats.opened++;
        return this.renderer.open(bytes, open);
      })();
      // A file that is not there yet is asked for again next time, not remembered as failed.
      doc.catch((e) => {
        if (e instanceof SourceMissing && this.docs.get(key) === doc) this.docs.delete(key);
      });
      this.docs.set(key, doc);
    }
    return doc;
  }

  /** Takes a page for use; `release` it when it is not shown any more. */
  acquire(page: Page): PageLease {
    this.sync();
    const key = this.key(page);
    let entry = this.entries.get(key);
    if (!entry) {
      let promise: Promise<RenderedPage>;
      let docKey: string | undefined;
      if (!page.from) promise = Promise.resolve(blankPage(page.width, page.height));
      else {
        const source = this.sourceOf(page);
        const from = page.from;
        if (!source) promise = Promise.reject(new PliError("not_found", `page ${page.id} refers to a file that is not in the document`));
        else {
          docKey = sourceKey(source);
          promise = this.document(source).then(async (doc) => {
            if (from.index < 0 || from.index >= doc.pages) throw new PliError("not_found", `the file has no page ${from.index + 1}`);
            return doc.page(from.index);
          });
        }
      }
      entry = { promise, refs: 0, doc: docKey };
      const made = entry;
      promise.catch((e) => {
        if (e instanceof SourceMissing && this.entries.get(key) === made) {
          this.entries.delete(key);
          this.idle = this.idle.filter((k) => k !== key);
        }
      });
      this.stats.pagesLoaded++;
      this.entries.set(key, entry);
      promise.then((p) => (entry!.page = p), () => {});
    }
    this.idle = this.idle.filter((k) => k !== key);
    entry.refs++;
    const held = entry;
    let released = false;
    return {
      promise: held.promise,
      release: () => {
        if (released) return;
        released = true;
        held.refs--;
        if (held.refs > 0 || this.entries.get(key) !== held) return;
        this.idle.push(key);
        const max = this.options.maxIdle ?? 24;
        while (this.idle.length > max) {
          const old = this.idle.shift()!;
          const e = this.entries.get(old);
          if (!e || e.refs > 0) continue;
          this.entries.delete(old);
          this.stats.pagesFreed++;
          e.promise.then((p) => p.destroy()).catch(() => {});
        }
      },
    };
  }

  /** The text of a page (kept until the file changes), for the text layer and for search. */
  text(page: Page): Promise<TextRun[]> {
    if (!page.from) return Promise.resolve([]);
    this.sync();
    const key = this.key(page);
    const known = this.texts.get(key);
    if (known) return known;
    const lease = this.acquire(page);
    const result = lease.promise.then((p) => p.text());
    result.then(() => lease.release(), () => lease.release());
    this.texts.set(key, result);
    result.catch(() => this.texts.delete(key));
    // Keep the texts of the most recent pages only.
    if (this.texts.size > 400) this.texts.delete(this.texts.keys().next().value!);
    return result;
  }

  /** The outline of a source file as the renderer reads it. */
  async outline(sourceId = "main"): Promise<RenderedOutlineItem[]> {
    const source = this.session.doc.sources.find((s) => s.id === sourceId);
    if (!source) return [];
    const doc = await this.document(source);
    return (await doc.outline?.()) ?? [];
  }

  /** Frees everything. The object can be used again afterwards (files are opened again when asked for). */
  destroy(): void {
    for (const doc of this.docs.values()) doc.then((d) => d.destroy()).catch(() => {});
    for (const entry of this.entries.values()) entry.promise.then((p) => p.destroy()).catch(() => {});
    this.docs.clear();
    this.entries.clear();
    this.texts.clear();
    this.idle = [];
    this.lastSources = undefined;
  }
}
