/**
 * The scripted story of the Pli.Decks editor on the site, as data and plain functions (no React).
 *
 *   step 0  a title slide
 *   step 1  a second slide, Wins and worries in two columns, appears and the "Midnight" theme is applied to the deck
 *   step 2  a third slide with shapes, a table and a chart, built one object at a time, with object animations
 *
 * Every step is a list of timed actions that call the real `DeckSession` commands. The same list is played live (with
 * delays) and, run at once on a scratch session, makes the snapshot of the step: so the state at the end of a step is the
 * same however it was reached (forward with animation, backward or by a jump), apart from the random ids of new objects.
 */
import { BUILTIN_THEMES, DeckSession, SIZE_GOOGLE, builtinTheme, createDeck, paragraphsFromText, type Deck, type Paragraph } from "@pli.dev/decks";

export const DECK_STEPS = 3;

/** What an action may do besides changing the deck: show a slide, the way the filmstrip does when someone clicks it. */
export interface Stage {
  show(slideId: string): void;
}

export interface Action {
  /** Milliseconds after the step starts. */
  at: number;
  run(session: DeckSession, stage: Stage): void;
}

const bullets = (...lines: string[]): Paragraph[] => paragraphsFromText(lines.join("\n"));
const layoutOf = (s: DeckSession, kind: string) => s.deck.masters[0]!.layouts.find((l) => l.kind === kind)!.id;
const lastSlide = (s: DeckSession) => s.deck.slides[s.deck.slides.length - 1]!.id;
const text = (s: DeckSession, slide: string, index: number, paragraphs: Paragraph[]) => s.setText(slide, s.slide(slide).elements[index]!.id, paragraphs);

/** The first slide: the whole of step 0. */
export function baseDeck(): Deck {
  const first = BUILTIN_THEMES[0];
  const master = first ? builtinTheme(first.id, SIZE_GOOGLE) : undefined;
  const s = new DeckSession(createDeck({ title: "Product review", size: SIZE_GOOGLE, ...(master ? { master } : {}) }));
  const title = s.deck.slides[0]!;
  text(s, title.id, 0, paragraphsFromText("Product review, third quarter"));
  text(s, title.id, 1, paragraphsFromText("What shipped, what we learned, what comes next"));
  s.setNotes(title.id, "Welcome everyone. This takes about ten minutes.", { merge: false });
  return JSON.parse(JSON.stringify(s.deck)) as Deck;
}

/** Step 1: a two-column slide, then a new look for the whole deck. */
const STEP_ONE: Action[] = [
  {
    at: 0,
    run(s, stage) {
      const slide = s.addSlide({ layout: layoutOf(s, "titleAndTwoColumns"), after: lastSlide(s) });
      text(s, slide.id, 0, paragraphsFromText("Wins and worries"));
      text(s, slide.id, 1, bullets("Two launches shipped on time", "Support tickets down 18%", "The new team is fully onboarded"));
      text(s, slide.id, 2, bullets("Hiring is behind plan", "One supplier is running late", "The autumn budget is tight"));
      s.setNotes(slide.id, "Keep to the facts here; questions come at the end.", { merge: false });
      stage.show(slide.id);
    },
  },
  {
    at: 1100,
    run(s) {
      s.applyTheme(builtinTheme("midnight", s.deck.size));
    },
  },
];

