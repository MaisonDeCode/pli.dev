import { build } from "esbuild";
import { chmod, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "scripts/pli.mjs");

// One file that needs only Node 18 or later: the engine and the command line tool, with nothing to install.
const result = await build({
  entryPoints: [resolve(here, "cli/cli.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  minify: true,
  legalComments: "none",
  write: false,
  banner: { js: "#!/usr/bin/env node" },
});
await writeFile(out, result.outputFiles[0].text);
await chmod(out, 0o755);
console.log(`${out}: ${(result.outputFiles[0].text.length / 1024).toFixed(0)} KB`);
