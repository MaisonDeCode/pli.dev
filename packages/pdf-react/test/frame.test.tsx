// @vitest-environment jsdom
// The frame of the editor: the sidebar on the left, the pages, and the properties panel on the right. jsdom computes no layout, so
// these tests check structure and state (what is in the DOM, in which order, with which attributes, what each key and click does);
// styles.test.ts checks the style sheet, and the real-browser checks are on the roadmap page.
import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { PdfEditor, PliPdf, setSelection, type PliPdfHandle } from "../src";
import { fakeRenderer, testSession } from "../src/testing";
import { shellOf } from "../src/shell";
import { chooseEdit, centre, editPdf, mountEditor, runOf, tap, useEditHost } from "./editHarness";
import { drag, fixture, toolButton } from "./formsHarness";
import { byLabel, click, fire, flush, key, q, qa, render, run, togglePrepareForm } from "./harness";

useEditHost();

const P0 = "p:main:0";
const viewport = { width: 800, height: 600 };
const stroke = { color: "#000000", width: 2 };
const rect = (n: number) => ({ type: "square", rect: { x: 100 + n * 10, y: 100 + n * 10, w: 100, h: 60 }, stroke }) as never;
type Session = ReturnType<typeof testSession>;

async function mount(o: { hostWidth?: number; session?: Session; props?: Record<string, unknown> } = {}) {
  const session = o.session ?? testSession({ pages: 2 });
  await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={viewport} hostWidth={o.hostWidth} defaultZoom={1} annotations={{ storageKey: "" }} topToolbar {...o.props} />); // topToolbar: these tests press the toolbar's Properties and Sidebar buttons (the menus and the keys are in statusbar.test.tsx)
  await flush();
  return session;
}

