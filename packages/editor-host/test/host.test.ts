import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const built = resolve(here, "../dist/pli-editor.html");

beforeAll(() => {
  // Build the page the tests look at, so they always test what ships.
  execFileSync("node", [resolve(here, "../scripts/build.mjs")], { stdio: "pipe" });
});

describe("the editor page for web views", () => {
  const html = () => readFileSync(built, "utf8");

  it("is one file with nothing to fetch", () => {
    const page = html();
    expect(page).not.toMatch(/<script[^>]+src=/i);
    expect(page).not.toMatch(/<link[^>]+href=/i);
    expect(page).not.toMatch(/https?:\/\/[^"'\s)]+\.(js|css|woff2?)\b/i);
    expect(page.length).toBeLessThan(2 * 1024 * 1024);
  });

  it("has the interface the apps call, and tells the app when it is ready", () => {
    const page = html();
    for (const word of ["pliHost", "messageHandlers", "PliAndroid", "exportDocx", "exportMarkdown", "pli.doc"]) expect(page, word).toContain(word);
  });

  it("is the copy that each package ships", () => {
    for (const copy of ["packages/swift/Sources/Pli/Resources/pli-editor.html", "packages/kotlin-android/src/main/assets/pli-editor.html"]) {
      expect(readFileSync(resolve(root, copy), "utf8") === html(), `${copy} is out of date: run \`pnpm native\``).toBe(true);
    }
  });
});
