import "./polyfills";
import { sheetsEditor } from "./editors/sheets";
import { makeBridge } from "./runtime";

/** The Sheets engine for Swift and Kotlin: the same interface as the other editors (see `runtime.ts`), with workbooks. */
const Pli = makeBridge([sheetsEditor], { version: "0.0.0" });
(globalThis as { Pli?: typeof Pli }).Pli = Pli;
