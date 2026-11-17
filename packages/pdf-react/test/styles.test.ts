// The layout rules of the style sheet, read as text. jsdom lays nothing out, so a browser is what really shows an overlap; these
// checks hold the rules that keep the sidebar reachable, so changing one of them by accident fails here first.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "../src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
  /** The at-rule it sits in (`@media (max-width: 640px)`, `@container ...`), or "". */
  at: string;
  selector: string;
  body: string;
}

/** Splits the sheet into rules, flattening @media and @container blocks (one level is all it uses). */
function parse(text: string, at = ""): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const inner = text.slice(open + 1, j - 1);
    if (head.startsWith("@media") || head.startsWith("@container") || head.startsWith("@supports")) out.push(...parse(inner, head));
    else if (!head.startsWith("@")) for (const sel of head.split(",")) out.push({ at, selector: sel.trim().replace(/\s+/g, " "), body: inner });
    i = j;
  }
  return out;
}

/** The shared sheet of @pli.dev/react, which holds the bars' shape and their scrolling. */
const shared = readFileSync(resolve(__dirname, "../../react/src/styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const rules = parse(css);
const rulesFor = (selector: string): Rule[] => rules.filter((r) => r.selector === selector);
/** The value of a property in the rule(s) with exactly this selector and no at-rule. */
function prop(selector: string, name: string, at = ""): string | undefined {
  const found = rulesFor(selector).filter((r) => r.at === at);
  expect(found.length, `rule ${selector}`).toBeGreaterThan(0);
  let value: string | undefined;
  for (const r of found) {
    const m = new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+)`).exec(r.body);
    if (m) value = m[1]!.trim();
  }
  return value;
}
const varValue = (name: string): number => Number(new RegExp(`${name}\\s*:\\s*(\\d+)`).exec(css)![1]);

describe("layout rules: the sidebar is never covered or squeezed", () => {
  it("the viewer fills its host (a block or a flex row) and never makes the host wider", () => {
    expect(prop(".pli-pdf", "width")).toBe("100%");
    expect(prop(".pli-pdf", "min-width")).toBe("0");
    expect(prop(".pli-pdf", "min-height")).toBe("0");
  });

  it("the body is a row, and the page area gives way to the panels: it may shrink to nothing (min-width: 0) and takes the rest", () => {
    expect(prop(".pli-pdf-body", "display")).toBe("flex");
    expect(prop(".pli-pdf-body", "min-width")).toBe("0");
    expect(prop(".pli-pdf-main", "min-width")).toBe("0");
    expect(prop(".pli-pdf-main", "flex")).toBe("1 1 0");
    expect(prop(".pli-pdf-scroller", "min-height")).toBe("0");
  });

  it("the sidebar and the properties panel have widths of their own, never grow, never shrink below nothing, and cannot take over", () => {
    for (const sel of [".pli-pdf-sidebar", ".pli-pdf-right"]) {
      expect(prop(sel, "flex"), sel).toBe("0 0 auto");
      expect(prop(sel, "max-width"), sel).toBe("40%");
      expect(prop(sel, "min-width"), sel).toBe("0");
      expect(prop(sel, "min-height"), sel).toBe("0");
    }
    expect(prop(".pli-pdf-sidebar", "width")).toBe("var(--pli-pdf-sidebar-w)");
    expect(prop(".pli-pdf-right", "width")).toBe("var(--pli-pdf-right-w)");
    const px = (name: string) => Number(new RegExp(`${name}\\s*:\\s*(\\d+)px`).exec(css)![1]);
    expect(px("--pli-pdf-sidebar-w")).toBeGreaterThanOrEqual(220);
    expect(px("--pli-pdf-sidebar-w")).toBeLessThanOrEqual(320);
    expect(px("--pli-pdf-right-w")).toBeGreaterThanOrEqual(280);
    expect(px("--pli-pdf-right-w")).toBeLessThanOrEqual(320);
  });

  it("in a wide viewer the panels take part in the row: no position absolute or fixed on them", () => {
    for (const sel of [".pli-pdf-sidebar", ".pli-pdf-right"]) {
      const position = prop(sel, "position");
      expect(position === undefined || position === "relative", `${sel}: ${position}`).toBe(true);
    }
    expect(prop(".pli-pdf-sidebar", "position")).toBe("relative");
  });

  it("they leave the row only for a narrow viewer, by data attributes the viewer sets from its own width (not by the window's media)", () => {
    const floating = rules.filter((r) => /\.pli-pdf-(right|sidebar)\b/.test(r.selector) && /position\s*:\s*(absolute|fixed)/.test(r.body));
    expect(floating.length).toBeGreaterThan(0);
    for (const r of floating) expect(/\[data-(size|overlay)/.test(r.selector), r.selector).toBe(true);
    // no window media query touches the layout of the panels or the backdrop
    for (const r of rules.filter((r) => r.at.startsWith("@media") && /max-width/.test(r.at))) {
      expect(/\.pli-pdf-(right|sidebar|scrim|body|main)\b/.test(r.selector), `${r.at} { ${r.selector} }`).toBe(false);
    }
    expect(prop(".pli-pdf-right[data-overlay]", "position")).toBe("absolute");
    expect(prop('.pli-pdf[data-size="phone"] .pli-pdf-sidebar', "position")).toBe("absolute");
    expect(prop('.pli-pdf-right[data-overlay="phone"]', "top")).toBe("auto"); // a sheet from the bottom edge
  });

  it("the panels scroll inside themselves: the tab strip sideways, the bodies down", () => {
    expect(prop(".pli-pdf-tabs", "overflow-x")).toBe("auto");
    expect(prop(".pli-pdf-sidebar-body", "overflow-y")).toBe("auto");
    expect(prop(".pli-pdf-right-body", "overflow-y")).toBe("auto");
    expect(prop(".pli-pdf-right", "overflow")).toBe("hidden");
    expect(prop(".pli-pdf-tab", "flex")).toBe("1 0 auto"); // a tab never shrinks under its icon
    expect(prop(".pli-pdf-sidebar-body", "min-height")).toBe("0");
    expect(prop(".pli-pdf-right-body", "min-height")).toBe("0");
  });

  it("tabs turn into icons in a narrow strip with a container query on the strip, not on the sidebar (a container would trap its fixed menus)", () => {
    const q = rules.find((r) => r.at.startsWith("@container") && r.selector === ".pli-pdf-tab span");
    expect(q).toBeTruthy();
    expect(q!.at).toContain("pli-tabs");
    expect(prop(".pli-pdf-tabs", "container-type")).toBe("inline-size");
    expect(rulesFor(".pli-pdf-sidebar").some((r) => /container-type/.test(r.body))).toBe(false);
    expect(rulesFor(".pli-pdf-right").some((r) => /container-type|transform|filter|contain\s*:/.test(r.body))).toBe(false);
  });

  it("the resize handle is a column-resize edge that does not scroll the page under a finger", () => {
    expect(prop(".pli-pdf-resize", "cursor")).toBe("col-resize");
    expect(prop(".pli-pdf-resize", "touch-action")).toBe("none");
    expect(prop(".pli-pdf-resize", "position")).toBe("absolute");
  });
});

describe("layout rules: the bars scroll sideways instead of wrapping", () => {
  it("the bars are the shared .pli-toolbar (one row, scrolling), and PDF does not wrap or unclip them again", () => {
    // PDF's own sheet must not undo what the shared sheet gives a bar: one row, the overflow scrolling, the shape from the tokens.
    for (const selector of [".pli-pdf .pli-toolbar", ".pli-pdf .pli-pdf-toolbar", ".pli-pdf .pli-toolbar.pli-pdf-ribbon", ".pli-pdf .pli-toolbar.pli-pdf-formatbar", ".pli-pdf .pli-pdf-pagebar"]) {
      for (const r of rulesFor(selector)) {
        expect(r.body, selector).not.toMatch(/flex-wrap\s*:\s*wrap/);
        expect(r.body, selector).not.toMatch(/overflow(-x)?\s*:\s*visible/);
        expect(r.body, selector).not.toMatch(/border-radius/); // the shape is --pli-chrome-radius
      }
    }
    expect(prop(".pli-pdf-ribbon-inner", "flex-wrap")).toBe("nowrap");
    expect(prop(".pli-pdf-ribbon-inner", "flex")).toBe("none");
    expect(prop(".pli-pdf .pli-toolbar .pli-group", "flex-wrap")).toBe("nowrap");
    expect(css).not.toMatch(/min-width\s*:\s*max-content/);
  });

  it("the shared sheet gives every bar one row, a hidden scroll bar and fading ends", () => {
    for (const p of ["flex-wrap: nowrap", "overflow-x: auto", "scrollbar-width: none", "overscroll-behavior-x: contain"]) expect(shared, p).toContain(p);
    expect(shared).toMatch(/\.pli-toolbar\[data-overflow="end"\]/);
    expect(shared).toMatch(/\.pli-toolbar\[data-overflow="start"\]/);
  });

  it("the toolbar is not a stacking context, so its menus stay above the drawers", () => {
    const toolbar = rules.filter((r) => /^\.pli-pdf( \.pli-pdf-toolbar|\s+\.pli-toolbar)?$/.test(r.selector) || r.selector === ".pli-pdf .pli-pdf-toolbar");
    for (const r of toolbar.filter((r) => r.selector !== ".pli-pdf")) expect(r.body, r.selector).not.toMatch(/z-index/);
  });

  it("the find bar stays inside the page area and wraps", () => {
    expect(prop(".pli-pdf-find", "position")).toBe("absolute");
    expect(prop(".pli-pdf-find", "flex-wrap")).toBe("wrap");
    expect(prop(".pli-pdf-find", "max-width")).toMatch(/calc\(100% - /);
    expect(rulesFor(".pli-pdf-main").some((r) => /position\s*:\s*relative/.test(r.body))).toBe(true);
  });
});

describe("layout rules: the stacking ladder", () => {
  it("is toolbar (none) < find < organise < backdrop < drawer < sheet < popovers < dialogs < toasts", () => {
    const ladder = ["find", "organise", "scrim", "drawer", "sheet", "popover", "dialog", "toast"].map((n) => varValue(`--pli-pdf-z-${n}`));
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!, `step ${i}`).toBeGreaterThan(ladder[i - 1]!);
  });

  it("and the rules use the ladder instead of numbers of their own", () => {
    const uses = (selector: string, name: string) => expect(prop(selector, "z-index"), selector).toBe(`var(--pli-pdf-z-${name})`);
    uses(".pli-pdf-find", "find");
    uses(".pli-pdf-organise", "organise");
    uses(".pli-pdf-scrim", "scrim");
    uses('.pli-pdf[data-size="phone"] .pli-pdf-sidebar', "drawer");
    uses(".pli-pdf-right[data-overlay]", "sheet");
    uses(".pli-pdf-popover", "popover");
    uses(".pli-panel.pli-pdf-ctx", "popover");
    uses(".pli-pdf-toasts", "toast");
    uses(".pli-pdf dialog.pli-dialog", "dialog");
  });

  it("a popover or a menu never outgrows the screen", () => {
    expect(prop(".pli-pdf-popover", "max-width")).toMatch(/100vw/);
    expect(prop(".pli-pdf-popover", "max-height")).toMatch(/100vh/);
    expect(prop(".pli-panel.pli-pdf-ctx", "max-height")).toMatch(/100vh/);
  });

  it("the organise view covers the page area only (inside .pli-pdf-main), so the sidebar stays reachable", () => {
    expect(prop(".pli-pdf-organise", "position")).toBe("absolute");
    expect(prop(".pli-pdf-organise", "inset")).toBe("0");
    expect(prop(".pli-pdf-main", "position")).toBe("relative");
  });
});

describe("the title row, the menu bar and the text bar", () => {
  it("wrap instead of clipping (the bars below them scroll)", () => {
    // the title row and the menu bar still wrap: the menu bar's menus open inside it, so it cannot be a scroll area
    for (const selector of [".pli-pdf .pli-pdf-titlebar", ".pli-pdf .pli-pdf-menubar"]) expect(prop(selector, "flex-wrap"), selector).toBe("wrap");
    expect(prop(".pli-pdf .pli-pdf-titlebar .pli-actions", "flex-wrap")).toBe("wrap");
    expect(prop(".pli-pdf .pli-pdf-titlebar .pli-pdf-title", "min-width")).toBe("0");
  });

  it("on a phone the menus open full width under the bar and their submenus unfold in place", () => {
    const at = (selector: string) => rulesFor(selector).find((r) => r.at === "")?.body ?? "";
    expect(at('.pli-pdf[data-size="phone"] .pli-pdf-menubar .pli-menubar-item')).toMatch(/position:\s*static/);
    expect(at('.pli-pdf[data-size="phone"] .pli-pdf-menubar .pli-panel')).toMatch(/left:\s*0\.5rem/);
    expect(at('.pli-pdf[data-size="phone"] .pli-pdf-menubar .pli-submenu')).toMatch(/position:\s*static/);
  });

  it("a menu is above the pages and the sidebar drawer but below dialogs, and does not clip its submenus", () => {
    expect(prop(".pli-pdf .pli-pdf-menubar .pli-panel", "z-index")).toBe("var(--pli-pdf-z-popover)");
    expect(prop(".pli-pdf .pli-pdf-menubar .pli-panel", "overflow-y")).toBeUndefined();
  });

  it("keeps the name of the document in the title row on a phone, and hides it only in a toolbar", () => {
    expect(rulesFor('.pli-pdf[data-size="phone"] .pli-pdf-title-name')).toEqual([]);
    expect(prop('.pli-pdf[data-size="phone"] .pli-pdf-toolbar .pli-pdf-title-name', "display")).toBe("none");
  });
});
