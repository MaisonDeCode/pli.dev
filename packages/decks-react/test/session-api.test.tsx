// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeckSession, createDeck } from "@pli.dev/decks";
import { fillPicturePlaceholder } from "../src/actions";

const src = join(__dirname, "../src");
const files = readdirSync(src).filter((f) => /\.tsx?$/.test(f));

describe("what the editor calls on a DeckSession", () => {
  it("exists: every `session.x` and `ctx.session.x` in the editor's source is a member of DeckSession", () => {
    const fresh = new DeckSession(createDeck());
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const f of files) {
      const text = readFileSync(join(src, f), "utf8");
      for (const m of text.matchAll(/\bsession\.([A-Za-z_]\w*)/g)) {
        const name = m[1]!;
        seen.add(name);
        if (!(name in fresh)) missing.push(`${f}: session.${name}`);
      }
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it("says clearly when the session is from before a method was added (a stale hot reload)", async () => {
    const real = new DeckSession(createDeck());
    const stale = Object.create(null, { deck: { get: () => real.deck } }) as DeckSession;
    const file = new File([new Uint8Array([1])], "photo.png", { type: "image/png" });
    await expect(fillPicturePlaceholder(stale, "s", "e", file)).rejects.toThrow(/out of date.*Reload/);
  });
});
