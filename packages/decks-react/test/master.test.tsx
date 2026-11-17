// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { builtinTheme, type ShapeElement } from "@pli.dev/decks";
import { PliDeck } from "../src";
import { writeSelection } from "../src/domsel";
import { blur, byLabel, click, key, menuItem, newSession, pointer, q, qa, render, run, setValue, useHost } from "./harness";

useHost();

const openMenu = (name: string) => click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name));
const choose = (name: string, ...path: string[]) => {
  openMenu(name);
  for (const label of path) click(menuItem(label));
};
const pickSlide = (i: number) => {
  pointer(qa(".pli-deck-film-item")[i]!, "pointerdown", 5, 5);
  pointer(window, "pointerup");
};
const banner = () => host().querySelector(".pli-deck-theme-banner");
const host = () => document.body;
const activeTemplate = () => qa(".pli-deck-template-item[aria-current='true']")[0]?.querySelector(":scope > span")?.textContent ?? "";
const ph = (els: readonly { type: string; placeholder?: { type: string } }[], ...types: string[]) => els.find((e) => e.type === "shape" && e.placeholder && types.includes(e.placeholder.type)) as ShapeElement;
const sceneRun = (s: ReturnType<typeof newSession>, slide: number, ...types: string[]) => s.scene(s.deck.slides[slide]!.id).elements.find((e) => e.placeholder && types.includes(e.placeholder.type))!.text!.paragraphs[0]!.runs[0]!;

describe("opening and closing the master view", () => {
  it("has a Master button in the toolbar that opens the view and closes it again at the slide it came from", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    const button = byLabel("Master");
    expect(button).toBeTruthy();
    expect(button.textContent).toContain("Master");
    click(button);
    expect(banner()!.textContent).toContain("Editing master");
    expect(banner()!.textContent).toContain("changes apply to every slide that uses it");
    expect(document.querySelector(".pli-deck-filmstrip")).toBeNull();
    // it opens on the layout of the slide it came from
    expect(activeTemplate()).toBe(s.layout(s.deck.slides[1]!.layout).layout.name);
    expect(byLabel("Master").getAttribute("aria-pressed")).toBe("true");
    click(byLabel("Close master view"));
    expect(banner()).toBeNull();
    expect(s.selection.slide).toBe(s.deck.slides[1]!.id);
    expect(qa(".pli-deck-film-item")[1]!.getAttribute("aria-current")).toBe("true");
  });

  it("closes with Escape, and with the Master button, at the same slide", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(2);
    click(byLabel("Master"));
    expect(banner()).toBeTruthy();
    key(q(".pli-deck-root"), "Escape");
    expect(banner()).toBeNull();
    expect(s.selection.slide).toBe(s.deck.slides[2]!.id);
    click(byLabel("Master"));
    click(byLabel("Master"));
    expect(banner()).toBeNull();
    expect(s.selection.slide).toBe(s.deck.slides[2]!.id);
  });

  it("opens from View, Slide and the slide's context menu", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("View", "Edit master");
    expect(banner()).toBeTruthy();
    // the same menu item now closes it
    choose("View", "Close master view");
    expect(banner()).toBeNull();
    pickSlide(1);
    choose("Slide", "Edit master");
    expect(activeTemplate()).toBe(s.layout(s.deck.slides[1]!.layout).layout.name);
    click(byLabel("Close master view"));
    // right-click a slide in the filmstrip
    pointer(qa(".pli-deck-film-item")[2]!, "contextmenu", 5, 5);
    click(menuItem("Edit master / layout…"));
    expect(banner()).toBeTruthy();
    expect(activeTemplate()).toBe(s.layout(s.deck.slides[2]!.layout).layout.name);
    click(byLabel("Close master view"));
    expect(s.selection.slide).toBe(s.deck.slides[2]!.id);
  });

  it("is offered in the Theme panel as Edit master", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Theme"));
    click([...qa("button", q(".pli-deck-theme-panel"))].find((b) => b.textContent === "Edit master"));
    expect(banner()).toBeTruthy();
  });

  it("is not offered when read only", () => {
    render(<PliDeck session={newSession()} readOnly />);
    expect(document.querySelector('[aria-label="Master"]')).toBeNull();
    openMenu("View");
    expect(menuItem("Edit master").getAttribute("aria-disabled") === "true" || (menuItem("Edit master") as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds the five prompt levels to a master that came from a file, without touching slides", () => {
    const s = newSession();
    // a master whose body holds one empty line, as one read from a PowerPoint file does
    const m = s.deck.masters[0]!;
    run(() => s.updateElement(m.id, ph(m.elements, "body").id, (e) => (e.type === "shape" ? { ...e, text: { paragraphs: [{ runs: [] }] } } : e)));
    const slides = JSON.stringify(s.deck.slides);
    render(<PliDeck session={s} />);
    click(byLabel("Master"));
    expect(ph(s.deck.masters[0]!.elements, "body").text!.paragraphs.map((p) => p.level ?? 0)).toEqual([0, 1, 2, 3, 4]);
    expect(JSON.stringify(s.deck.slides)).toBe(slides);
  });
});

