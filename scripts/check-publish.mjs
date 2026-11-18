#!/usr/bin/env node
// Checks that the packages are ready to publish. Run it after `pnpm build`: `pnpm release:check`.
//
// It looks at the package.json files, at the built `dist` folders and at what `pnpm pack` would put in each tarball, and exits
// with 1 and a list of problems if anything would break for a person who installs the packages from npm.
//
//   node scripts/check-publish.mjs            all checks, including packing every package
//   node scripts/check-publish.mjs --no-pack  skip packing (quicker, no tarball checks)
//   node scripts/check-publish.mjs --verbose  also print each tarball's file list and size
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose");
const pack = !args.has("--no-pack");

const REPO = "https://github.com/MaisonDeCode/pli.dev";
const VERSION = "1.0.0";
const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

const problems = [];
const warnings = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);
const warn = (where, message) => warnings.push(`${where}: ${message}`);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name);
    if (name.isDirectory()) {
      if (name.name === "node_modules") continue;
      walk(path, out);
    } else out.push(path);
  }
  return out;
};
const rel = (path) => relative(root, path);
const packageNameOf = (specifier) => (specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);
const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`);

// --- The packages: every non-private package in packages/ ---------------------------------------------------------------------
const workspace = new Map(); // name -> { dir, manifest }
for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
  const manifestPath = join(root, "packages", entry.name, "package.json");
  if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
  const manifest = readJson(manifestPath);
  workspace.set(manifest.name, { dir: join(root, "packages", entry.name), manifest });
}
const publicPackages = [...workspace.values()].filter(({ manifest }) => !manifest.private);

// --- The repository root --------------------------------------------------------------------------------------------------------
if (!existsSync(join(root, "LICENSE"))) fail("root", "LICENSE is missing");
const rootLicense = existsSync(join(root, "LICENSE")) ? readFileSync(join(root, "LICENSE"), "utf8") : "";
if (rootLicense && !/Apache License/.test(rootLicense)) fail("LICENSE", "is not the Apache License");
for (const file of [".changeset/config.json", ".github/workflows/ci.yml", ".github/workflows/release.yml", "CHANGELOG.md"]) {
  if (!existsSync(join(root, file))) fail("root", `${file} is missing`);
}
if (existsSync(join(root, ".changeset/config.json"))) {
  const config = readJson(join(root, ".changeset/config.json"));
  const fixed = new Set((config.fixed ?? []).flat());
  for (const { manifest } of publicPackages) if (!fixed.has(manifest.name)) fail(".changeset/config.json", `${manifest.name} is not in the "fixed" group, so its version would move alone`);
  for (const name of fixed) if (!workspace.has(name)) fail(".changeset/config.json", `"fixed" lists ${name}, which is not a package`);
}

// --- Each package -----------------------------------------------------------------------------------------------------------------
for (const { dir, manifest } of publicPackages) {
  const name = manifest.name;
  const folder = relative(root, dir);
  const fields = { type: "module", license: "Apache-2.0", homepage: "https://pli.dev" };
  for (const [field, value] of Object.entries(fields)) if (manifest[field] !== value) fail(name, `"${field}" must be ${JSON.stringify(value)}`);
  if (!name.startsWith("@pli.dev/")) fail(name, 'the name must be in the "@pli.dev" scope');
  // One version for all of them (the Changesets "fixed" group), and never before the first release.
  if (manifest.version !== publicPackages[0].manifest.version) fail(name, `version is ${manifest.version}, but ${publicPackages[0].manifest.name} is ${publicPackages[0].manifest.version}: all packages are released together under one version`);
  if (Number(manifest.version.split(".")[0]) < 1) fail(name, `version is ${manifest.version}, expected ${VERSION} or later`);
  if (manifest.repository?.type !== "git" || manifest.repository?.url !== `${REPO}.git` || manifest.repository?.directory !== folder) fail(name, `"repository" must be { type: "git", url: "${REPO}.git", directory: "${folder}" }`);
  if (manifest.bugs?.url !== `${REPO}/issues`) fail(name, `"bugs.url" must be ${REPO}/issues`);
  if (!manifest.description || manifest.description.length < 20) fail(name, '"description" is missing or too short');
  if (!Array.isArray(manifest.keywords) || manifest.keywords.length === 0) fail(name, '"keywords" is empty');
  if (!manifest.engines?.node) fail(name, '"engines.node" is missing');
  if (manifest.publishConfig?.access !== "public") fail(name, 'publishConfig.access must be "public"');
  if (manifest.devDependencies && Object.keys(manifest.devDependencies).length) fail(name, `devDependencies belong in the repository root (found ${Object.keys(manifest.devDependencies).join(", ")})`);
  if (manifest.scripts?.postinstall || manifest.scripts?.install || manifest.scripts?.preinstall) fail(name, "install scripts run on the consumer's machine; remove them");
  if (manifest.sideEffects === undefined) fail(name, '"sideEffects" is missing (false, or ["*.css"] if there is a stylesheet)');

  // Files that npm ships: the list, the license and the README.
  if (!Array.isArray(manifest.files) || !manifest.files.includes("dist")) fail(name, '"files" must list "dist"');
  for (const file of ["LICENSE", "README.md"]) {
    if (!existsSync(join(dir, file))) fail(name, `${file} is missing from ${folder}`);
  }
  if (existsSync(join(dir, "LICENSE")) && readFileSync(join(dir, "LICENSE"), "utf8") !== rootLicense) fail(name, `${folder}/LICENSE differs from the root LICENSE (copy it again)`);

  // Dependencies on other packages of this repository.
  for (const [field, deps] of [["dependencies", manifest.dependencies], ["peerDependencies", manifest.peerDependencies], ["optionalDependencies", manifest.optionalDependencies]]) {
    for (const [dep, range] of Object.entries(deps ?? {})) {
      const isInternal = dep.startsWith("@pli.dev/");
      if (isInternal) {
        const target = workspace.get(dep);
        if (!target) fail(name, `${field} lists ${dep}, which is not a package in this repository`);
        else if (target.manifest.private) fail(name, `${field} lists ${dep}, which is private and will never be on npm`);
        if (field === "dependencies" && !/^workspace:[\^~*]$/.test(range)) fail(name, `${dep} must use a "workspace:^" range so pnpm writes the real version when it packs (found "${range}")`);
      } else if (/^(workspace|link|file|git|github|portal):|^https?:/.test(range)) fail(name, `${field}.${dep} uses "${range}", which cannot be installed from npm`);
    }
  }

  // The built files.
  const distDir = join(dir, "dist");
  if (!existsSync(distDir)) {
    fail(name, "dist is missing. Run `pnpm build`.");
    continue;
  }
  const published = manifest.publishConfig ?? {};
  const exportsMap = published.exports;
  if (!exportsMap) {
    fail(name, "publishConfig.exports is missing: the published package would export the TypeScript source");
    continue;
  }
  const exportedFiles = new Set();
  const checkTarget = (subpath, condition, target) => {
    if (typeof target !== "string") return;
    if (!target.startsWith("./")) return fail(name, `exports["${subpath}"] ${condition} "${target}" must start with "./"`);
    if (target.includes("/src/") || target.endsWith(".ts") && !target.endsWith(".d.ts")) fail(name, `exports["${subpath}"] ${condition} points at source: ${target}`);
    if (!existsSync(join(dir, target))) fail(name, `exports["${subpath}"] ${condition} "${target}" does not exist`);
    exportedFiles.add(target);
  };
  for (const [subpath, value] of Object.entries(exportsMap)) {
    if (typeof value === "string") {
      checkTarget(subpath, "target", value);
      continue;
    }
    if (!value.types) fail(name, `exports["${subpath}"] has no "types"`);
    if (Object.keys(value)[0] !== "types") fail(name, `exports["${subpath}"]: "types" must come first or TypeScript ignores it`);
    for (const [condition, target] of Object.entries(value)) checkTarget(subpath, condition, target);
  }
  for (const field of ["main", "module", "types"]) {
    if (!published[field]) fail(name, `publishConfig.${field} is missing`);
    else checkTarget(`(${field})`, field, published[field]);
  }
  if (!exportsMap["./package.json"]) warn(name, 'exports has no "./package.json"; tools that read it will fail');
  if (manifest.sideEffects !== false) {
    const css = Object.keys(exportsMap).filter((key) => key.endsWith(".css"));
    if (!css.length) warn(name, "sideEffects lists css but the package exports no stylesheet");
    if (!Array.isArray(manifest.sideEffects) || !manifest.sideEffects.includes("*.css")) fail(name, 'sideEffects must be false, or ["*.css"] if the package has a stylesheet');
  }

  // What the built code imports must be declared, and must not reach into source.
  const allowed = new Set([name, ...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {}), ...Object.keys(manifest.optionalDependencies ?? {})]);
  const distFiles = walk(distDir);
  for (const file of distFiles) {
    const where = `${name} ${rel(file)}`;
    if (/\.(m?js|d\.ts|d\.mts)$/.test(file)) {
      const text = readFileSync(file, "utf8");
      const specifiers = new Set();
      for (const match of text.matchAll(/(?:^|[;\s}])(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']/g)) specifiers.add(match[1]);
      for (const match of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(match[1]);
      for (const match of text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(match[1]);
      for (const spec of specifiers) {
        if (spec.startsWith(".")) {
          const target = resolve(dirname(file), spec);
          const declaration = /\.d\.m?ts$/.test(file) && spec.endsWith(".js") ? target.replace(/\.js$/, ".d.ts") : target;
          if (!existsSync(target) && !existsSync(declaration)) fail(where, `imports "${spec}", which is not in dist`);
        } else if (spec.startsWith("/")) fail(where, `imports an absolute path "${spec}"`);
        else if (!NODE_BUILTINS.has(spec) && !allowed.has(packageNameOf(spec))) fail(where, `imports "${spec}", which is not in dependencies or peerDependencies`);
        if (/^@pli\.dev\/[^/]+\/(src|dist)\b/.test(spec) || /(^|\/)src\//.test(spec)) fail(where, `imports "${spec}", a path inside a package's source`);
      }
      if (/\/Users\/|\/home\/[a-z]|[A-Z]:\\\\Users|\/private\/var\//.test(text)) fail(where, "contains an absolute path from the machine that built it");
      if (/@pli\/(core|docs|react|sheets|decks|pdf)/.test(text)) fail(where, 'mentions the old "@pli/" scope');
      if (/\bworkspace:[\^~*]/.test(text)) fail(where, 'mentions a "workspace:" range');
      for (const match of text.matchAll(/new URL\(\s*["'](\.[^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
        if (!existsSync(resolve(dirname(file), match[1]))) fail(where, `needs "${match[1]}" next to it, which is not in dist`);
      }
    } else if (file.endsWith(".css")) {
      const text = readFileSync(file, "utf8");
      if (/@import\s+(url\()?["']\./.test(text)) fail(where, "still has a relative @import, so the stylesheet is not self-contained");
      for (const match of text.matchAll(/url\(\s*["']?(?!data:|https?:|#|\/)([^"')]+)["']?\s*\)/g)) {
        if (!existsSync(resolve(dirname(file), match[1]))) fail(where, `uses url(${match[1]}), which is not in dist`);
      }
    }
  }

  // What the source imports: declared, never another package's source.
  const sourceFiles = walk(join(dir, "src")).filter((file) => /\.(tsx?|mts|mjs|css)$/.test(file));
  for (const file of sourceFiles) {
    if (file.endsWith(".css")) continue;
    const text = readFileSync(file, "utf8");
    const where = `${name} ${rel(file)}`;
    for (const match of text.matchAll(/(?:^|[;\s}])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = match[1] ?? match[2];
      if (spec.startsWith(".")) {
        if (/^(\.\.\/)+(core|docs|react|sheets|sheets-react|decks|decks-react|pdf|pdf-react|native|editor-host|swift|kotlin)\b/.test(spec) && !resolve(dirname(file), spec).startsWith(join(dir, "src"))) fail(where, `reaches into another package with "${spec}"`);
        continue;
      }
      if (/^@pli\.dev\/[^/]+\/(src|dist)\b/.test(spec)) fail(where, `imports "${spec}", a path inside another package's source`);
      if (NODE_BUILTINS.has(spec)) fail(where, `imports the Node module "${spec}" in code that also runs in browsers`);
      else if (!allowed.has(packageNameOf(spec))) fail(where, `imports "${spec}", which is not in dependencies or peerDependencies`);
    }
    if (/@pli\/(core|docs|react|sheets|decks|pdf)/.test(text)) fail(where, 'mentions the old "@pli/" scope');
  }
}

// --- No leftovers of the old scope anywhere that ships ----------------------------------------------------------------------------
for (const { dir, manifest } of publicPackages) {
  for (const file of ["package.json", "README.md"]) {
    const path = join(dir, file);
    if (existsSync(path) && /@pli\/(core|docs|react|sheets|decks|pdf|native)/.test(readFileSync(path, "utf8"))) fail(manifest.name, `${file} mentions the old "@pli/" scope`);
  }
}

// --- The tarballs ------------------------------------------------------------------------------------------------------------------
const FORBIDDEN = [/(^|\/)(src|test|tests|fixtures|scripts|\.github)\//, /\.test\.[cm]?[jt]sx?$/, /(^|\/)\.env/, /\.(pem|key|p12)$/, /\.DS_Store$/, /\.map$/, /(^|\/)node_modules\//, /tsconfig[^/]*\.json$/, /tsup\.config\./, /\.tsbuildinfo$/];
const sizes = [];
if (pack && problems.length === 0) {
  const temp = mkdtempSync(join(tmpdir(), "pli-pack-"));
  try {
    for (const { dir, manifest } of publicPackages) {
      const name = manifest.name;
      const out = join(temp, name.replace(/[@/]/g, "_"));
      execFileSync("pnpm", ["pack", "--pack-destination", out], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
      const tarball = join(out, readdirSync(out).find((file) => file.endsWith(".tgz")));
      const list = execFileSync("tar", ["-tzvf", tarball], { encoding: "utf8" }).split("\n").filter(Boolean);
      const files = list.map((line) => {
        const parts = line.trim().split(/\s+/);
        return { size: Number(parts[4]), path: parts.slice(8).join(" ").replace(/^package\//, "") };
      }).filter((file) => !file.path.endsWith("/"));
      const paths = new Set(files.map((file) => file.path));
      for (const file of files) for (const pattern of FORBIDDEN) if (pattern.test(file.path)) fail(name, `the tarball contains ${file.path}`);
      for (const needed of ["package.json", "LICENSE", "README.md"]) if (!paths.has(needed)) fail(name, `the tarball has no ${needed}`);
      for (const file of files) if (!/^(dist\/|package\.json$|LICENSE$|README\.md$|CHANGELOG\.md$)/.test(file.path)) fail(name, `the tarball contains ${file.path}, outside the "files" list`);

      // The manifest as published: no workspace ranges, every export inside the tarball.
      const unpacked = join(out, "unpacked");
      execFileSync("mkdir", ["-p", unpacked]);
      execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
      const packed = readJson(join(unpacked, "package", "package.json"));
      for (const field of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"]) {
        for (const [dep, range] of Object.entries(packed[field] ?? {})) {
          if (/workspace:|^(link|file|portal):/.test(range)) fail(name, `the packed ${field}.${dep} is "${range}"`);
          if (dep.startsWith("@pli.dev/") && !/^\^?\d+\.\d+\.\d+/.test(range)) fail(name, `the packed ${field}.${dep} is "${range}", not a version`);
        }
      }
      if (typeof packed.exports?.["."] === "string" || /\/src\//.test(JSON.stringify(packed.exports))) fail(name, "the packed package.json still exports source");
      if (!packed.main || !packed.module || !packed.types) fail(name, "the packed package.json has no main/module/types");
      const targets = [];
      const collect = (value) => (typeof value === "string" ? targets.push(value.replace(/^\.\//, "")) : Object.values(value).forEach(collect));
      for (const value of Object.values(packed.exports)) collect(value);
      for (const target of targets) if (!paths.has(target)) fail(name, `the packed exports point at ${target}, which is not in the tarball`);

      if (existsSync(join(root, "node_modules/.bin/publint"))) {
        try {
          execFileSync(join(root, "node_modules/.bin/publint"), ["run", join(unpacked, "package"), "--strict"], { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
        } catch (error) {
          fail(name, `publint: ${(error.stdout || error.stderr || error.message).toString().trim().split("\n").filter((line) => !/^Running publint/.test(line)).join(" | ")}`);
        }
      }

      const total = statSync(tarball).size;
      const unpackedSize = files.reduce((sum, file) => sum + file.size, 0);
      sizes.push({ name, files: files.length, tarball: total, unpacked: unpackedSize });
      if (verbose) {
        console.log(`\n${name}: ${files.length} files, ${formatBytes(total)} packed, ${formatBytes(unpackedSize)} unpacked`);
        for (const file of files) console.log(`  ${formatBytes(file.size).padStart(10)}  ${file.path}`);
      }
      if (total > 6 * 1048576) warn(name, `the tarball is ${formatBytes(total)}`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
} else if (pack) {
  warnings.push("packing was skipped because of the problems above");
}

// --- Report -------------------------------------------------------------------------------------------------------------------------
if (sizes.length) {
  console.log("Package".padEnd(26) + "files".padStart(7) + "packed".padStart(12) + "unpacked".padStart(12));
  for (const size of sizes) console.log(size.name.padEnd(26) + String(size.files).padStart(7) + formatBytes(size.tarball).padStart(12) + formatBytes(size.unpacked).padStart(12));
}
for (const message of warnings) console.warn(`warning  ${message}`);
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const message of problems) console.error(`  ✗ ${message}`);
  process.exit(1);
}
console.log(`\nChecked ${publicPackages.length} packages${pack ? " and their tarballs" : ""}: ready to publish.`);
