import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Some of what the tests use needs a newer Node than the packages do. The packages run on Node 20 (their `engines` say so), and CI
 * runs everything else there, but a test file that calls one of these can't. On an older Node those files are left out, and the run
 * says so.
 *
 * - pdf.js 6, which reads and draws the PDF files we write, needs Node 22.13 or later.
 * - `node:sqlite`, which the playground's SQL document store test uses, is in Node 22.5 and later.
 */
const needs = [
  { what: "pdf.js", from: [22, 13], uses: /pdfjs-dist|support\/(?:render|pdfinfo)|src\/pdfjs/ },
  { what: "node:sqlite", from: [22, 5], uses: /node:sqlite/ },
];
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const atLeast = ([m, n]: number[]) => major > m! || (major === m && minor >= n!);

function testsNeedingNewerNode(): string[] {
  const missing = needs.filter((need) => !atLeast(need.from));
  if (missing.length === 0) return [];
  const found = new Set<string>();
  for (const area of ["packages", "apps"]) {
    for (const name of readdirSync(at(`./${area}`))) {
      const dir = at(`./${area}/${name}/test`);
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
        if (!/\.test\.tsx?$/.test(entry)) continue;
        const text = readFileSync(join(dir, entry), "utf8");
        if (missing.some((need) => need.uses.test(text))) found.add(`${area}/${name}/test/${entry}`);
      }
    }
  }
  console.log(`Node ${process.versions.node}: leaving out ${found.size} test files that need a newer Node (${missing.map((n) => `${n.what} needs ${n.from.join(".")}`).join(", ")})`);
  return [...found];
}

export default defineConfig({
  resolve: {
    // The playground reaches the packages through its own node_modules, which pnpm links on install; these make its tests run before that.
    alias: [
      { find: /^@pli\.dev\/core$/, replacement: at("./packages/core/src/index.ts") },
      { find: /^@pli\.dev\/pdf$/, replacement: at("./packages/pdf/src/index.ts") },
      { find: /^@pli\.dev\/pdf-react$/, replacement: at("./packages/pdf-react/src/index.ts") },
      { find: /^@pli\.dev\/pdf-react\/pdfjs$/, replacement: at("./packages/pdf-react/src/pdfjs.ts") },
      { find: /^pdfjs-dist\/build\/pdf\.worker\.min\.mjs\?url$/, replacement: at("./apps/playground/test/stubs/worker-url.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}", "apps/*/test/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, ...testsNeedingNewerNode()],
  },
});