describe("formatting in the master view", () => {
  it("sets the master title's size and weight from the toolbar for every slide", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Master"));
    click(qa(".pli-deck-template-item").find((b) => b.textContent!.includes("(master)")));
    // the master title is at the top of the slide
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 50);
    pointer(window, "pointerup");
    expect(s.selection.elements).toEqual([ph(s.deck.masters[0]!.elements, "title").id]);
    const size = q<HTMLInputElement>('input[aria-label="Font size"]');
    setValue(size, "41");
    key(size, "Enter");
    click(byLabel("Bold"));
    expect(s.deck.masters[0]!.textStyles.title[0]!.marks).toMatchObject({ fontSize: 41, bold: true });
    expect(sceneRun(s, 1, "title")).toMatchObject({ fontSize: 41, bold: true });
    // the section-less sample deck: the title slide's layout sets its own size, but still takes the weight
    expect(sceneRun(s, 0, "ctrTitle").bold).toBe(true);
    run(() => s.undo());
    expect(sceneRun(s, 1, "title").bold).toBe(false);
  });

  it("styles a level of the master body from the text editor, and bullets, alignment and spacing too", () => {
    const s = newSession();
    // the sample slide's body gets a second-level paragraph
    const slide = s.deck.slides[1]!;
    run(() => s.setText(slide.id, ph(slide.elements, "body").id, [{ runs: [{ text: "One" }] }, { level: 1, runs: [{ text: "Two" }] }]));
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Master"));
    click(qa(".pli-deck-template-item").find((b) => b.textContent!.includes("(master)")));
    // edit the body: double-click it, put the caret in "Second level"
    pointer(q(".pli-deck-stage"), "dblclick", 100, 150);
    const body = q<HTMLElement>('[role="textbox"]');
    act(() => {
      writeSelection(body, { from: { p: 1, o: 3 }, to: { p: 1, o: 3 } });
      document.dispatchEvent(new Event("selectionchange"));
    });
    click(byLabel("Italic"));
    click(byLabel("Align center"));
    const m = s.deck.masters[0]!;
    expect(m.textStyles.body[1]).toMatchObject({ marks: { italic: true }, align: "center" });
    expect(m.textStyles.body[0]!.marks?.italic).toBeUndefined();
    const paras = s.scene(s.deck.slides[1]!.id).elements.find((e) => e.placeholder?.type === "body")!.text!.paragraphs;
    expect(paras[0]!.runs[0]!.italic).toBe(false);
    expect(paras[1]!.runs[0]!.italic).toBe(true);
    expect(paras[1]!.align).toBe("center");
    // the prompt text itself carries no formatting
    expect(ph(m.elements, "body").text!.paragraphs[1]!.runs[0]!.marks).toBeUndefined();
    click(byLabel("Numbered list"));
    expect(s.deck.masters[0]!.textStyles.body[1]!.bullet).toMatchObject({ type: "number" });
    expect(s.deck.masters[0]!.textStyles.body[0]!.bullet).toMatchObject({ type: "char" });
  });

  it("formats a layout's placeholder into the layout only", () => {
    const s = newSession();
    const third = s.deck.slides[2]!;
    run(() => s.setText(third.id, ph(third.elements, "title").id, [{ runs: [{ text: "Third" }] }]));
    render(<PliDeck session={s} />);
    pickSlide(1);
    click(byLabel("Master"));
    // layout of slide 2 is "Title and body": select its title and set a colour via Clear/bold
    pointer(q(".pli-deck-stage"), "pointerdown", 100, 50);
    pointer(window, "pointerup");
    click(byLabel("Italic"));
    const layout = s.layout(s.deck.slides[1]!.layout).layout;
    expect(ph(layout.elements, "title").text!.levels![0]!.marks).toMatchObject({ italic: true });
    expect(sceneRun(s, 1, "title").italic).toBe(true);
    expect(sceneRun(s, 2, "title").italic).toBe(false); // the third slide is on "Title only"
    expect(s.deck.masters[0]!.textStyles.title[0]!.marks?.italic).toBeUndefined();
  });
});

