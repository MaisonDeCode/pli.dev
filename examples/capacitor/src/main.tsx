import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import "@pli.dev/react/styles.css";
import "./app.css";
import { App } from "./App";

// On iPhone the keyboard has a bar of arrows and Done above it for web pages. The editor has its own toolbar there, so hide it.
if (Capacitor.getPlatform() === "ios") void Keyboard.setAccessoryBarVisible({ isVisible: false });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
