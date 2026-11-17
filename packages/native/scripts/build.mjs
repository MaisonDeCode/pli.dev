import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** One script for each editor, so an app that only opens PDFs doesn't load a spreadsheet engine. Each defines `Pli` on the global object and needs nothing else: no DOM, no timers, no modules. */
export const engines = [
  { name: "pli-engine.js", entry: "src/bridge.ts", editor: "documents" },
  { name: "pli-sheets.js", entry: "src/bridge-sheets.ts", editor: "sheets" },
  { name: "pli-decks.js", entry: "src/bridge-decks.ts", editor: "decks" },
  { name: "pli-pdf.js", entry: "src/bridge-pdf.ts", editor: "pdf" },
];

for (const engine of engines) {
  const out = resolve(here, "../dist", engine.name);
  const result = await build({
    entryPoints: [resolve(here, "..", engine.entry)],
    bundle: true,
    format: "iife",
    platform: "neutral",
    target: "es2020",
    minify: true,
    legalComments: "none",
    write: false,
    mainFields: ["module", "main"],
    conditions: ["import", "default"],
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, result.outputFiles[0].text);
  console.log(`${out}: ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
}