describe("masters in the master view", () => {
  it("lists every master in a switcher and shows the one you pick", () => {
    const s = newSession();
    run(() => s.addMaster(builtinTheme("simple-dark", s.deck.size)));
    render(<PliDeck session={s} />);
    click(byLabel("Master"));
    const select = byLabel("Choose master") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(s.deck.masters.map((m) => m.name));
    setValue(select, s.deck.masters[1]!.id);
    expect(activeTemplate()).toBe(`${s.deck.masters[1]!.name} (master)`);
    expect(qa(".pli-deck-template-row").length).toBe(s.deck.masters[1]!.layouts.length);
    expect(s.selection.slide).toBe(s.deck.masters[1]!.id);
    // the canvas shows the second master's background
    expect(s.scene(s.deck.masters[1]!.id).background).toMatchObject({ kind: "solid", color: "#1e1e1e" });
  });

  it("adds a master from a built-in theme or as a copy, renames it, and deletes it", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    click(byLabel("Master"));
    expect((byLabel("Delete master") as HTMLButtonElement).disabled).toBe(true);
    click(byLabel("Add master"));
    click(menuItem("Paperwhite"));
    expect(s.deck.masters.map((m) => m.name)).toEqual(["Simple Light", "Paperwhite"]);
    expect(activeTemplate()).toBe("Paperwhite (master)");
    click(byLabel("Add master"));
    click(menuItem("Duplicate this master"));
    expect(s.deck.masters.map((m) => m.name)).toEqual(["Simple Light", "Paperwhite", "Paperwhite copy"]);
    // rename the copy
    click(byLabel("Rename master"));
    const input = byLabel("Master name") as HTMLInputElement;
    setValue(input, "Corporate");
    key(input, "Enter");
    blur(input);
    expect(s.deck.masters[2]!.name).toBe("Corporate");
    // delete it: the switcher goes to a master that remains
    click(byLabel("Delete master"));
    expect(s.deck.masters.map((m) => m.name)).toEqual(["Simple Light", "Paperwhite"]);
    run(() => s.undo());
    expect(s.deck.masters).toHaveLength(3);
  });

  it("will not delete a master whose layouts slides use", () => {
    const s = newSession();
    run(() => s.addMaster(builtinTheme("simple-dark", s.deck.size)));
    render(<PliDeck session={s} />);
    click(byLabel("Master"));
    expect((byLabel("Delete master") as HTMLButtonElement).disabled).toBe(true);
    setValue(byLabel("Choose master") as HTMLSelectElement, s.deck.masters[1]!.id);
    expect((byLabel("Delete master") as HTMLButtonElement).disabled).toBe(false);
  });

  it("groups Change layout by master when there is more than one", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    openMenu("Slide");
    click(menuItem("Change layout"));
    expect(document.querySelectorAll(".pli-submenu .pli-menu-label").length).toBeGreaterThan(5);
    openMenu("Slide");
    run(() => s.addMaster(builtinTheme("simple-dark", s.deck.size)));
    openMenu("Slide");
    click(menuItem("Change layout"));
    click(menuItem("Simple Dark"));
    click(menuItem("Title only"));
    expect(s.layout(s.deck.slides[0]!.layout).master.name).toBe("Simple Dark");
    expect(s.scene(s.deck.slides[0]!.id).theme.name).toBe("Simple Dark");
  });
});

