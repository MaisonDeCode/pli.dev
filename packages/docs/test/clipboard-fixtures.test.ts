import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentSession, createDoc, paragraph, plainText, readPaste, validateDoc, type Block } from "../src";

/**
 * Real clipboards. Each folder in `fixtures/clipboard` is what some application put on the clipboard (see the README there).
 * Whatever the application, pasting it must give a valid document with the words that were copied, and not throw.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/clipboard");
const fixtures = existsSync(root) ? readdirSync(root).filter((name) => statSync(resolve(root, name)).isDirectory()) : [];

const read = (name: string, file: string) => {
  const path = resolve(root, name, file);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};

const textOf = (blocks: readonly Block[]): string => {
  const out: string[] = [];
  const visit = (b: Block) => {
    if (b.type === "table") b.rows.forEach((r) => r.cells.forEach((c) => c.blocks.forEach((x) => visit(x as Block))));
    else if ("runs" in b) out.push(plainText((b as unknown as { runs: Parameters<typeof plainText>[0] }).runs));
  };
  blocks.forEach(visit);
  return out.join("\n");
};

describe("clipboards from real applications", () => {
  it.skipIf(fixtures.length > 0)("has none yet: run scripts/capture-clipboard.swift to add one", () => {});

  for (const name of fixtures) {
    describe(name, () => {
      const html = read(name, "text.html");
      const rtf = read(name, "text.rtf");
      const text = read(name, "text.txt");

      it.skipIf(!html && !rtf)("pastes as a valid document", () => {
        const session = new DocumentSession(createDoc("T", [paragraph("")]));
        const id = session.state.blocks[0]!.id;
        session.select({ anchor: { block: id, offset: 0 }, focus: { block: id, offset: 0 } });
        expect(() => session.paste({ html, rtf, text })).not.toThrow();
        validateDoc(session.state);
      });

      it.skipIf(!html && !rtf)("keeps the words that were copied", () => {
        const content = readPaste({ html, rtf, text });
        expect(content).not.toBeNull();
        const pasted = content!.source === "text" ? content!.text : textOf(content!.blocks);
        const normalize = (s: string) => s.replace(/[\s ​]+/g, " ").toLowerCase();
        const words = [...new Set(normalize(text ?? "").split(" ").filter((w) => w.length >= 4 && /^[\p{L}\p{N}]+$/u.test(w)))];
        const missing = words.filter((w) => !normalize(pasted).includes(w));
        expect(missing, `words from the plain-text copy that didn't arrive`).toEqual([]);
      });

      it.skipIf(!html && !rtf)("never pastes script, styles or the application's own markup as text", () => {
        const content = readPaste({ html, rtf, text });
        const pasted = content!.source === "text" ? content!.text : textOf(content!.blocks);
        expect(pasted).not.toMatch(/<\/?(span|div|style|script|o:p|w:|meta)\b|mso-|StartFragment|EndFragment|@font-face/i);
      });
    });
  }
});
