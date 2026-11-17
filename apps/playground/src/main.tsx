import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@pli.dev/react/styles.css";
import "@pli.dev/sheets-react/styles.css";
import "@pli.dev/decks-react/styles.css";
import "@pli.dev/pdf-react/styles.css";
import "./app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
