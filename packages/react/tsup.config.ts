import { definePackage } from "../../scripts/tsup-shared";

export default definePackage({ entry: { index: "src/index.ts", collab: "src/collab.ts" }, css: "src/styles.css", tsconfig: "tsconfig.json" });
