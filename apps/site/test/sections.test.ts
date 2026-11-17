import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The five landing sections (Proof, Collaboration, FontsAndFormats, Backend, SdkCode): what they say has to be true. These checks read
 * the .astro sources, compare their facts with the packages and the docs, and, when a build exists, read the built page.
 */
const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(SITE, "..", "..");
const read = (path: string) => readFileSync(path, "utf8");
const SECTIONS = {
  Proof: { id: "proof" },
  Collaboration: { id: "collaboration" },
  FontsAndFormats: { id: "fonts-and-formats" },
  Backend: { id: "backend" },
  SdkCode: { id: "sdk" },
} as const;
const source = (name: string) => read(join(SITE, "src/components/marketing", `${name}.astro`));

function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "build") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, match, out);
    else if (match(path)) out.push(path);
  }
  return out;
}

/** A route exists when there is a docs page or an Astro page for it. */
function routeExists(route: string): boolean {
  const path = route.replace(/^\/|\/$/g, "");
  if (path === "") return existsSync(join(SITE, "src/pages/index.astro"));
  const docs = join(SITE, "src/content/docs", path);
  if (["md", "mdx"].some((ext) => existsSync(`${docs}.${ext}`) || existsSync(join(docs, `index.${ext}`)))) return true;
  return existsSync(join(SITE, "src/pages", `${path}.astro`)) || existsSync(join(SITE, "src/pages", path, "index.astro"));
}