const panel = () => document.querySelector<HTMLElement>(".pli-pdf-right");
const sidebar = () => document.querySelector<HTMLElement>(".pli-pdf-sidebar");
const toggle = () => q(".pli-pdf-props-toggle");
const scrimOf = (what: "panel" | "sidebar") => document.querySelector<HTMLElement>(`.pli-pdf-scrim[data-for="${what}"]`);
const addRect = (session: Session, n = 0) => run(() => session.annots.add(P0, rect(n)));
const deselect = (session: Session) => run(() => setSelection(session, { annots: [] }));
const keyed = (target: EventTarget, init: KeyboardEventInit) => fire(target, new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
const remount = async (session: Session, o: Parameters<typeof mount>[0] = {}) => {
  await render(<div />);
  await mount({ ...o, session });
};

describe("the properties panel opens only when it has something to show", () => {
  it("is not there with nothing selected, and the sidebar is", async () => {
    await mount();
    expect(panel()).toBeNull();
    expect(sidebar()).not.toBeNull();
    expect(q(".pli-pdf").hasAttribute("data-panel")).toBe(false);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
  });

  it("is a sibling after the page area in the body, never inside or over the sidebar", async () => {
    const session = await mount();
    await addRect(session);
    const body = q(".pli-pdf-body");
    const kids = [...body.children].map((c) => c.className.split(" ")[0]);
    expect(kids).toEqual(["pli-pdf-sidebar", "pli-pdf-main", "pli-pdf-right"]);
    const main = q(".pli-pdf-main");
    expect(panel()!.previousElementSibling).toBe(main);
    expect(sidebar()!.contains(panel())).toBe(false);
    expect(main.contains(panel())).toBe(false);
    expect(panel()!.parentElement).toBe(body);
    // docked: not a dialog, no backdrop, and it is named
    expect(panel()!.getAttribute("role")).toBeNull();
    expect(panel()!.getAttribute("aria-label")).toBe("Properties panel");
    expect(panel()!.hasAttribute("data-overlay")).toBe(false);
    expect(scrimOf("panel")).toBeNull();
    expect(q(".pli-pdf").hasAttribute("data-panel")).toBe(true);
  });

  it("opens when an annotation is selected and closes when nothing is selected, and the sidebar's tabs work with it open", async () => {
    const session = await mount();
    await addRect(session);
    expect(panel()).not.toBeNull();
    expect(q(".pli-pdf-props-title", panel()!).textContent).toBe("Rectangle");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    await deselect(session);
    expect(panel()).toBeNull();
    await addRect(session, 1);
    expect(panel()).not.toBeNull();
    const tabs = qa("[role=tab]", sidebar()!);
    expect(tabs.map((t) => t.id)).toEqual(["pli-pdf-tab-thumbnails", "pli-pdf-tab-outline", "pli-pdf-tab-comments", "pli-pdf-tab-annotations", "pli-pdf-tab-edits"]);
    await click(q("#pli-pdf-tab-outline"));
    expect(q("#pli-pdf-tab-outline").getAttribute("aria-selected")).toBe("true");
    await click(q("#pli-pdf-tab-annotations"));
    expect(q("#pli-pdf-tab-annotations").getAttribute("aria-selected")).toBe("true");
    expect(q("#pli-pdf-sidebar-panel").textContent).toContain("Rectangle");
    expect(panel()).not.toBeNull();
  });

  it("is not opened by a drawing tool: the page stays clear until the Properties button is pressed, and then shows the tool's style", async () => {
    await mount();
    await click(byLabel("Pen"));
    expect(panel()).toBeNull();
    await click(toggle());
    expect(q(".pli-pdf-props-title", panel()!).textContent).toBe("Pen tool");
  });

  it("opens for a form field in Prepare form, and not for the form with nothing selected", async () => {
    await mountEditor(fixture("forms-basic"));
    await togglePrepareForm();
    expect(panel()).toBeNull();
    await click(toolButton("Text field"));
    await drag([212, 152], [288, 176]);
    expect(panel()).not.toBeNull();
    expect(q(".pli-form-props", panel()!)).not.toBeNull();
    // Done puts Prepare form away: nothing of it is left to show
    await click([...qa("button", q(".pli-pdf-designbar"))].find((b) => b.textContent === "Done"));
    expect(panel()).toBeNull();
  });

  it("opens for a text or picture edit, and not for the tool with nothing selected", async () => {
    const { session } = await mountEditor(editPdf());
    await chooseEdit();
    expect(panel()).toBeNull();
    const r = await runOf(session, "Quarterly report");
    await tap(centre(r.box));
    await flush();
    expect(panel()).not.toBeNull();
    expect(q(".pli-edit-props", panel()!)).not.toBeNull();
  });

  it("has a close button; closed while something is selected it stays closed until something else is selected", async () => {
    const session = await mount();
    await addRect(session);
    const close = byLabel("Close properties", panel()!);
    expect(close.tagName).toBe("BUTTON");
    await click(close);
    expect(panel()).toBeNull();
    expect(toggle().getAttribute("aria-pressed")).toBe("false");
    // a change to the selected annotation does not bring it back
    await run(() => session.annots.update(session.selection.annots[0]!, { opacity: 0.5 } as never));
    expect(panel()).toBeNull();
    // a new selection does
    await addRect(session, 1);
    expect(panel()).not.toBeNull();
    // ... and so does selecting the same thing again after nothing was selected
    await click(byLabel("Close properties", panel()!));
    await deselect(session);
    await run(() => setSelection(session, { annots: [session.doc.pages[0]!.annots[1]!.id] }));
    expect(panel()).not.toBeNull();
  });

  it("closes with Escape while focus is inside it, and not with Escape elsewhere", async () => {
    const session = await mount();
    await addRect(session);
    const inside = byLabel("Close properties", panel()!);
    inside.focus();
    await key(inside, "Escape");
    expect(panel()).toBeNull();
    // a docked panel that was opened by hand is left alone by Escape outside it
    await click(toggle());
    expect(panel()).not.toBeNull();
    await key(q(".pli-pdf-toolbar button"), "Escape");
    expect(panel()).not.toBeNull();
    await key(q(".pli-pdf-scroller"), "Escape");
    expect(panel()).not.toBeNull();
    expect(session.selection.annots).toHaveLength(0);
  });

  it("opens by hand with the Properties button on a useful empty state, and stays open until it is closed", async () => {
    const session = await mount();
    await addRect(session);
    await deselect(session);
    expect(panel()).toBeNull();
    await click(toggle());
    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toContain("Nothing selected");
    expect(panel()!.textContent).toContain("1 annotation in this document.");
    // selecting and deselecting leaves it open: it was opened on purpose
    await addRect(session, 1);
    await deselect(session);
    expect(panel()).not.toBeNull();
    await click(toggle());
    expect(panel()).toBeNull();
    // the layout menu has the same switch
    await click(q(".pli-pdf-toolbar [aria-label='Page layout']"));
    const item = [...document.querySelectorAll<HTMLElement>("[role=menu] [role^=menuitem]")].find((i) => i.textContent === "Properties panel")!;
    expect(item).toBeTruthy();
    await click(item);
    expect(panel()).not.toBeNull();
  });

  it("is toggled by Alt+Shift+P (and the sidebar by Alt+Shift+S), by the physical key, but not while typing in a field", async () => {
    await mount();
    const root = q(".pli-pdf-scroller");
    await keyed(root, { key: "π", code: "KeyP", altKey: true, shiftKey: true });
    expect(panel()).not.toBeNull();
    await keyed(root, { key: "π", code: "KeyP", altKey: true, shiftKey: true });
    expect(panel()).toBeNull();
    const page = q<HTMLInputElement>("input[aria-label='Page number']");
    await keyed(page, { key: "P", code: "KeyP", altKey: true, shiftKey: true });
    expect(panel()).toBeNull();
    expect(sidebar()).not.toBeNull();
    await keyed(root, { key: "S", code: "KeyS", altKey: true, shiftKey: true });
    expect(sidebar()).toBeNull();
    await keyed(root, { key: "S", code: "KeyS", altKey: true, shiftKey: true });
    expect(sidebar()).not.toBeNull();
  });

  it("remembers what the person chose for the session: closed stays closed, opened stays open, across a mount", async () => {
    const session = await mount();
    await addRect(session);
    await click(byLabel("Close properties", panel()!));
    expect(panel()).toBeNull();
    await remount(session);
    // the same selection, the same closed panel
    expect(panel()).toBeNull();
    await click(toggle());
    await remount(session);
    expect(panel()).not.toBeNull();
    // another document starts on what the browser remembers (opened by hand: open)
    await remount(testSession({ pages: 2 }));
    expect(panel()).not.toBeNull();
  });

  it("works when the browser's storage is unavailable", async () => {
    const real = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      const session = await mount();
      await addRect(session);
      expect(panel()).not.toBeNull();
      await click(byLabel("Close properties", panel()!));
      expect(panel()).toBeNull();
      await click(byLabel("Sidebar"));
      expect(sidebar()).toBeNull();
    } finally {
      Object.defineProperty(window, "localStorage", real);
    }
  });

  it("is not offered at all in a read-only viewer", async () => {
    await mount({ props: { readOnly: true } });
    expect(document.querySelector(".pli-pdf-props-toggle")).toBeNull();
    expect(panel()).toBeNull();
  });

  it("a host's own right panel starts open (it always has something to show), can be closed, and the button and the handle bring it back", async () => {
    const ref = createRef<PliPdfHandle>();
    const session = testSession({ pages: 1 });
    await render(<PliPdf ref={ref} session={session} renderer={fakeRenderer({ pages: 1 })} viewport={viewport} rightPanel={() => <p data-testid="mine">mine</p>} />);
    await flush();
    expect(q("[data-testid=mine]", panel()!)).not.toBeNull();
    await click(byLabel("Close properties"));
    expect(panel()).toBeNull();
    await click(toggle());
    expect(panel()).not.toBeNull();
    await run(() => ref.current!.toggleProperties(false));
    expect(panel()).toBeNull();
    await run(() => ref.current!.toggleProperties(true));
    expect(panel()).not.toBeNull();
    await run(() => ref.current!.toggleSidebar(false));
    expect(sidebar()).toBeNull();
  });

  it("follows `rightPanelKey` for a host's panel: it opens when the key appears and a dot marks the button while it waits", async () => {
    const session = testSession({ pages: 1 });
    const view = (k: string | null) => <PliPdf session={session} renderer={fakeRenderer({ pages: 1 })} viewport={viewport} rightPanel={<p>mine</p>} rightPanelKey={k} />;
    await render(view(null));
    await flush();
    expect(panel()).toBeNull();
    await render(view("a"));
    expect(panel()).not.toBeNull();
    await click(byLabel("Close properties"));
    await render(view("a"));
    expect(panel()).toBeNull();
    expect(toggle().hasAttribute("data-hint")).toBe(true);
    await render(view("b"));
    expect(panel()).not.toBeNull();
    expect(toggle().hasAttribute("data-hint")).toBe(false);
  });
});

