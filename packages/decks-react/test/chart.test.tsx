// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CHART_TYPES, type ChartElement } from "@pli.dev/decks";
import { PliDeck, SlideView } from "../src";
import { byLabel, click, host, newSession, pointer, q, qa, render, run, setValue, useHost } from "./harness";

useHost();

const openMenu = (name: string) => click([...document.querySelectorAll<HTMLElement>(".pli-menubar-button")].find((b) => b.textContent === name));
/** The last menu item with this label: a submenu opens after its parent, and "Line" is also an item of Insert. */
const item = (label: string) => [...document.querySelectorAll<HTMLElement>("[role^='menuitem']")].filter((b) => b.querySelector(".pli-menu-label")?.textContent === label).pop();
const choose = (name: string, ...path: string[]) => {
  openMenu(name);
  for (const label of path) click(item(label));
};
const button = (text: string) => [...document.querySelectorAll<HTMLElement>("dialog button")].find((b) => b.textContent?.trim() === text);
const charts = (s: ReturnType<typeof newSession>) => s.deck.slides[0]!.elements.filter((e): e is ChartElement => e.type === "chart");
const apply = () => click([...document.querySelectorAll<HTMLElement>("dialog button")].find((b) => b.textContent === "Apply"));
const labels = { column: "Column", bar: "Bar", line: "Line", area: "Area", pie: "Pie", doughnut: "Doughnut", scatter: "Scatter" } as const;

