import "./polyfills";
import { pdfEditor } from "./editors/pdf";
import { makeBridge } from "./runtime";

/** The PDF engine for Swift and Kotlin: the same interface as the other editors (see `runtime.ts`), with PDFs. */
const Pli = makeBridge([pdfEditor], { version: "0.0.0" });
(globalThis as { Pli?: typeof Pli }).Pli = Pli;
