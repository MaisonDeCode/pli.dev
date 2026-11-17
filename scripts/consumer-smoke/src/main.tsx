import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocumentSession, createDoc, heading, paragraph } from "@pli.dev/docs";
import { PliDocument } from "@pli.dev/react";
import "@pli.dev/react/styles.css";
import { SheetSession, createWorkbook } from "@pli.dev/sheets";
import { PliSheet } from "@pli.dev/sheets-react";
import "@pli.dev/sheets-react/styles.css";
import { DeckSession, createDeck } from "@pli.dev/decks";
import { PliDeck } from "@pli.dev/decks-react";
import "@pli.dev/decks-react/styles.css";
import { PliPdf } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
import "@pli.dev/pdf-react/styles.css";
import { makeSamplePdf, openPdf, type PdfSession } from "@pli.dev/pdf";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

const documentSession = new DocumentSession(createDoc("Smoke", [heading(1, "Hello"), paragraph("World")]));
const sheetSession = new SheetSession(createWorkbook("Budget"));
const deckSession = new DeckSession(createDeck({ title: "Launch plan" }));
const renderer = pdfjsRenderer({ workerSrc });

function App() {
  const [pdf, setPdf] = useState<PdfSession | null>(null);
  useEffect(() => { void makeSamplePdf().then((bytes) => openPdf(bytes, { name: "sample.pdf" })).then(setPdf); }, []);
  return (
    <>
      <PliDocument session={documentSession} />
      <PliSheet session={sheetSession} />
      <PliDeck session={deckSession} />
      {pdf ? <PliPdf session={pdf} renderer={renderer} /> : null}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
