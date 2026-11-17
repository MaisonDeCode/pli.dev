// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act, createRef } from "react";
import { AnnotatedPdf, PliPdf, type PliPdfHandle } from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { shortcutGroups } from "../src/shortcuts";
import { shortcutTable } from "../src/annotKeys";
import { annots, byLabel, click, flush, host, key, mount, openProperties, q, qa, render, run, setValue, tap, tool, useAnnotHost, viewport } from "./annotHarness";

useAnnotHost();

const P0 = "p:main:0";
type A = Record<string, any>;
const get = (m: { session: { annots: { get(id: string): unknown } } }, id: string) => m.session.annots.get(id) as A;
const props = () => q(".pli-pdf-props", host);
const field = (label: string) => q(`[aria-label='${label}']`, props());
/** The text bar above the pages: font, size, bold, italic, colours and alignment of a text box. */
const bar = () => q(".pli-pdf-formatbar", host);
const stroke = { color: "#000000", width: 2 };
const scroller = () => q(".pli-pdf-scroller");

async function select(annot: Record<string, unknown>, opts: Parameters<typeof mount>[0] = {}) {
  const m = await mount(opts);
  const id = await run(() => m.session.annots.add(P0, annot as never));
  await flush();
  return { ...m, id };
}

describe("properties of a selection", () => {
  it("changes colour, opacity, width, line style and fill, each an undo step (a slider drag is one)", async () => {
    const m = await select({ type: "square", rect: { x: 100, y: 100, w: 100, h: 60 }, stroke });
    expect(q(".pli-pdf-props-title", host).textContent).toBe("Rectangle");
    await click(byLabel("Colour #1e88e5", props()));
    expect(get(m, m.id).stroke).toMatchObject({ color: "#1e88e5", width: 2 });
    await click(byLabel("Fill #ffe14d", props()));
    expect(get(m, m.id).fill).toBe("#ffe14d");
    await click(byLabel("Fill: none", props()));
    expect(get(m, m.id).fill).toBeUndefined();
    await setValue(field("Line width") as HTMLInputElement, "5");
    expect(get(m, m.id).stroke.width).toBe(5);
    const dashes = field("Line style") as HTMLSelectElement;
    await act(async () => {
      dashes.value = "dashed";
      dashes.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(get(m, m.id).stroke.dash).toEqual([6, 3]);
    await act(async () => {
      dashes.value = "solid";
      dashes.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(get(m, m.id).stroke.dash).toBeUndefined();
    for (const v of ["80", "60", "40"]) await setValue(field("Opacity") as HTMLInputElement, v);
    expect(get(m, m.id).opacity).toBe(0.4);
    expect(q("output", props()).textContent).toBe("40%");
    // the three slider moves are one undo step
    await run(() => m.session.undo());
    expect(get(m, m.id).opacity).toBeUndefined();
    // choosing a line style twice in a moment is one step too
    await run(() => m.session.undo());
    expect(get(m, m.id).stroke.dash).toBeUndefined();
    expect(get(m, m.id).stroke.width).toBe(5);
    await run(() => m.session.undo());
    expect(get(m, m.id).stroke.width).toBe(2);
  });

  it("sets a custom colour and keeps it as what the tool draws next", async () => {
    const m = await select({ type: "square", rect: { x: 100, y: 100, w: 100, h: 60 }, stroke });
    await setValue(field("Colour: custom colour") as HTMLInputElement, "#123456");
    expect(get(m, m.id).stroke.color).toBe("#123456");
    expect(m.c().style("rectangle")).toMatchObject({ color: "#123456", width: 2 });
    await tool("Select");
    expect(JSON.parse(localStorage.getItem("t:styles")!).rectangle.color).toBe("#123456");
  });

  it("changes the ends of a line, the icon of a note and the text of a redaction mark", async () => {
    const m = await select({ type: "line", from: [100, 100], to: [300, 100], stroke });
    const end = field("End of line") as HTMLSelectElement;
    await act(async () => {
      end.value = "open-arrow";
      end.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(get(m, m.id)).toMatchObject({ endEnd: "open-arrow" });
    await act(async () => {
      end.value = "none";
      end.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(get(m, m.id).endEnd).toBeUndefined();
    const n = await run(() => m.session.annots.add(P0, { type: "note", x: 10, y: 10, contents: "x" } as never));
    await flush();
    const icon = field("Note icon") as HTMLSelectElement;
    await act(async () => {
      icon.value = "key";
      icon.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(get(m, n).icon).toBe("key");
    const r = await run(() => m.session.annots.add(P0, { type: "redact", rects: [{ x: 1, y: 1, w: 50, h: 10 }] } as never));
    await flush();
    await setValue(field("Text over the box") as HTMLInputElement, "REDACTED");
    expect(get(m, r).overlay).toBe("REDACTED");
  });

  it("changes the font, size, style and alignment of a text box", async () => {
    const m = await select({ type: "freetext", rect: { x: 100, y: 100, w: 160, h: 40 }, text: "Hello", style: { family: "Helvetica", size: 12, color: "#000000" } });
    expect(byLabel("Font", bar())).toBeTruthy();
    // the properties panel no longer repeats what the text bar has
    expect(props().querySelector("[aria-label='Bold']")).toBeNull();
    const size = q("input[aria-label='Font size']", bar()) as HTMLInputElement;
    await setValue(size, "18");
    await key(size, "Enter");
    expect(get(m, m.id).style.size).toBe(18);
    await click(byLabel("Increase font size", bar()));
    expect(get(m, m.id).style.size).toBe(20);
    await click(byLabel("Decrease font size", bar()));
    expect(get(m, m.id).style.size).toBe(18);
    await click(byLabel("Bold", bar()));
    await click(byLabel("Italic", bar()));
    await click(byLabel("Align center", bar()));
    expect(get(m, m.id).style).toMatchObject({ size: 18, bold: true, italic: true, align: "center" });
    await click(byLabel("Bold", bar()));
    expect(get(m, m.id).style.bold).toBeUndefined();
    await click(byLabel("Colour #e53935", props()));
    expect(get(m, m.id).style.color).toBe("#e53935");
    // the colours of the bar are the shared picker: text colour, and fill (the highlight of a box)
    await click(byLabel("Text colour", bar()));
    await click(byLabel("#0000ff", document));
    expect(get(m, m.id).style.color).toBe("#0000ff");
    await click(byLabel("Fill colour", bar()));
    await click(byLabel("#ffff00", document));
    expect((get(m, m.id) as { fill?: string }).fill).toBe("#ffff00");
    // the font picker is the shared one
    await click(byLabel("Font", bar()));
    expect(document.querySelector(".pli-fonts")).toBeTruthy();
    expect(m.c().style("text")).toMatchObject({ size: 18, italic: true, align: "center", color: "#0000ff" });
  });

  it("falls back to a plain list of fonts when no font catalogue is wanted", async () => {
    const m = await select({ type: "freetext", rect: { x: 100, y: 100, w: 160, h: 40 }, text: "Hello", style: { family: "Helvetica", size: 12, color: "#000000" } }, { kit: { fonts: false } });
    const font = q("select[aria-label='Font']", bar()) as HTMLSelectElement;
    expect([...font.options].map((o) => o.value)).toEqual(["Helvetica", "Times", "Courier"]);
    await act(async () => {
      font.value = "Courier";
      font.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(get(m, m.id).style.family).toBe("Courier");
    expect(q("[data-type=freetext] text").style.fontFamily).toContain("monospace");
  });

  it("locks, shows who and when, orders, duplicates and deletes", async () => {
    const m = await mount({ user: { id: "u1", name: "Ana Reyes" } });
    const [a, b] = await run(() => [0, 1].map((i) => m.session.annots.add(P0, { type: "square", rect: { x: 100 + i * 20, y: 100, w: 100, h: 60 }, stroke, modified: new Date(2026, 5, 1, 9, 30).getTime(), author: "u1", authorName: "Ana Reyes" } as never, { select: false })));
    await run(() => m.c().select([a!]));
    await flush();
    expect(props().querySelector(".pli-pdf-meta")!.textContent).toContain("Ana Reyes");
    expect(props().querySelector("time")!.getAttribute("datetime")).toBe(new Date(2026, 5, 1, 9, 30).toISOString());
    await click(button("Bring forward"));
    expect(annots(m.session).map((x) => x.id)).toEqual([b, a]);
    await click(button("Send backward"));
    expect(annots(m.session).map((x) => x.id)).toEqual([a, b]);
    await click(field("Locked"));
    expect(get(m, a!).locked).toBe(true);
    expect((button("Delete") as HTMLButtonElement).disabled).toBe(true);
    await click(field("Locked"));
    expect(get(m, a!).locked).toBeUndefined();
    await click(button("Duplicate"));
    expect(annots(m.session)).toHaveLength(3);
    await click(button("Delete"));
    expect(annots(m.session)).toHaveLength(2);
  });

  it("shows only what every selected annotation has, and Mixed where they differ", async () => {
    const m = await mount();
    const [a, b] = await run(() => [
      m.session.annots.add(P0, { type: "square", rect: { x: 100, y: 100, w: 50, h: 50 }, stroke: { color: "#000000", width: 2 }, opacity: 0.5 } as never, { select: false }),
      m.session.annots.add(P0, { type: "line", from: [100, 300], to: [200, 300], stroke: { color: "#ff0000", width: 4 } } as never, { select: false }),
    ]);
    await run(() => m.c().select([a!, b!]));
    await flush();
    expect(q(".pli-pdf-props-title", host).textContent).toBe("2 annotations");
    expect(q("output", props()).textContent).toBe("Mixed");
    expect((field("Line width") as HTMLInputElement).placeholder).toBe("Mixed");
    expect(document.querySelector("[aria-label='End of line']")).toBeNull();
    await click(byLabel("Colour #1e88e5", props()));
    expect(get(m, a!).stroke.color).toBe("#1e88e5");
    expect(get(m, b!).stroke.color).toBe("#1e88e5");
    await run(() => m.session.undo());
    expect(get(m, a!).stroke.color).toBe("#000000");
    expect(get(m, b!).stroke.color).toBe("#ff0000");
  });

  it("asks nothing of a person with nothing selected but a hint", async () => {
    await mount();
    // The panel is closed with nothing to show; the button opens it on a hint and a count
    expect(document.querySelector(".pli-pdf-right")).toBeNull();
    await openProperties();
    expect(props().textContent).toContain("Select an annotation");
    expect(props().textContent).toContain("No annotations");
  });

  it("is about the tool when a drawing tool is active, with a switch to keep the tool on", async () => {
    const m = await mount();
    await tool("Highlight");
    // A drawing tool does not open the panel by itself, so it does not cover the page being drawn on
    expect(document.querySelector(".pli-pdf-right")).toBeNull();
    await openProperties();
    expect(q(".pli-pdf-props-title", host).textContent).toBe("Highlight tool");
    expect(document.querySelector("[aria-label='Line width']")).toBeNull();
    await click(byLabel("Colour #ff7aa2", props()));
    expect(m.c().style("highlight").color).toBe("#ff7aa2");
    await tool("Pen");
    expect(q(".pli-pdf-props-title", host).textContent).toBe("Pen tool");
    expect(field("Line width")).toBeTruthy();
    expect((field("Keep this tool selected") as HTMLInputElement).checked).toBe(true);
  });
});

describe("compact bar over a selection", () => {
  it("changes the colour, comments, duplicates and deletes without the panel", async () => {
    const m = await select({ type: "square", rect: { x: 100, y: 100, w: 100, h: 60 }, stroke }, { kit: { properties: false } });
    const bar = q("[role=toolbar][aria-label='Rectangle actions']", host);
    expect(document.querySelector(".pli-pdf-props")).toBeNull();
    await click(byLabel("#7cdc5b", bar));
    expect(get(m, m.id).stroke.color).toBe("#7cdc5b");
    await click(byLabel("Duplicate", q("[aria-label='Rectangle actions']", host)));
    expect(annots(m.session)).toHaveLength(2);
    await click(byLabel("Delete", q("[aria-label='Rectangle actions']", host)));
    expect(annots(m.session)).toHaveLength(1);
  });

  it("goes away while something is dragged, and can be turned off", async () => {
    await select({ type: "square", rect: { x: 100, y: 100, w: 100, h: 60 }, stroke }, { kit: { popover: false } });
    expect(document.querySelector("[aria-label='Rectangle actions']")).toBeNull();
  });
});

describe("AnnotatedPdf", () => {
  it("is the viewer with the tools: a ribbon, the Comments and Annotations tabs and the properties panel, plus whatever the host adds", async () => {
    const session = testSession({ pages: 2 });
    const ref = createRef<PliPdfHandle>();
    const changes: (string | null)[] = [];
    await render(
      <AnnotatedPdf
        ref={ref}
        session={session}
        renderer={fakeRenderer({ pages: 2 })}
        viewport={viewport}
        defaultZoom={1}
        user={{ id: "u1", name: "Ana Reyes" }}
        onToolChange={(id) => changes.push(id)}
        sidebar={[{ id: "mine", label: "Mine", render: () => <p>mine</p> }]}
        annotations={{ storageKey: "" }}
      />,
    );
    await flush();
    expect(q("[aria-label='Annotation tools']", host).getAttribute("role")).toBe("toolbar");
    expect(qa("[role=tab]", host).map((t) => t.id)).toEqual(["pli-pdf-tab-thumbnails", "pli-pdf-tab-outline", "pli-pdf-tab-comments", "pli-pdf-tab-annotations", "pli-pdf-tab-mine"]);
    expect(document.querySelector(".pli-pdf-right")).toBeNull();
    await openProperties();
    expect(props()).toBeTruthy();
    await click(byLabel("Pen", host));
    expect(changes).toEqual(["ink"]);
    await key(scroller(), "Escape");
    expect(changes).toEqual(["ink", null]);
    await run(() => ref.current!.goToPage(1));
    expect(session.selection.page).toBe("p:main:1");
    // annotations made through it carry the user
    await click(byLabel("Text box", host));
    await tap([100, 100]);
    expect(q("textarea.pli-pdf-text-editor")).toBeTruthy();
  });

  it("is the plain viewer's props when read-only: no ribbon, no panel, the tabs stay", async () => {
    await render(<AnnotatedPdf session={testSession({ pages: 1 })} renderer={fakeRenderer({ pages: 1 })} viewport={viewport} readOnly />);
    await flush();
    expect(document.querySelector(".pli-pdf-ribbon button")).toBeNull();
    expect(document.querySelector(".pli-pdf-props")).toBeNull();
    expect(q("#pli-pdf-tab-comments")).toBeTruthy();
    expect(PliPdf).toBeTruthy();
  });
});

describe("keyboard table", () => {
  it("lists every tool key and the editing keys, and is registered with the viewer's shortcut registry", () => {
    const rows = shortcutTable();
    for (const k of ["V", "H", "U", "S", "W", "P", "E", "R", "O", "L", "A", "Y", "G", "T", "N", "M", "F", "I", "K", "X"]) expect(rows.some((r) => r.keys === k), k).toBe(true);
    expect(rows.some((r) => /Delete/.test(r.keys))).toBe(true);
    expect(rows.some((r) => /Arrow/.test(r.keys))).toBe(true);
    expect(new Set(rows.filter((r) => r.keys.length === 1).map((r) => r.keys)).size).toBe(20);
    expect(shortcutGroups().find((g) => g.group === "Annotations")!.rows.length).toBe(rows.length);
  });
});

const button = (label: string, within: ParentNode = props()) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === label)!;
