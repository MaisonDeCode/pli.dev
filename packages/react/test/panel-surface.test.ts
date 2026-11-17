import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../src/styles.css"), "utf8");
const rule = (selector: string): string => {
  const at = css.search(new RegExp(`^${selector.replace(/[.[\]]/g, "\\$&")} \\{`, "m"));
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

describe("floating panels (the font list and every dropdown) have a surface of their own", () => {
  it("fixed panels are opaque, rounded, bordered, shadowed and above the editor's side panels", () => {
    const panel = rule(".pli-panel");
    expect(panel).toMatch(/background:\s*var\(--pli-bg\)/);
    expect(panel).toMatch(/border:\s*1px solid/);
    expect(panel).toMatch(/border-radius/);
    expect(panel).toMatch(/box-shadow/);
    expect(rule(".pli-panel-fixed")).toMatch(/z-index:\s*(\d{3,})/);
    expect(rule(".pli-panel-fixed")).toMatch(/background-color:\s*var\(--pli-bg, #ffffff\)/);
  });

  it("a panel put straight into the page body still gets the colours (light and dark)", () => {
    expect(css.match(/body > \.pli-panel-fixed/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("the font list has its own background, a scrolling list, and hover, active and selected states", () => {
    expect(rule(".pli-fonts")).toMatch(/background:\s*var\(--pli-bg/);
    expect(rule(".pli-fonts-list")).toMatch(/overflow-y:\s*auto/);
    expect(rule(".pli-fonts-list")).toMatch(/max-height/);
    expect(css).toMatch(/\.pli-fonts-item:hover/);
    expect(css).toMatch(/\.pli-fonts-item\[data-active\]/);
    expect(css).toMatch(/\.pli-fonts-item\[aria-selected="true"\]/);
  });
});
