import { lazy, Suspense, useEffect } from "react";
import { Basics } from "./basics/Basics";
import { CollabLab } from "./collab/CollabLab";
import { demoById } from "./demos";
import { DecksDemo } from "./decks/DecksDemo";
import { Embed } from "./embed/Embed";
import { Landing } from "./Landing";

import { SheetsDemo } from "./sheets/SheetsDemo";
import { useRoute } from "./router";

// pdf.js and the PDF editor are loaded only when their screen is opened.
const PdfDemo = lazy(() => import("./pdf/PdfDemo").then((m) => ({ default: m.PdfDemo })));

/** The playground: a landing page, and one screen for each thing there is to try. */
export function App() {
  const route = useRoute();
  useEffect(() => {
    const demo = route && demoById(route);
    document.title = demo ? `${demo.title} · Pli playground` : "Pli playground";
  }, [route]);

  switch (route) {
    case "basics":
      return <Basics />;
    case "collaboration":
      return <CollabLab />;
    case "sheets":
      return <SheetsDemo />;
    case "decks":
      return <DecksDemo />;
    case "embed":
      return <Embed />;
    case "pdf":
      return (
        <Suspense fallback={<p className="pdf-demo-loading">Loading the PDF editor…</p>}>
          <PdfDemo />
        </Suspense>
      );
    default:
      return <Landing />;
  }
}
