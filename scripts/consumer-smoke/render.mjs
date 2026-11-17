// The React editors, rendered on the server with react-dom, and then mounted in jsdom.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createDoc, heading, paragraph, DocumentSession } from "@pli.dev/docs";
import { PliDocument } from "@pli.dev/react";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "@pli.dev/sheets-react";
import { DeckSession, createDeck } from "@pli.dev/decks";
import { PliDeck } from "@pli.dev/decks-react";
import { openPdf, makeSamplePdf } from "@pli.dev/pdf";
import { PliPdf } from "@pli.dev/pdf-react";
import { fakeRenderer } from "@pli.dev/pdf-react/testing";

const documentSession = new DocumentSession(createDoc("Smoke", [heading(1, "Hello"), paragraph("World")]));
const sheetSession = new SheetSession(createWorkbook("Budget"));
sheetSession.setValues("Sheet1", "A1", [["Item", "Cost"], ["Pens", 12.5]]);
const deckSession = new DeckSession(createDeck({ title: "Launch plan" }));
const pdfSession = await openPdf(await makeSamplePdf(), { name: "sample.pdf" });

const editors = {
  documents: createElement(PliDocument, { session: documentSession }),
  sheets: createElement(PliSheet, { session: sheetSession }),
  decks: createElement(PliDeck, { session: deckSession }),
  pdf: createElement(PliPdf, { session: pdfSession, renderer: fakeRenderer() }),
};

for (const [name, element] of Object.entries(editors)) {
  const html = renderToString(element);
  assert.ok(html.length > 500, `${name}: the editor rendered ${html.length} characters`);
  console.log(`server render ${name}: ${html.length} characters`);
}

// In a DOM: mount each editor, let it settle, and look for its text.
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><div id=root></div>", { pretendToBeVisual: true, url: "http://localhost/" });
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis) && key !== "window" && key !== "document") Object.defineProperty(globalThis, key, { get: () => dom.window[key], configurable: true });
}
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
for (const [name, element] of Object.entries(editors)) {
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  assert.ok(host.innerHTML.length > 500, `${name}: mounted ${host.innerHTML.length} characters`);
  console.log(`dom render ${name}: ${host.innerHTML.length} characters`);
  await act(async () => root.unmount());
}
console.log("render ok");
