import { useState } from "react";
import { PliDeck, useDeckSession } from "@pli.dev/decks-react";
import { BUILTIN_THEMES, DeckSession, SIZE_GOOGLE, builtinTheme, createDeck, paragraphsFromText, type Deck, type Paragraph } from "@pli.dev/decks";
import { BackToDemos } from "../BackToDemos";

const bullets = (...lines: string[]): Paragraph[] => paragraphsFromText(lines.join("\n"));

/** A short deck with a title slide, an agenda, two columns, and a slide of shapes and a table, with notes, transitions and object animations. */
export function sampleDeck(): Deck {
  const first = BUILTIN_THEMES[0];
  const master = first ? builtinTheme(first.id, SIZE_GOOGLE) : undefined;
  const s = new DeckSession(createDeck({ title: "Quarterly review", size: SIZE_GOOGLE, ...(master ? { master } : {}) }));
  const layout = (kind: string) => s.deck.masters[0]!.layouts.find((l) => l.kind === kind)!.id;
  const text = (slide: string, index: number, paragraphs: Paragraph[]) => s.setText(slide, s.slide(slide).elements[index]!.id, paragraphs);

  const title = s.deck.slides[0]!;
  text(title.id, 0, paragraphsFromText("Quarterly review"));
  text(title.id, 1, paragraphsFromText("Where we are, and what comes next"));
  s.setNotes(title.id, "Welcome everyone. This takes about ten minutes.\nPress S for the presenter view, B for a black screen.", { merge: false });

  const agenda = s.addSlide({ layout: layout("titleAndBody") });
  text(agenda.id, 0, paragraphsFromText("Agenda"));
  text(agenda.id, 1, bullets("Results from the quarter", "What worked, what didn't", "Plans for the next three months", "Questions"));
  s.setNotes(agenda.id, "Keep to the agenda: questions at the end.", { merge: false });

  const columns = s.addSlide({ layout: layout("titleAndTwoColumns") });
  text(columns.id, 0, paragraphsFromText("Wins and worries"));
  text(columns.id, 1, bullets("Two launches on time", "Support tickets down 18%", "New team in place"));
  text(columns.id, 2, bullets("Hiring is slower than planned", "One supplier is late", "Budget is tight in the autumn"));

  const shapes = s.addSlide({ layout: layout("titleOnly") });
  text(shapes.id, 0, paragraphsFromText("Pipeline"));
  const box = (x: number, label: string, fill: string, geometry = "roundRect") => {
    const el = s.addShape(shapes.id, geometry, { x, y: 110, w: 150, h: 70 }, { fill: { theme: fill as "accent1" } });
    s.setText(shapes.id, el.id, paragraphsFromText(label));
    s.updateElement(shapes.id, el.id, (e) => (e.type === "shape" ? { ...e, text: { ...e.text!, vAlign: "middle" } } : e));
    return el;
  };
  const idea = box(40, "Idea", "accent1");
  const build = box(215, "Build", "accent4");
  const launch = box(390, "Launch", "accent3", "homePlate");
  s.addShape(shapes.id, "line", { x: 190, y: 145, w: 25, h: 0 }, { line: { width: 2, color: { theme: "dk2" }, tail: "triangle" } });
  s.addShape(shapes.id, "line", { x: 365, y: 145, w: 25, h: 0 }, { line: { width: 2, color: { theme: "dk2" }, tail: "triangle" } });
  const table = s.addTable(shapes.id, 3, 3, { x: 40, y: 220, w: 500 });
  const cells = [["Quarter", "Revenue", "Growth"], ["Q1", "$1.2M", "+4%"], ["Q2", "$1.4M", "+17%"]];
  cells.forEach((row, r) => row.forEach((t, c) => s.setCellParagraphs(shapes.id, table.id, r, c, paragraphsFromText(t))));
  // Object animations (open Motion in the toolbar to see and change them, and present to play them).
  s.addAnimation(title.id, { target: title.elements[0]!.id, kind: "pulse", trigger: "afterPrevious", duration: 900, amount: 1.08, easing: "easeInOut" });
  s.addAnimation(agenda.id, { target: agenda.elements[1]!.id, kind: "fade", text: "paragraph", duration: 400 });
  s.addAnimation(shapes.id, { target: idea.id, kind: "fly", direction: "left", duration: 500, easing: "easeOut" });
  s.addAnimation(shapes.id, { target: build.id, kind: "fly", direction: "down", trigger: "afterPrevious", duration: 500, easing: "easeOut" });
  s.addAnimation(shapes.id, { target: launch.id, kind: "fly", direction: "right", trigger: "afterPrevious", duration: 500, easing: "easeOut" });
  s.addAnimation(shapes.id, { target: table.id, kind: "wipe", direction: "left", duration: 600 });
  s.setTransition([columns.id, shapes.id], { type: "slide", direction: "right", duration: 500 });
  s.setTransition([agenda.id], { type: "fade", duration: 600 });

  return JSON.parse(JSON.stringify(s.deck)) as Deck;
}

/** The slide editor on its own, with a sample deck. Files go in and out through its File menu. */
export function DecksDemo() {
  const session = useDeckSession(() => sampleDeck());
  const [readOnly, setReadOnly] = useState(false);
  const [themes] = useState(BUILTIN_THEMES.slice(0, 4));
  return (
    <div className="decks-demo">
      <PliDeck
        session={session}
        readOnly={readOnly}
        actions={
          <>
            <label className="decks-theme-pick">
              Theme{" "}
              <select
                aria-label="Try a theme"
                defaultValue=""
                disabled={readOnly}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) session.applyTheme(builtinTheme(id, session.deck.size));
                  e.target.value = "";
                }}
              >
                <option value="">Try a theme…</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="pli-button" aria-pressed={readOnly} onClick={() => setReadOnly(!readOnly)}>
              Read only
            </button>
            <BackToDemos />
          </>
        }
      />
    </div>
  );
}
