import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HERO_PAGES, MENU_ICONS, PRODUCTS, SECTIONS, STATUSES } from "../src/products";

/** The product landing pages: what products.ts says, and (when a build exists) the shape of the built HTML. */
const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, "..", "src", "content", "docs");

describe("products.ts", () => {
  it("has a real docs page behind every card and menu entry", () => {
    for (const p of [...PRODUCTS, ...SECTIONS]) {
      expect(p.href, p.menu).toMatch(/^\/[a-z0-9/-]+\/$/);
      const dir = join(docs, p.href);
      const found = ["index.md", "index.mdx", ".md", ".mdx"].some((f) => existsSync(f.startsWith("index") ? join(dir, f) : dir.replace(/\/$/, "") + f));
      expect(found, `${p.href} has no page`).toBe(true);
    }
  });
  it("uses valid statuses and short blurbs", () => {
    for (const p of PRODUCTS) {
      expect(STATUSES, p.name).toContain(p.status);
      expect(p.blurb.length).toBeGreaterThan(20);
      expect(p.blurb.length).toBeLessThan(140);
    }
  });
  it("calls the four editors that exist In progress, not Planned", () => {
    for (const n of ["Documents", "Sheets", "Decks", "PDF"]) expect(PRODUCTS.find((p) => p.name === n)?.status).not.toBe("Planned");
  });
  it("has unique hrefs and a menu icon for each", () => {
    const hrefs = [...PRODUCTS, ...SECTIONS].map((p) => p.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(MENU_ICONS.has(h)).toBe(true);
  });
  it("lists hero pages that are MDX files", () => {
    for (const id of HERO_PAGES) expect(existsSync(join(docs, id, "index.mdx")) || existsSync(join(docs, id + ".mdx")), id).toBe(true);
  });
});

function builtPage(path: string): string | undefined {
  for (const base of [process.env.PLI_SITE_DIST, join(here, "..", "dist")]) {
    if (!base) continue;
    const file = join(base, path, "index.html");
    if (!existsSync(file)) continue;
    const html = readFileSync(file, "utf8");
    if (html.includes("ph not-content")) return html;
  }
  return undefined;
}

const EDITORS = ["documents", "sheets", "decks", "pdf"] as const;
describe("built product pages (skipped without a build; set PLI_SITE_DIST to a build's folder)", () => {
  for (const slug of [...EDITORS, "platform/architecture"]) {
    const html = builtPage(slug);
    const t = html ? it : it.skip;
    t(`${slug}: one h1, a hero, the sidebar`, () => {
      expect(html!.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain('class="ph not-content"');
      expect(html).toContain('id="_top"');
      expect(html).toContain("<title>");
      expect(html).toContain("sidebar-content");
    });
  }
  for (const slug of EDITORS) {
    const html = builtPage(slug);
    const t = html ? it : it.skip;
    t(`${slug}: a live editor island with its poster inside`, () => {
      expect(html).toMatch(/<astro-island[^>]*client="visible"/);
      expect(html).toContain("LiveEditor");
      expect(html).toContain(`data-poster="${slug === "documents" ? "docs" : slug}"`);
      expect(html).toContain('role="img"');
    });
  }
  const arch = builtPage("platform/architecture");
  (arch ? it : it.skip)("platform: the architecture picture, no editor island", () => {
    expect(arch).not.toMatch(/<astro-island[^>]*client="visible"/);
    expect(arch).toContain("@pli.dev/core");
    expect(arch).toContain("ph-arch");
  });
});
