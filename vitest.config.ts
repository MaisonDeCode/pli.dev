import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));

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
  },
});
