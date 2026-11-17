// Runs before `pnpm pack` and `pnpm publish` (the packages' "prepack" script): a package is never packed without its build.
import { existsSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const needed = Object.values(manifest.publishConfig?.exports ?? {}).flatMap((entry) => (typeof entry === "string" ? [entry] : [entry.types, entry.import])).filter((path) => path.startsWith("./dist/"));
const missing = needed.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`${manifest.name}: the build is missing ${missing.join(", ")}. Run "pnpm build" first.`);
  process.exit(1);
}