describe("narrow viewer: the properties panel is a sheet over the page", () => {
  it("does not open by itself, opens from the button as a dialog with a backdrop, and the backdrop, Escape and the close button dismiss it", async () => {
    const session = await mount({ hostWidth: 700 });
    expect(q(".pli-pdf").getAttribute("data-size")).toBe("narrow");
    await addRect(session);
    expect(panel()).toBeNull(); // selected, but a sheet that opens by itself would be in the way
    expect(toggle().hasAttribute("data-hint")).toBe(true);
    await click(toggle());
    expect(panel()!.getAttribute("role")).toBe("dialog");
    expect(panel()!.getAttribute("data-overlay")).toBe("narrow");
    expect(scrimOf("panel")).not.toBeNull();
    expect(document.activeElement).toBe(byLabel("Close properties", panel()!));
    // the docked sidebar stays put and reachable
    expect(sidebar()).not.toBeNull();
    expect(sidebar()!.contains(panel())).toBe(false);
    await click(scrimOf("panel"));
    expect(panel()).toBeNull();
    expect(scrimOf("panel")).toBeNull();
    await click(toggle());
    await deselect(session); // (with something selected the page's Escape lets go of it first)
    await key(q(".pli-pdf-scroller"), "Escape"); // from outside the panel too: it is modal-like here
    expect(panel()).toBeNull();
    await click(toggle());
    await click(byLabel("Close properties", panel()!));
    expect(panel()).toBeNull();
    // the sidebar's tabs work while the sheet is open
    await click(toggle());
    await click(q("#pli-pdf-tab-outline"));
    expect(q("#pli-pdf-tab-outline").getAttribute("aria-selected")).toBe("true");
  });

  it("is a bottom sheet on a phone, where the sidebar is a drawer that starts closed, and the two are never open together", async () => {
    await mount({ hostWidth: 400 });
    expect(q(".pli-pdf").getAttribute("data-size")).toBe("phone");
    expect(sidebar()).toBeNull();
    expect(byLabel("Sidebar").getAttribute("aria-pressed")).toBe("false");
    await click(byLabel("Sidebar"));
    expect(sidebar()).not.toBeNull();
    expect(scrimOf("sidebar")).not.toBeNull();
    expect(document.querySelector(".pli-pdf-resize")).toBeNull(); // a drawer has a width of its own
    await click(toggle());
    expect(panel()!.getAttribute("data-overlay")).toBe("phone");
    expect(sidebar()).toBeNull(); // one sheet at a time
    await click(byLabel("Sidebar"));
    expect(sidebar()).not.toBeNull();
    expect(panel()).toBeNull();
    // the backdrop and Escape close the drawer
    await click(scrimOf("sidebar"));
    expect(sidebar()).toBeNull();
    await click(byLabel("Sidebar"));
    await key(q(".pli-pdf-scroller"), "Escape");
    expect(sidebar()).toBeNull();
    // and the button is always there
    expect(byLabel("Sidebar")).not.toBeNull();
  });

  it("does not take the phone drawer's closed state to the next wide viewer", async () => {
    await mount({ hostWidth: 400 });
    await click(byLabel("Sidebar"));
    await render(<div />);
    await mount({ hostWidth: 1280, session: testSession({ pages: 2 }) });
    expect(sidebar()).not.toBeNull();
  });

  it("tells wide, narrow and phone apart by the width of the viewer, whatever the window", async () => {
    for (const [w, size] of [[1280, "wide"], [900, "wide"], [899, "narrow"], [640, "narrow"], [639, "phone"], [375, "phone"]] as const) {
      await mount({ hostWidth: w });
      expect(q(".pli-pdf").getAttribute("data-size"), String(w)).toBe(size);
      await render(<div />);
    }
  });
});

