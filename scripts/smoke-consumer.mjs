#!/usr/bin/env node
// Installs the packed packages in a fresh app outside the repository, the way a person who runs `npm install @pli.dev/docs` would,
// and builds and runs that app. The Pli packages come from tarballs on disk (nothing is published); the other packages
// (react, vite, typescript, pdfjs-dist) come from the registry as they would for anyone.
//
//   pnpm build && pnpm release:smoke              npm and pnpm
//   node scripts/smoke-consumer.mjs --pm npm      one package manager
//   node scripts/smoke-consumer.mjs --keep        leave the temp folder in place and print its path
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const only = args.includes("--pm") ? [args[args.indexOf("--pm") + 1]] : ["npm", "pnpm"];

const packages = readdirSync(join(root, "packages"))
  .map((dir) => ({ dir: join(root, "packages", dir), manifest: existsSync(join(root, "packages", dir, "package.json")) ? JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8")) : null }))
  .filter(({ manifest }) => manifest && !manifest.private);

const work = mkdtempSync(join(tmpdir(), "pli-smoke-"));
const run = (command, commandArgs, cwd, label) => {
  console.log(`\n$ ${[command, ...commandArgs].join(" ")}   (${label ?? cwd.replace(work, "<temp>")})`);
  try {
    return execFileSync(command, commandArgs, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", env: { ...process.env, CI: "1", NO_COLOR: "1" } });
  } catch (error) {
    console.error(`${error.stdout ?? ""}${error.stderr ?? ""}`);
    throw new Error(`failed: ${command} ${commandArgs.join(" ")}`);
  }
};
const show = (text) => console.log(text.trim().split("\n").slice(-12).join("\n"));

let ok = false;
try {
  const tarballs = join(work, "tarballs");
  mkdirSync(tarballs);
  const files = {};
  for (const { dir, manifest } of packages) {
    if (!existsSync(join(dir, "dist"))) throw new Error(`${manifest.name} has no dist. Run "pnpm build" first.`);
    run("pnpm", ["pack", "--pack-destination", tarballs], dir, manifest.name);
    files[manifest.name] = join(tarballs, `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`);
    if (!existsSync(files[manifest.name])) throw new Error(`no tarball for ${manifest.name}`);
  }
  console.log(`\nPacked ${Object.keys(files).length} packages into ${tarballs}`);

  for (const pm of only) {
    const app = join(work, `app-${pm}`);
    cpSync(join(root, "scripts/consumer-smoke"), app, { recursive: true });
    const direct = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, `file:${file}`]));
    const manifest = {
      name: `pli-smoke-${pm}`,
      private: true,
      type: "module",
      dependencies: { ...direct, react: "^19.0.0", "react-dom": "^19.0.0", "pdfjs-dist": "^5.0.0" },
      devDependencies: { "@types/node": "^22.0.0", "@types/react": "^19.0.0", "@types/react-dom": "^19.0.0", "@vitejs/plugin-react": "^5.0.0", jsdom: "^26.0.0", typescript: "^5.6.0", vite: "^7.0.0" },
      // The Pli packages depend on each other with ^1.0.0; point those at the tarballs too so nothing is looked up in the registry.
      overrides: direct,
      pnpm: { overrides: direct },
    };
    writeFileSync(join(app, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    // Newer pnpm reads overrides from pnpm-workspace.yaml and older ones from package.json; give it both.
    if (pm === "pnpm") writeFileSync(join(app, "pnpm-workspace.yaml"), `allowBuilds:\n  esbuild: true\noverrides:\n${Object.entries(direct).map(([name, spec]) => `  "${name}": "${spec}"`).join("\n")}\n`);

    if (pm === "npm") show(run("npm", ["install", "--no-audit", "--no-fund", "--no-package-lock"], app));
    else show(run("pnpm", ["install", "--no-frozen-lockfile", "--config.auto-install-peers=false", "--config.strict-peer-dependencies=true"], app));

    // What was installed: built files only.
    for (const name of Object.keys(files)) {
      const installed = join(app, "node_modules", name);
      for (const forbidden of ["src", "test", "tsup.config.ts", "tsconfig.json"]) if (existsSync(join(installed, forbidden))) throw new Error(`${name} was installed with ${forbidden}`);
      const installedManifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
      if (JSON.stringify(installedManifest).includes("workspace:")) throw new Error(`${name} was installed with a workspace: range`);
    }

    show(run("node", ["engines.mjs"], app));
    show(run("node", ["render.mjs"], app));
    show(run("node", ["cjs-import.cjs"], app));
    show(run("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], app));
    show(run("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.node16.json"], app));
    show(run("node", ["node_modules/vite/bin/vite.js", "build"], app));

    // The build has the editors' styles and the pdf.js worker.
    const assets = readdirSync(join(app, "dist/assets"));
    const css = assets.filter((name) => name.endsWith(".css")).map((name) => readFileSync(join(app, "dist/assets", name), "utf8")).join("\n");
    for (const name of Object.keys(files)) {
      const sheet = join(app, "node_modules", name, "dist/styles.css");
      if (!existsSync(sheet)) continue;
      const selector = readFileSync(sheet, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").match(/\.[a-z][\w-]+/g)?.at(-1);
      if (!selector || !css.includes(selector)) throw new Error(`the built CSS has no "${selector}" from ${name}/styles.css`);
    }
    if (css.length < 20000) throw new Error(`the built CSS is only ${css.length} bytes`);
    if (!assets.some((name) => /pdf\.worker.*\.mjs$/.test(name))) throw new Error("the pdf.js worker was not copied to the build");
    console.log(`\n${pm}: ok (${assets.length} assets, ${(css.length / 1024).toFixed(0)} KB of CSS)`);
  }
  ok = true;
} finally {
  if (keep) console.log(`\nkept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
console.log(ok ? "\nConsumer smoke test passed." : "\nConsumer smoke test failed.");
process.exit(ok ? 0 : 1);
