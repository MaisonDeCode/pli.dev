import { definePackage } from "../../scripts/tsup-shared";

export default definePackage({ entry: { index: "src/index.ts" }, tsconfig: "../../tsconfig.json" });