describe("the sidebar", () => {
  it("collapses and expands from its button and the keyboard, and keeps the choice for the session", async () => {
    const session = await mount();
    expect(byLabel("Sidebar").getAttribute("aria-pressed")).toBe("true");
    await click(byLabel("Sidebar"));
    expect(sidebar()).toBeNull();
    expect(byLabel("Sidebar").getAttribute("aria-pressed")).toBe("false");
    // the page area took the room: it is the first child of the body
    expect(q(".pli-pdf-body").firstElementChild!.className).toContain("pli-pdf-main");
    await remount(session);
    expect(sidebar()).toBeNull();
    await click(byLabel("Sidebar"));
    expect(sidebar()).not.toBeNull();
  });

  it("keeps the tab chosen for the session", async () => {
    const session = await mount();
    await click(q("#pli-pdf-tab-outline"));
    await remount(session);
    expect(q("#pli-pdf-tab-outline").getAttribute("aria-selected")).toBe("true");
  });

  it("can be started closed with defaultSidebar={null} and on a tab with defaultSidebar", async () => {
    await mount({ props: { defaultSidebar: null } });
    expect(sidebar()).toBeNull();
    await render(<div />);
    await mount({ props: { defaultSidebar: "outline" } });
    expect(q("#pli-pdf-tab-outline").getAttribute("aria-selected")).toBe("true");
  });

  it("has its tabs in a strip of their own (a crowd of them scrolls, it does not clip), each with its name, and its body is a scrolling area", async () => {
    await mount({ props: { sidebar: [{ id: "mine", label: "Mine", render: () => <p>mine</p> }] } });
    const strip = q(".pli-pdf-tabs", sidebar()!);
    expect(strip.getAttribute("role")).toBe("tablist");
    expect(qa("[role=tab]", strip)).toHaveLength(6);
    for (const t of qa("[role=tab]", strip)) expect(t.getAttribute("aria-label"), t.id).toBeTruthy();
    expect(q("#pli-pdf-sidebar-panel", sidebar()!)).not.toBeNull();
    await click(q("#pli-pdf-tab-mine"));
    expect(q("#pli-pdf-sidebar-panel").textContent).toBe("mine");
    await keyed(q("#pli-pdf-tab-mine"), { key: "ArrowLeft" });
    expect(q("#pli-pdf-tab-edits").getAttribute("aria-selected")).toBe("true");
  });
});

