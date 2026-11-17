import { definePackage } from "../../scripts/tsup-shared";

export default definePackage({ entry: { index: "src/index.ts", pdfjs: "src/pdfjs.ts", testing: "src/testing.ts" }, css: "src/styles.css", cssBase: "../react/dist/styles.css" });
