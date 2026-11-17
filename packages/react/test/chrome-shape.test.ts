import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The shape of the four editors' chrome comes from one set of variables in the shared sheet. These checks hold that: the sheet
// defines the shape once, and the other three sheets do not carry a copy of their own.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const shared = strip(read("../src/styles.css"));
const sheets = { Sheets: strip(read("../../sheets-react/src/styles.css")), Decks: strip(read("../../decks-react/src/styles.css")), PDF: strip(read("../../pdf-react/src/styles.css")) };

const rule = (css: string, selector: string): string => {
  const at = css.search(new RegExp(`^${selector.replace(/[.[\]()*:"=]/g, "\\$&")} \\{`, "m"));
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
};

describe("one shape for the bars and the frame of Docs, Sheets, Decks and PDF", () => {
  it("the bar is a pill: radius, border, margin, padding and surface all come from the shared variables", () => {
    const bar = rule(shared, ".pli-toolbar");
    expect(bar).toMatch(/border-radius:\s*var\(--pli-chrome-radius, 1\.25rem\)/);
    expect(bar).toMatch(/border:\s*1px solid var\(--pli-border\)/);
    expect(bar).toMatch(/margin:\s*var\(--pli-bar-margin, /);
    expect(bar).toMatch(/padding:\s*var\(--pli-bar-padding, /);
    expect(bar).toMatch(/background:\s*var\(--pli-bar-bg, var\(--pli-bg\)\)/);
    expect(bar).toMatch(/gap:\s*var\(--pli-bar-gap, /);
  });

  it("a bar is one row that scrolls sideways, with a hidden scroll bar and fading ends", () => {
    const bar = rule(shared, ".pli-toolbar");
    expect(bar).toMatch(/flex-wrap:\s*nowrap/);
    expect(bar).toMatch(/overflow-x:\s*auto/);
    expect(bar).toMatch(/scrollbar-width:\s*none/);
    expect(shared).toMatch(/\.pli-toolbar::-webkit-scrollbar\s*\{\s*display:\s*none/);
    expect(shared).toMatch(/\.pli-toolbar\[data-overflow="end"\]/);
    expect(shared).toMatch(/\.pli-toolbar\[data-overflow="start"\]/);
    // the fade is the bar's own colour, so it is right in dark mode too
    expect(rule(shared, ".pli-toolbar::before,\n.pli-toolbar::after")).toMatch(/box-shadow:[^;]*var\(--pli-bar-bg, var\(--pli-bg\)\)/);
  });

  it("buttons are round, from --pli-tool-radius", () => {
    expect(rule(shared, ".pli-tool")).toMatch(/border-radius:\s*var\(--pli-tool-radius, 999px\)/);
  });

  it("the frame of all four editors is rounded and clips to its corners, from --pli-frame-radius and --pli-frame-border", () => {
    const frame = shared.slice(shared.indexOf(".pli-document,\n.pli-spreadsheet,\n.pli-deck,\n.pli-pdf {"));
    const body = frame.slice(0, frame.indexOf("}"));
    expect(body).toMatch(/border-radius:\s*var\(--pli-frame-radius, 0\.75rem\)/);
    expect(body).toMatch(/border:\s*var\(--pli-frame-border, 1px solid var\(--pli-border\)\)/);
    expect(body).toMatch(/overflow:\s*hidden/);
    expect(body).toMatch(/box-sizing:\s*border-box/);
  });

  it("data-pli-chrome=\"square\" turns the rounding off for everything under it", () => {
    const square = rule(shared, '[data-pli-chrome="square"]');
    for (const v of ["--pli-chrome-radius: 0", "--pli-frame-radius: 0", "--pli-frame-border: 0"]) expect(square).toContain(v);
    expect(square).toMatch(/--pli-tool-radius:\s*0\.4rem/);
  });

  it("the variables are not declared anywhere, so a host can set them on the editor or any ancestor and win", () => {
    for (const name of ["chrome-radius", "frame-radius", "frame-border", "bar-margin", "bar-padding", "bar-gap", "bar-bg", "tool-radius"]) {
      const declared = [shared, ...Object.values(sheets)].some((css) => new RegExp(`(^|[;{\\s])--pli-${name}\\s*:`, "m").test(css.replace(/\[data-pli-chrome="square"\][^}]*\}/, "").replace(/\.pli-pdf \.pli-pdf-pagebar[^}]*\}/, "")));
      expect(declared, `--pli-${name} has a default declared by a sheet`).toBe(false);
    }
  });

  it("Sheets, Decks and PDF keep no radius, margin or surface for their bars of their own", () => {
    for (const [name, css] of Object.entries(sheets)) {
      for (const m of css.matchAll(/([^{}]*\.pli-toolbar[^{}]*)\{([^}]*)\}/g)) {
        const selector = m[1]!.trim();
        if (/pagebar|\.pli-group|:not|\+|data-size="phone"|@media|\.pli-pdf-formatbar \.pli/.test(selector)) continue; // spacing between things, and the phone's smaller margin
        expect(m[2], `${name}: ${selector}`).not.toMatch(/border-radius|background/);
      }
    }
    expect(sheets.Decks).not.toMatch(/\.pli-deck \.pli-toolbar\s*\{/);
  });

  it("a menu or picker opened from a bar is outside the scroll area (position: fixed) and opaque", () => {
    const panel = rule(shared, ".pli-panel");
    expect(panel).toMatch(/background:\s*var\(--pli-bg\)/);
    expect(rule(shared, ".pli-panel-fixed")).toMatch(/position:\s*fixed/);
    expect(rule(shared, ".pli-panel-fixed")).toMatch(/background-color:\s*var\(--pli-bg, #ffffff\)/);
  });

  it("a full-screen PDF has square corners and no frame", () => {
    expect(rule(sheets.PDF, ".pli-pdf[data-fullscreen]")).toMatch(/border-radius:\s*0/);
  });
});
