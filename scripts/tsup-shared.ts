import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { defineConfig, type Options } from "tsup";

/**
 * The build every published package shares: one ES module per entry point (plus shared chunks), a declaration file for each,
 * and the stylesheet with its `@import`s inlined. Dependencies and peer dependencies stay imports; nothing is bundled in.
 *
 * `entry` maps the file name in `dist` to its source; `css` is the stylesheet source, if the package has one. `cssBase` is another
 * package's built stylesheet to put in front of it: the editors for sheets, decks and PDFs use the toolbar, menus and colour pickers of
 * `@pli.dev/react`, so their `styles.css` carries those and a person who installs one editor imports one stylesheet.
 */
export function definePackage({ entry, css, cssBase, tsconfig = "tsconfig.json" }: { entry: Record<string, string>; css?: string; cssBase?: string; tsconfig?: string }) {
  // tsup's own `clean` would race between the two builds below.
  rmSync("dist", { recursive: true, force: true });

  const base: Options = { tsconfig, outDir: "dist", target: "es2022", platform: "neutral", sourcemap: false, clean: false };
  return defineConfig([
    { ...base, entry, format: ["esm"], dts: true, splitting: true, treeshake: true, minify: false, outExtension: () => ({ js: ".js" }) },
    ...(css
      ? [
          {
            ...base,
            entry: { styles: css },
            format: ["esm" as const],
            dts: false,
            minify: false,
            onSuccess: async () => {
              if (!cssBase) return;
              if (!existsSync(cssBase)) throw new Error(`${cssBase} is not built yet: build @pli.dev/react first`);
              writeFileSync("dist/styles.css", `${readFileSync(cssBase, "utf8").trimEnd()}\n\n${readFileSync("dist/styles.css", "utf8")}`);
            },
          },
        ]
      : []),
  ]);
}
