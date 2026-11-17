// Every internal link and asset reference in the built site must resolve to a file in the build. Skips when there is no build.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dist = resolve(process.env.PLI_SITE_DIST ?? new URL("../dist", import.meta.url).pathname);
const built = existsSync(join(dist, "index.html")) && readFileSync(join(dist, "index.html"), "utf8").includes("pli-marketing");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "pagefind") return [];
    if (statSync(path).isDirectory()) return pages(path);
    return name.endsWith(".html") ? [path] : [];
  });
}

function resolves(href: string): boolean {
  const path = decodeURIComponent(href.split("#")[0]!.split("?")[0]!);
  if (path === "") return true;
  const file = join(dist, path);
  return existsSync(file) && (statSync(file).isFile() || existsSync(join(file, "index.html")));
}

describe.skipIf(!built)("links in the built site", () => {
  it("every internal href and src resolves to a file", () => {
    const missing: string[] = [];
    for (const page of pages(dist)) {
      const html = readFileSync(page, "utf8");
      for (const [, url] of html.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
        if (url!.startsWith("//") || url!.startsWith("/cdn-cgi")) continue;
        if (!resolves(url!)) missing.push(`${page.slice(dist.length)} -> ${url}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every in-page #anchor on the landing page has a target", () => {
    const html = readFileSync(join(dist, "index.html"), "utf8");
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const missing = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!).filter((id) => !ids.has(id));
    expect(missing).toEqual([]);
  });

  it("the landing page loads no render-blocking third-party or editor script or stylesheet", () => {
    const html = readFileSync(join(dist, "index.html"), "utf8");
    expect(html).not.toMatch(/<link[^>]*stylesheet[^>]*href="https?:/);
    expect(html).not.toMatch(/<script(?![^>]*type="module")[^>]*src=/);
    const sheets = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
    for (const href of sheets) {
      const css = readFileSync(join(dist, href), "utf8");
      expect(css, href).not.toContain(".pli-spreadsheet");
      expect(css, href).not.toContain(".pli-pdf-page");
      expect(css, href).not.toContain(".pli-deck-filmstrip");
    }
  });
});
