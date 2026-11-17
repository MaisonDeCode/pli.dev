// Writes public/llms-full.txt: the Pli.Documents, Pli.Sheets, Pli.Decks, Pli.PDF and platform pages as one text file, for an AI agent to load.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const docs = fileURLToPath(new URL("../src/content/docs/", import.meta.url));
const out = fileURLToPath(new URL("../public/llms-full.txt", import.meta.url));

const files = (dir) =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.mdx?$/.test(name) ? [path] : [];
    });

const parts = ["# Pli: documentation for Pli.Documents, Pli.Sheets, Pli.Decks, Pli.PDF and the platform\n"];
for (const section of ["documents", "sheets", "decks", "pdf", "platform"]) {
  for (const file of files(join(docs, section))) {
    const text = readFileSync(file, "utf8");
    const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
    const title = /^title:\s*(.+)$/m.exec(match?.[1] ?? "")?.[1]?.replace(/^["']|["']$/g, "") ?? file;
    const path = "/" + relative(docs, file).replace(/\.mdx?$/, "").replace(/\/?index$/, "") + "/";
    parts.push(`\n---\n\n# ${title}\n\nURL: https://pli.dev${path}\n\n${match ? text.slice(match[0].length) : text}`);
  }
}
writeFileSync(out, parts.join("\n").replace(/\n{3,}/g, "\n\n"));
console.log(`llms-full.txt: ${parts.length - 1} pages`);