describe("layout tools in the master view", () => {
  const enter = () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    pickSlide(2); // Title only
    click(byLabel("Master"));
    return s;
  };

  it("duplicates a layout and moves it up and down", () => {
    const s = enter();
    const before = s.deck.masters[0]!.layouts.map((l) => l.name);
    const idx = before.indexOf("Title only");
    click(byLabel("Duplicate layout Title only"));
    expect(s.deck.masters[0]!.layouts.map((l) => l.name)[idx + 1]).toBe("Title only copy");
    expect(activeTemplate()).toBe("Title only copy");
    click(byLabel("Move layout Title only copy up"));
    expect(s.deck.masters[0]!.layouts.map((l) => l.name).slice(idx, idx + 2)).toEqual(["Title only copy", "Title only"]);
    click(byLabel("Move layout Title only copy down"));
    expect(s.deck.masters[0]!.layouts.map((l) => l.name).slice(idx, idx + 2)).toEqual(["Title only", "Title only copy"]);
    expect((byLabel(`Move layout ${before[0]} up`) as HTMLButtonElement).disabled).toBe(true);
  });

  it("changes a layout's type and whether it shows the master's shapes", () => {
    const s = enter();
    const id = s.deck.slides[2]!.layout;
    const check = byLabel("Show master shapes") as HTMLInputElement;
    expect(check.checked).toBe(true);
    click(check);
    expect(s.layout(id).layout.showMasterElements).toBe(false);
    click(byLabel("Show master shapes"));
    expect(s.layout(id).layout.showMasterElements).toBeUndefined();
    setValue(byLabel("Layout type") as HTMLSelectElement, "custom");
    expect(s.layout(id).layout.kind).toBe("custom");
  });

  it("inserts a placeholder from the toolbar and from the Insert menu, and selects it", () => {
    const s = enter();
    const id = s.deck.slides[2]!.layout;
    const before = s.layout(id).layout.elements.length;
    click(byLabel("Insert placeholder"));
    expect((menuItem("Title") as HTMLButtonElement).disabled).toBe(true); // the layout has one
    click(menuItem("Picture"));
    const added = s.layout(id).layout.elements;
    expect(added).toHaveLength(before + 1);
    expect(added.at(-1)).toMatchObject({ placeholder: { type: "pic" } });
    expect(s.selection.elements).toEqual([added.at(-1)!.id]);
    choose("Insert", "Placeholder", "Body text");
    expect(s.layout(id).layout.elements.at(-1)).toMatchObject({ placeholder: { type: "body" } });
    expect(qa(".pli-deck-canvas-slide [data-from=layout]").length).toBe(before + 2);
  });

  it("does not offer placeholders on the slides", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    expect(document.querySelector('[aria-label="Insert placeholder"]')).toBeNull();
    openMenu("Insert");
    const item = menuItem("Placeholder");
    expect(item.getAttribute("aria-disabled") === "true" || (item as HTMLButtonElement).disabled).toBe(true);
    void s;
  });
});
