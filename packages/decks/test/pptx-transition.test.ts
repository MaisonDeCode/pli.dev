import { describe, expect, it } from "vitest";
import { DeckSession, createDeck, fromPptx, toPptx } from "../src";

describe("transition durations", () => {
  it("keep their exact length and advance time through PPTX", () => {
    const s = new DeckSession(createDeck());
    s.addSlide();
    const [a, b] = s.deck.slides;
    s.setTransition([a!.id], { type: "fade", duration: 900, advanceAfter: 3000 });
    s.setTransition([b!.id], { type: "push", direction: "left" });
    const back = fromPptx(toPptx(s.deck, { date: new Date(0) })).deck;
    expect(back.slides[0]!.transition).toMatchObject({ type: "fade", duration: 900, advanceAfter: 3000 });
    expect(back.slides[1]!.transition).toMatchObject({ type: "push", direction: "left" });
  });
});
