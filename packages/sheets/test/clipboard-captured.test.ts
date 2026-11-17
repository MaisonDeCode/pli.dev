import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SheetSession, createWorkbook, parseHtmlTable } from "../src";
import { parseTsv } from "../src/clipboard";

/*
 * Two checks that need no one to say what a paste should give:
 *  - for each fixture, every number is shown (with the format the paste gave it) as the program showed it in its HTML;
 *  - for each capture of a real clipboard (`swift scripts/capture-clipboard.swift <name> sheets` saves one in
 *    fixtures/clipboard/captured/<name>/ with the HTML as text.html and the tab-separated text as text.txt), pasting the
 *    HTML lands on the same cells, and shows the same text, as pasting the text.
 */

const DIR = join(__dirname, "fixtures", "clipboard");
const make = () => new SheetSession(createWorkbook("T", ["Sheet1"]), { now: () => 45_000.5 });
const column = (n: number) => (n > 25 ? String.fromCharCode(64 + Math.floor(n / 26)) : "") + String.fromCharCode(65 + (n % 26));

describe("every number of a fixture shows as the program showed it", () => {
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".html"))) {
    it(file, () => {
      const html = readFileSync(join(DIR, file), "utf8");
      const table = parseHtmlTable(html);
      if (!table) return;
      const s = make();
      s.pasteHtml("Sheet1", "A1", html);
      const wrong: string[] = [];
      // Cells covered by a span push the next ones over, as in the paste.
      const taken = new Set<string>();
      table.rows.forEach((cells, r) => {
        let c = 0;
        for (const cell of cells) {
          while (taken.has(`${r}:${c}`)) c++;
          for (let i = 0; i < cell.rowspan; i++) for (let j = 0; j < cell.colspan; j++) taken.add(`${r + i}:${c + j}`);
          if (typeof cell.value === "number" && cell.text !== "" && !cell.formula) {
            const shown = s.display("Sheet1", `${column(c)}${r + 1}`).text;
            if (shown.trim() !== cell.text) wrong.push(`${column(c)}${r + 1}: the program showed "${cell.text}", Pli shows "${shown}" (format ${JSON.stringify(s.cell("Sheet1", `${column(c)}${r + 1}`)?.fmt)})`);
          }
          c += cell.colspan;
        }
      });
      expect(wrong).toEqual([]);
    });
  }
});

describe("captures of real clipboards", () => {
  const dir = join(DIR, "captured");
  const names = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  if (!names.length) it("(none saved yet: see scripts/capture-clipboard.swift)", () => undefined);
  for (const name of names) {
    it(`${name}: the HTML and the text agree`, () => {
      const html = readFileSync(join(dir, name, "text.html"), "utf8");
      const text = readFileSync(join(dir, name, "text.txt"), "utf8");
      const rows = parseTsv(text.replace(/\r?\n$/, ""));
      const width = Math.max(...rows.map((r) => r.length));
      const a = make();
      const range = a.pasteHtml("Sheet1", "A1", html);
      const b = make();
      b.pasteText("Sheet1", "A1", text);
      expect(range).toBe(`A1:${column(width - 1)}${rows.length}`);
      const wrong: string[] = [];
      rows.forEach((row, r) => {
        for (let c = 0; c < width; c++) {
          const at = `${column(c)}${r + 1}`;
          const shown = a.display("Sheet1", at).text;
          if (shown.trim() !== (row[c] ?? "").trim()) wrong.push(`${at}: the text says "${row[c] ?? ""}", the HTML paste shows "${shown}"`);
        }
      });
      expect(wrong).toEqual([]);
    });
  }
});
