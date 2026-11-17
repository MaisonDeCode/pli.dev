import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const out = resolve(root, "dist/pli-editor.html");

// The editor and its styles, as one HTML file with nothing to fetch, so a web view can show it from memory.
const result = await build({
  entryPoints: [resolve(root, "src/main.tsx")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["safari15", "chrome100"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  outdir: "out",
  write: false,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".svg": "dataurl", ".woff2": "dataurl", ".png": "dataurl" },
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js"))?.text ?? "";
const css = result.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "";
// Inside a <script> or <style>, only a closing tag can end the block early.
const safe = (text, tag) => text.replaceAll(`</${tag}`, `<\\/${tag}`);
const html = (await readFile(resolve(root, "index.html"), "utf8"))
  .replace("<!--STYLES-->", () => `<style>${safe(css, "style")}</style>`)
  .replace("<!--SCRIPT-->", () => `<script>${safe(js, "script")}</script>`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);

// The same file goes beside each package that shows it.
for (const target of ["packages/swift/Sources/Pli/Resources/pli-editor.html", "packages/kotlin-android/src/main/assets/pli-editor.html"]) {
  const to = resolve(root, "../..", target);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(out, to);
  console.log(to);
}