describe("resizing the sidebar", () => {
  const sep = () => q<HTMLElement>(".pli-pdf-sidebar [role=separator]");
  const now = () => Number(sep().getAttribute("aria-valuenow"));
  const mouse = (type: string, x: number) => fire(sep(), new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: 0, buttons: type === "pointerup" ? 0 : 1 }));

  it("is a separator you can focus, with its limits, inside the sidebar", async () => {
    await mount();
    expect(sep().getAttribute("aria-orientation")).toBe("vertical");
    expect(sep().getAttribute("aria-label")).toBe("Resize sidebar");
    expect(sep().tabIndex).toBe(0);
    expect([now(), Number(sep().getAttribute("aria-valuemin")), Number(sep().getAttribute("aria-valuemax"))]).toEqual([240, 200, 400]);
    expect(sidebar()!.contains(sep())).toBe(true);
  });

  it("follows a drag, stays between the limits, and puts its width in the sidebar's style", async () => {
    await mount();
    await mouse("pointerdown", 240);
    await mouse("pointermove", 300);
    expect(now()).toBe(300);
    expect(sidebar()!.style.getPropertyValue("--pli-pdf-sidebar-w")).toBe("300px");
    await mouse("pointermove", 900);
    expect(now()).toBe(400);
    await mouse("pointermove", -500);
    expect(now()).toBe(200);
    await mouse("pointerup", 200);
    // moves after the drag do nothing
    await mouse("pointermove", 350);
    expect(now()).toBe(200);
  });

  it("takes no more than 40% of a small viewer", async () => {
    await mount({ hostWidth: 700 });
    expect(Number(sep().getAttribute("aria-valuemax"))).toBe(280);
    await mouse("pointerdown", 240);
    await mouse("pointermove", 500);
    expect(now()).toBe(280);
  });

  it("moves with the arrow keys (Shift: four steps), Home and End, and the arrows do not turn the page", async () => {
    const session = await mount({ props: { defaultViewMode: "single" } });
    const before = session.selection.page;
    await keyed(sep(), { key: "ArrowRight" });
    expect(now()).toBe(256);
    await keyed(sep(), { key: "ArrowLeft", shiftKey: true });
    expect(now()).toBe(200);
    await keyed(sep(), { key: "End" });
    expect(now()).toBe(400);
    await keyed(sep(), { key: "ArrowRight" });
    expect(now()).toBe(400);
    await keyed(sep(), { key: "Home" });
    expect(now()).toBe(200);
    expect(session.selection.page).toBe(before);
  });

  it("goes back to the usual width on a double click, and the width is the session's", async () => {
    const session = await mount();
    await keyed(sep(), { key: "ArrowRight", shiftKey: true });
    expect(now()).toBe(304);
    await remount(session);
    expect(now()).toBe(304);
    await fire(sep(), new MouseEvent("dblclick", { bubbles: true }));
    expect(now()).toBe(240);
  });

  it("starts the next document at the width the last one ended on", async () => {
    await mount();
    await keyed(sep(), { key: "ArrowRight", shiftKey: true });
    await remount(testSession({ pages: 2 }));
    expect(now()).toBe(304);
  });
});

describe("shell state", () => {
  it("is kept per session", () => {
    const a = testSession({ pages: 1 });
    expect(shellOf(a)).toBe(shellOf(a));
    expect(shellOf(a)).not.toBe(shellOf(testSession({ pages: 1 })));
  });

  it("opens by itself only in a wide viewer, stays closed for what it was closed for, and opens when asked", () => {
    const s = shellOf(testSession({ pages: 1 }));
    expect(s.panelOpen(null, "wide")).toBe(false);
    expect(s.panelOpen("a", "wide")).toBe(true);
    expect(s.panelOpen("a", "narrow")).toBe(false);
    s.closePanel("a");
    expect(s.panelOpen("a", "wide")).toBe(false);
    expect(s.panelOpen("b", "wide")).toBe(true);
    s.forgetClosed();
    expect(s.panelOpen("a", "wide")).toBe(true);
    s.openPanel();
    expect(s.panelOpen(null, "narrow")).toBe(true);
  });
});
