import "./polyfills";
import { decksEditor } from "./editors/decks";
import { makeBridge } from "./runtime";

/** The Decks engine for Swift and Kotlin: the same interface as the other editors (see `runtime.ts`), with decks. */
const Pli = makeBridge([decksEditor], { version: "0.0.0" });
(globalThis as { Pli?: typeof Pli }).Pli = Pli;