describe("each section", () => {
  for (const [name, { id }] of Object.entries(SECTIONS)) {
    describe(name, () => {
      const src = source(name);
      it("is a real section: an id, a labelled heading, the shared container", () => {
        expect(src).not.toContain("Stub until");
        expect(src).toMatch(new RegExp(`<section class="pli-section[^"]*" id="${id}" aria-labelledby="[a-z-]+"`));
        expect(src).toMatch(/<h2 class="pli-h2" id="[a-z-]+"/);
        expect(src).toContain('class="pli-container"');
        expect(src).toContain("data-reveal");
      });
      it("invents no GitHub address (the repository has none to point at)", () => {
        expect(src.toLowerCase()).not.toContain("github.com");
      });
      it("only links to pages that exist", () => {
        const hrefs = [...src.matchAll(/href[=:]\s*"(\/[^"#]*)"/g)].map((m) => m[1]!);
        for (const href of hrefs) expect(routeExists(href), `${name} links to ${href}`).toBe(true);
      });
      it("moves only transform and opacity, and keyframes sit inside the reduced-motion guard", () => {
        // Every @keyframes is written after a "prefers-reduced-motion:no-preference" opening in the same file.
        const guard = src.search(/prefers-reduced-motion:\s*no-preference/);
        const first = src.search(/@keyframes/);
        if (first !== -1) expect(guard).toBeGreaterThan(-1);
        if (first !== -1 && name !== "Collaboration" && name !== "Backend") expect(first).toBeGreaterThan(guard);
        for (const m of src.matchAll(/@keyframes[^{]+\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
          const props = [...m[1]!.matchAll(/([a-z-]+)\s*:/g)].map((p) => p[1]);
          for (const p of props) expect(["transform", "opacity", "animation-timing-function"], `${name} animates ${p}`).toContain(p);
        }
      });
    });
  }
  it("the generated keyframes (Collaboration, Backend) are written inside the guard", () => {
    for (const name of ["Collaboration", "Backend"]) {
      const src = source(name);
      expect(src).toMatch(/`@media \(prefers-reduced-motion:no-preference\)\{`/);
      expect(src).toContain("is:inline set:html");
    }
  });
});

describe("Proof", () => {
  const src = source("Proof");
  it("counts what can be counted", async () => {
    const { functionCatalog } = await import("@pli.dev/sheets");
    const functions = Number(/const FUNCTIONS = (\d+)/.exec(src)![1]);
    expect(functions).toBe(functionCatalog().length);

    const tests = Number(/const TESTS = (\d+)/.exec(src)![1]);
    let found = 0;
    const files = [...walk(join(ROOT, "packages"), (f) => /\.test\.tsx?$/.test(f)), ...walk(join(ROOT, "apps"), (f) => /\.test\.tsx?$/.test(f))];
    for (const file of files) found += (read(file).match(/^\s*(it|test)(\.each\([^)]*\))?\(/gm) ?? []).length;
    expect(tests % 100).toBe(0);
    expect(found, "claimed as 'over N tests'").toBeGreaterThanOrEqual(tests);
  }, 60_000);
  it("shows the four editors that exist, from PRODUCTS", async () => {
    const { PRODUCTS } = await import("../src/products");
    for (const name of ["Documents", "Sheets", "Decks", "PDF"]) expect(PRODUCTS.some((p) => p.name === name)).toBe(true);
    expect(src).toContain("PRODUCTS.filter");
    expect(src).toContain('data-count-to="4"');
  });
  it("names only formats and platforms the docs support", () => {
    for (const f of ["DOCX", "XLSX", "PPTX", "PDF", "CSV", "Markdown", "HTML", "JSON"]) expect(src).toContain(`"${f}"`);
    expect(src).toContain('data-count-to="8"');
    expect(src).toContain('data-count-to="3"');
    for (const word of ["Capacitor", "Node", "Socket.io", "WebSocket", "Redis", "pdf.js"]) {
      const docs = walk(join(SITE, "src/content/docs"), (f) => /\.mdx?$/.test(f)).some((f) => read(f).includes(word));
      expect(docs, `${word} appears in the docs`).toBe(true);
    }
    expect(src.replace(/^---[\s\S]*?\n---/, "")).not.toMatch(/trusted by|testimonial|github stars|weekly downloads|our customers/i);
  });
});

describe("Collaboration", () => {
  it("links each block to a platform page that exists, and says what the docs say", () => {
    const src = source("Collaboration");
    for (const slug of ["comments", "users", "live-editing", "versions", "collaboration"]) {
      expect(src).toContain(`/platform/${slug}/`);
      expect(existsSync(join(SITE, "src/content/docs/platform", `${slug}.md`))).toBe(true);
    }
    expect(src).toContain("@pli.dev/core");
  });
});

describe("FontsAndFormats", () => {
  const src = source("FontsAndFormats");
  it("draws the twelve built-in deck themes with their real colours and fonts", async () => {
    const { BUILTIN_THEMES } = await import("@pli.dev/decks");
    const block = /const themes = \[([\s\S]*?)\n\];/.exec(src)![1]!;
    const drawn = [...block.matchAll(/\{ id: "([^"]+)", name: "([^"]+)", bg: "([^"]+)", ink: "([^"]+)", ink2: "([^"]+)", soft: "([^"]+)", a: \["([^"]+)", "([^"]+)", "([^"]+)"\], major: "([^"]+)", minor: "([^"]+)" \}/g)];
    expect(drawn).toHaveLength(BUILTIN_THEMES.length);
    BUILTIN_THEMES.forEach((t, i) => {
      const [, id, name, bg, ink, ink2, soft, a1, a2, a3, major, minor] = drawn[i]!;
      const c = t.theme.colors;
      expect({ id, name, bg, ink, ink2, soft, a: [a1, a2, a3], major, minor }).toEqual({
        id: t.id, name: t.name, bg: c.lt1, ink: c.dk1, ink2: c.dk2, soft: c.lt2, a: [c.accent1, c.accent2, c.accent3], major: t.theme.fonts.major, minor: t.theme.fonts.minor,
      });
    });
  });
  it("shows the font loader code from the docs, with names that exist", async () => {
    const core = await import("@pli.dev/core");
    expect(typeof core.createFonts).toBe("function");
    expect(typeof core.setDefaultFonts).toBe("function");
    expect(src).toContain('setDefaultFonts(createFonts({ only: ["Calibri", "Arial", "Georgia", "Inter", "Lora", "Roboto Mono"] }));');
    expect(read(join(SITE, "src/content/docs/platform/fonts.md"))).toContain('setDefaultFonts(createFonts({ only: ["Calibri", "Arial", "Georgia", "Inter", "Lora", "Roboto Mono"] }));');
    // Every family named in the band is in the catalogue (Office fonts and Google's), so the band shows real choices.
    const catalogue = core.defaultFonts();
    const names = [...src.matchAll(/\{ name: "([^"]+)", stack:/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) expect(catalogue.find(name), `${name} is in the catalogue`).toBeTruthy();
    expect(catalogue.search({}).length).toBeGreaterThan(2000);
  });
  it("lists only formats the docs say are supported, with the right direction", () => {
    const rows = [...src.matchAll(/\{ ext: "([A-Z]+)", name: "[^"]+", mode: "([^"]+)", by: "([^"]+)"/g)].map((m) => ({ ext: m[1], mode: m[2], by: m[3] }));
    expect(rows.map((r) => r.ext)).toEqual(["DOCX", "XLSX", "PPTX", "PDF", "CSV", "MD", "HTML", "JSON"]);
    expect(rows.find((r) => r.ext === "HTML")!.mode).toBe("Write");
    const docs = (p: string) => read(join(SITE, "src/content/docs", p));
    expect(docs("documents/guides/importing.md")).toContain("fromDocx");
    expect(docs("documents/guides/exporting.md")).toContain("toDocx");
    expect(docs("documents/guides/exporting.md")).toContain("toHtml");
    expect(docs("documents/guides/agent-skill.md")).toContain("fromMarkdown");
    expect(docs("sheets/files.md")).toMatch(/fromCsv[\s\S]*toCsv/);
    expect(docs("sheets/index.mdx")).toContain("XLSX");
    expect(docs("decks/files.md")).toMatch(/toPptx[\s\S]*fromPptx/);
    expect(docs("pdf/index.mdx")).toContain("saves it again as a real PDF");
  });
});

describe("Backend", () => {
  const src = source("Backend");
  it("names only interfaces that exist in @pli.dev/core, and only the ones the docs describe", async () => {
    const core = read(join(ROOT, "packages/core/src/index.ts"));
    for (const name of ["Users", "CommentStore", "Transport", "StorageAdapter", "StorageClient", "createAuthority", "DocumentStore"]) {
      expect(core, name).toMatch(new RegExp(`\\b${name}\\b`));
    }
    for (const iface of ["CommentStore", "Transport", "StorageAdapter", "Users"]) expect(src).toContain(`"${iface}"`);
    expect(src).toContain("createAuthority");
    expect(read(join(SITE, "src/content/docs/platform/realtime.md"))).toMatch(/interface Transport \{[\s\S]*connect[\s\S]*send[\s\S]*disconnect/);
  });
  it("has an accessible name on both drawings and a visible text version of the same facts", () => {
    expect((src.match(/role="img" aria-label=\{label\}/g) ?? []).length).toBe(2);
    expect(src).toContain('class="cards"');
    expect(src).toMatch(/never opens a connection of its own and never stores anything/);
    // The docs make this claim (platform/live-editing.md), so the page may.
    expect(read(join(SITE, "src/content/docs/platform/live-editing.md"))).toContain("Pli never opens a connection of its own, and never stores anything");
  });
});

describe("SdkCode", () => {
  const src = source("SdkCode");
  const snippet = (name: string) => new RegExp(`const ${name} = \`([\\s\\S]*?)\``).exec(src)![1]!;
  it("has tabs that need no script: radios, labels and :checked", () => {
    expect(src).toContain('type="radio" name="sdk-lang"');
    for (const id of ["react", "swift", "kotlin", "node"]) expect(src).toContain(`#sdk-r-${id}:checked`);
    expect(src).toContain('import { Code } from "astro:components"');
    expect(src).toMatch(/data-copy hidden/);
  });
  it("shows React code whose names exist", async () => {
    const code = snippet("react");
    const react = await import("../../../packages/react/src/index");
    expect(typeof react.PliDocument).toBe("function");
    expect(typeof react.useDocumentSession).toBe("function");
    expect(code).toContain('import { PliDocument, useDocumentSession } from "@pli.dev/react";');
    expect(JSON.parse(read(join(ROOT, "packages/react/package.json"))).exports["./styles.css"]).toBeTruthy();
    expect(read(join(ROOT, "packages/react/src/PliDocument.tsx"))).toMatch(/autoFocus\?: boolean/);
    expect(read(join(SITE, "src/content/docs/documents/ready-made-ui.md"))).toContain(code.split("\n").slice(0, 3).join("\n"));
  });
  it("shows Swift and Kotlin code whose views exist in the packages", () => {
    expect(snippet("swift")).toContain("PliEditor(json: $document)");
    expect(read(join(ROOT, "packages/swift/Sources/Pli/PliEditorView.swift"))).toMatch(/public struct PliEditor: View/);
    expect(read(join(ROOT, "packages/swift/Sources/Pli/PliEditorView.swift"))).toMatch(/init\(json: Binding<String>/);
    expect(snippet("kotlin")).toContain("onJsonChange");
    expect(read(join(ROOT, "packages/kotlin-android/src/main/kotlin/dev/pli/PliEditor.kt"))).toMatch(/fun PliEditor\(json: String, onJsonChange: \(String\) -> Unit, modifier: Modifier = Modifier/);
  });
  it("shows Node code that runs against @pli.dev/docs", async () => {
    const docs = (await import("@pli.dev/docs")) as Record<string, unknown>;
    for (const name of ["DocumentSession", "createDoc", "heading", "paragraph", "bold", "toMarkdown", "toDocx"]) expect(typeof docs[name], name).toBe("function");
    const { DocumentSession, createDoc, heading, paragraph, bold, toMarkdown, toDocx } = docs as any;
    const intro = paragraph(["Pli is ", bold("headless"), "."]);
    const session = new DocumentSession(createDoc("My first doc", [heading(1, "Hello"), intro]));
    session.insertText(intro.id, 0, "Note: ");
    session.undo();
    expect(toMarkdown(session.state)).toContain("Pli is **headless**.");
    expect(toDocx(session.state)).toBeInstanceOf(Uint8Array);
    expect(snippet("node")).toContain("session.insertText(intro.id, 0, \"Note: \");");
  });
  it("says the JavaScript packages are on npm, with install lines for packages that exist, and links the install pages", () => {
    expect(src).toContain("The JavaScript packages are on npm.");
    expect(src).not.toMatch(/published yet|not published|isn't published/i);
    const lines = [...src.matchAll(/npm install ((?:@pli\.dev\/[a-z-]+ ?)+)/g)].map((m) => m[1]!.trim().split(" "));
    expect(lines).toContainEqual(["@pli.dev/docs", "@pli.dev/react"]);
    for (const name of lines.flat()) {
      const pkg = JSON.parse(read(join(ROOT, "packages", name.replace("@pli.dev/", ""), "package.json")));
      expect(pkg.name).toBe(name);
      expect(pkg.private, `${name} is public`).not.toBe(true);
    }
    // Swift and Kotlin are used from a clone: no invented registry address.
    expect(src).toContain("packages/swift");
    expect(src).toContain("packages/kotlin-android");
    expect(src).not.toMatch(/maven|mavenCentral|swiftpackageindex/i);
    expect(src).toContain("/introduction/");
    expect(src).toContain("/documents/swift/");
    expect(src).toContain("/documents/kotlin/");
  });
});

describe("Hero and Cta", () => {
  const hero = source("Hero");
  it("puts the npm install command in the hero, with a copy button that copies exactly it", () => {
    expect(hero).toContain('const install = "npm install @pli.dev/docs @pli.dev/react";');
    expect(hero).toContain("data-copy={install}");
    expect(hero).toContain("<span class=\"p\">$</span> npm install @pli.dev/docs @pli.dev/react</code>");
    expect(hero).not.toMatch(/pnpm install|pnpm playground|Not on npm|aren't published|from the repository/i);
  });
  it("ends with a plain statement about the licence and npm", () => {
    const cta = source("Cta");
    expect(cta).toContain("Open source under the Apache License 2.0. Install the packages from npm, under the @pli.dev scope.");
    expect(cta).not.toMatch(/aren't on npm|not on npm|run them from the repository/i);
  });
});

describe("the built page", () => {
  const built = join(process.env.SITE_DIST ?? join(SITE, "dist"), "index.html");
  const html = existsSync(built) ? read(built) : "";
  const hasSections = html.includes('id="sdk"');
  (hasSections ? it : it.skip)("contains every section, in order, with no JavaScript needed for the content", () => {
    const at = Object.values(SECTIONS).map(({ id }) => html.indexOf(`id="${id}"`));
    expect(at.every((n) => n > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(html).toContain("data-count-to=\"475\"");
    expect(html).toContain(">475<");
    expect(html).toContain('class="astro-code');
    // The repository address the owner gave is the only GitHub address on the page.
    expect(html.toLowerCase().replaceAll("https://github.com/maisondecode/pli.dev", "")).not.toContain("github.com");
    expect(html).toContain("https://github.com/MaisonDeCode/pli.dev");
    expect(html).toContain("https://maisondecode.com");
  });
});

describe("the Contributing section of the platform docs", () => {
  const dir = join(SITE, "src/content/docs/platform/contributing");
  const pages = { index: "Contributing", setup: "Setting up and running", "working-on-pli": "Working on Pli itself", releases: "Releases and versioning", "bugs-and-changes": "Reporting bugs and proposing changes" };

  it("has its five pages, in order, with the titles the sidebar shows", () => {
    const orders: number[] = [];
    for (const [slug, title] of Object.entries(pages)) {
      const text = read(join(dir, `${slug}.md`));
      expect(text).toMatch(new RegExp(`^---\\ntitle: ${title}\\n`));
      orders.push(Number(/sidebar:\n\s+order: (\d+)/.exec(text)?.[1]));
    }
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });

  it("is reachable from the footer, the root README and CONTRIBUTING.md, and the old page addresses are gone", () => {
    expect(read(join(SITE, "src/components/marketing/Footer.astro"))).toContain('{ label: "Contributing", href: "/platform/contributing/" }');
    for (const file of ["README.md", "CONTRIBUTING.md"]) expect(read(join(ROOT, file))).toContain("https://pli.dev/platform/contributing/");
    expect(existsSync(join(ROOT, "CODE_OF_CONDUCT.md"))).toBe(true);
    expect(existsSync(join(SITE, "src/content/docs/platform/releases.md"))).toBe(false);
    expect(existsSync(join(SITE, "src/content/docs/platform/contributing.md"))).toBe(false);
  });

  it("says only things that are true of the repository: the commands exist and the paths it names are there", () => {
    const scripts = JSON.parse(read(join(ROOT, "package.json"))).scripts as Record<string, string>;
    const text = Object.keys(pages).map((slug) => read(join(dir, `${slug}.md`))).join("\n");
    for (const [, command] of text.matchAll(/`pnpm (?:run )?([a-z][\w:-]*)/g)) {
      if (["install", "add", "vitest", "--filter", "ios", "android", "pack", "publish"].includes(command!)) continue;
      expect(scripts, `pnpm ${command}`).toHaveProperty(command!);
    }
    for (const path of ["scripts/check-publish.mjs", "scripts/smoke-consumer.mjs", "scripts/generate-font-catalogue.mjs", "scripts/capture-clipboard.swift", "packages/pdf/scripts/pdfcheck.py", "packages/sheets/src/functions", "packages/decks/src/themes.ts", "packages/pdf-react/src/annotTools.tsx", "packages/core/src/fonts/office.ts", "packages/sheets/test/excel-check", ".changeset/config.json", ".github/workflows/release.yml", "RELEASING.md"]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
  });
});