describe("charts in the editor", () => {
  it("inserts each chart kind from Insert > Chart at the centre of the slide, selected, and draws it", () => {
    for (const type of CHART_TYPES) {
      const s = newSession();
      render(<PliDeck session={s} />);
      choose("Insert", "Chart", labels[type]);
      const [c] = charts(s);
      expect(c, type).toMatchObject({ chartType: type });
      expect(c!.x! + c!.w! / 2).toBeCloseTo(s.deck.size.width / 2, 3);
      expect(c!.y! + c!.h! / 2).toBeCloseTo(s.deck.size.height / 2, 3);
      expect(s.selection.elements).toEqual([c!.id]);
      const el = q(`[data-element="${c!.id}"]`);
      expect(el.dataset.kind).toBe("chart");
      expect(el.querySelector("svg[role=img]")).toBeTruthy();
      expect(el.querySelectorAll("[data-part=bar], [data-part=slice], [data-part=marker], [data-part=area], [data-part=line]").length, type).toBeGreaterThan(0);
      // one undo removes it
      run(() => s.undo());
      expect(charts(s)).toHaveLength(0);
    }
  });

  it("uses the theme's accent colours for the sample series", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("Insert", "Chart", "Column");
    const bars = qa("[data-part=bar]");
    const accents = s.deck.masters[0]!.theme.colors;
    expect(bars.map((b) => b.getAttribute("fill"))).toEqual(expect.arrayContaining([accents.accent1, accents.accent2]));
  });

  it("opens the data dialog on a double click, edits the table and settings, and applies them as one undoable change", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("Insert", "Chart", "Column");
    const c = charts(s)[0]!;
    pointer(q(".pli-deck-stage"), "dblclick", c.x! + c.w! / 2, c.y! + c.h! / 2);
    expect(document.querySelector("dialog[open]")).toBeTruthy();
    expect((byLabel("Series 1 value 2") as HTMLInputElement).value).toBe("19");
    setValue(byLabel("Series 1 value 2") as HTMLInputElement, "30");
    setValue(byLabel("Category 1") as HTMLInputElement, "North");
    setValue(byLabel("Series 2 name") as HTMLInputElement, "Costs");
    setValue(byLabel("Chart title") as HTMLInputElement, "Sales");
    setValue(byLabel("Stacking") as HTMLSelectElement, "stacked");
    setValue(byLabel("Legend position") as HTMLSelectElement, "right");
    click(byLabel("Show data labels"));
    click(button("Add row"));
    setValue(byLabel("Category 4") as HTMLInputElement, "West");
    setValue(byLabel("Series 1 value 4") as HTMLInputElement, "7");
    click(button("Add series"));
    setValue(byLabel("Series 3 name") as HTMLInputElement, "Third");
    setValue(byLabel("Series 3 value 1") as HTMLInputElement, "2");
    setValue(byLabel("Series 2 drawn as") as HTMLSelectElement, "line");
    // nothing changed until Apply
    expect(charts(s)[0]!.title).toBeUndefined();
    apply();
    const next = charts(s)[0]!;
    expect(next).toMatchObject({ title: "Sales", grouping: "stacked", legend: "right", dataLabels: { value: true } });
    expect(next.categories).toEqual(["North", "Category B", "Category C", "West"]);
    expect(next.series.map((x) => x.name)).toEqual(["Series 1", "Costs", "Third"]);
    expect(next.series[0]!.values).toEqual([12, 30, 8, 7]);
    expect(next.series[2]!.values).toEqual([2, null, null, null]);
    expect(next.series[1]!.type).toBe("line");
    expect(document.querySelector("dialog[open]")).toBeNull();
    // the chart on the slide shows the new title
    expect(qa("text[data-part=title]", q(`[data-element="${c.id}"]`)).map((t) => t.textContent)).toEqual(["Sales"]);
    run(() => s.undo());
    expect(charts(s)[0]).toEqual(c);
  });

  it("removes rows and series, switches type, and drops the stacking of a pie", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("Insert", "Chart", "Column");
    const c = charts(s)[0]!;
    pointer(q(".pli-deck-stage"), "dblclick", c.x! + 5, c.y! + 5);
    click(byLabel("Remove row 2"));
    click(byLabel("Remove series 2"));
    setValue(byLabel("Chart type") as HTMLSelectElement, "pie");
    expect(document.querySelector("[aria-label='Stacking']")).toBeNull();
    apply();
    const next = charts(s)[0]!;
    expect(next).toMatchObject({ chartType: "pie", categories: ["Category A", "Category C"] });
    expect(next.series).toHaveLength(1);
    expect(next.series[0]!.values).toEqual([12, 8]);
    expect(next.grouping).toBeUndefined();
  });

  it("cancel leaves the chart alone, and a series colour can be picked", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("Insert", "Chart", "Column");
    const c = charts(s)[0]!;
    pointer(q(".pli-deck-stage"), "dblclick", c.x! + 5, c.y! + 5);
    setValue(byLabel("Chart title") as HTMLInputElement, "Nope");
    click([...document.querySelectorAll<HTMLElement>("dialog button")].find((b) => b.textContent === "Cancel"));
    expect(charts(s)[0]).toEqual(c);
    pointer(q(".pli-deck-stage"), "dblclick", c.x! + 5, c.y! + 5);
    click(byLabel("Series 1 color"));
    click(document.querySelector<HTMLElement>(".pli-colors [aria-label='#ff0000']"));
    apply();
    expect(charts(s)[0]!.series[0]!.color).toBe("#ff0000");
  });

  it("opens from Chart options in the Format panel and the context menu, and a chart is selected and moved like a rectangle", () => {
    const s = newSession();
    render(<PliDeck session={s} />);
    choose("Insert", "Chart", "Line");
    const c = charts(s)[0]!;
    openMenu("Format");
    click(item("Format options…"));
    click([...document.querySelectorAll<HTMLElement>(".pli-deck-format-panel button")].find((b) => b.textContent === "Chart options…"));
    expect(document.querySelector("dialog[open]")).toBeTruthy();
    expect((byLabel("Smooth lines") as HTMLInputElement).checked).toBe(false);
    click(byLabel("Smooth lines"));
    apply();
    expect(charts(s)[0]!.smooth).toBe(true);
    // select by clicking inside it, drag it a little
    const stage = q(".pli-deck-stage");
    pointer(stage, "pointerdown", c.x! + 50, c.y! + 50);
    pointer(window, "pointerup");
    expect(s.selection.elements).toEqual([c.id]);
    pointer(stage, "pointerdown", c.x! + 50, c.y! + 50);
    pointer(window, "pointermove", c.x! + 80, c.y! + 70);
    pointer(window, "pointerup", c.x! + 80, c.y! + 70);
    expect(charts(s)[0]!.x).toBeCloseTo(c.x! + 30, 3);
  });

  it("draws a chart in a plain SlideView (thumbnails, presenting)", () => {
    const s = newSession();
    const c = s.addChart(s.deck.slides[0]!.id, "doughnut");
    render(<SlideView scene={s.scene(s.deck.slides[0]!.id)} scale={0.2} />);
    expect(q(`[data-element="${c.id}"]`).querySelectorAll("[data-part=slice]")).toHaveLength(3);
    expect(host.textContent).toContain("Category A");
  });
});