/** Step 2: a slide of shapes, a table and a chart, put together one object at a time, and their animations. */
function stepTwo(): Action[] {
  const ids: { slide?: string; idea?: string; build?: string; launch?: string; table?: string; chart?: string } = {};
  const slideId = () => ids.slide!;
  const box = (s: DeckSession, x: number, label: string, fill: "accent1" | "accent2" | "accent3", geometry = "roundRect") => {
    const el = s.addShape(slideId(), geometry, { x, y: 104, w: 180, h: 64 }, { fill: { theme: fill } });
    s.setText(slideId(), el.id, paragraphsFromText(label));
    s.updateElement(slideId(), el.id, (e) => (e.type === "shape" ? { ...e, text: { ...e.text!, vAlign: "middle" } } : e));
    return el.id;
  };
  const arrow = (s: DeckSession, x: number) => s.addShape(slideId(), "line", { x, y: 136, w: 50, h: 0 }, { line: { width: 2, color: { theme: "dk2" }, tail: "triangle" } });
  return [
    {
      at: 0,
      run(s, stage) {
        const slide = s.addSlide({ layout: layoutOf(s, "titleOnly"), after: lastSlide(s) });
        ids.slide = slide.id;
        text(s, slide.id, 0, paragraphsFromText("From idea to launch"));
        stage.show(slide.id);
      },
    },
    { at: 450, run: (s) => void (ids.idea = box(s, 40, "Idea", "accent1")) },
    {
      at: 850,
      run(s) {
        arrow(s, 220);
        ids.build = box(s, 270, "Build", "accent2");
      },
    },
    {
      at: 1250,
      run(s) {
        arrow(s, 450);
        ids.launch = box(s, 500, "Launch", "accent3", "homePlate");
      },
    },
    {
      at: 1750,
      run(s) {
        const table = s.addTable(slideId(), 4, 3, { x: 40, y: 196, w: 310 });
        const cells = [["Quarter", "Revenue", "Growth"], ["Q1", "$1.2M", "+4%"], ["Q2", "$1.4M", "+17%"], ["Q3", "$1.7M", "+21%"]];
        cells.forEach((row, r) => row.forEach((t, c) => s.setCellParagraphs(slideId(), table.id, r, c, paragraphsFromText(t))));
        ids.table = table.id;
      },
    },
    {
      at: 2300,
      run(s) {
        const chart = s.addChart(slideId(), "column", { x: 380, y: 184, w: 300, h: 200 }, {
          categories: ["Q1", "Q2", "Q3", "Q4 plan"],
          series: [{ name: "Revenue, $M", values: [1.2, 1.4, 1.7, 2.1] }],
          legend: "none",
          title: "Revenue, $M",
          titleSize: 12,
        });
        ids.chart = chart.id;
      },
    },
    {
      at: 2800,
      run(s) {
        const slide = slideId();
        s.addAnimation(slide, { target: ids.idea!, kind: "fly", direction: "left", duration: 500, easing: "easeOut" });
        s.addAnimation(slide, { target: ids.build!, kind: "fly", direction: "down", trigger: "afterPrevious", duration: 500, easing: "easeOut" });
        s.addAnimation(slide, { target: ids.launch!, kind: "fly", direction: "right", trigger: "afterPrevious", duration: 500, easing: "easeOut" });
        s.addAnimation(slide, { target: ids.table!, kind: "wipe", direction: "left", duration: 600 });
        s.addAnimation(slide, { target: ids.chart!, kind: "fade", trigger: "afterPrevious", duration: 600 });
        s.setTransition([slide], { type: "fade", duration: 500 });
      },
    },
  ];
}

/** The actions of a step (`step` 1 and up; step 0 is the base deck). Made fresh, because actions remember the objects they add. */
export function actionsFor(step: number): Action[] {
  if (step === 1) return STEP_ONE;
  if (step === 2) return stepTwo();
  return [];
}

/** How long a step takes to play. */
export const stepDuration = (step: number): number => actionsFor(step).reduce((m, a) => Math.max(m, a.at), 0);

export const clampStep = (step: number): number => Math.min(DECK_STEPS - 1, Math.max(0, Math.round(Number.isFinite(step) ? step : 0)));

const cache: Deck[] = [];

/** The deck as it is at the end of a step, built once. Each call returns a fresh copy that the caller may load into a session. */
export function snapshotOf(step: number): Deck {
  const target = clampStep(step);
  if (cache.length === 0) cache.push(baseDeck());
  while (cache.length <= target) {
    const k = cache.length;
    const scratch = new DeckSession(JSON.parse(JSON.stringify(cache[k - 1])) as Deck);
    const stage: Stage = { show: (id) => (scratch.selection = { slide: id, slides: [id], elements: [] }) };
    for (const a of actionsFor(k)) a.run(scratch, stage);
    cache.push(JSON.parse(JSON.stringify(scratch.deck)) as Deck);
  }
  return JSON.parse(JSON.stringify(cache[target])) as Deck;
}

/** The slide the editor shows at the end of a step. */
export const slideShownAt = (deck: Deck, step: number): string => deck.slides[Math.min(step, deck.slides.length - 1)]!.id;
