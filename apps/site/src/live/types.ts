import type { ReactNode } from "react";

export type LiveKind = "docs" | "sheets" | "decks" | "pdf";
export type LiveMode = "hero" | "story" | "product";

/** What `LiveEditor` hands each editor body (DocsLive, SheetsLive, DecksLive, PdfLive: the default export of each file). */
export interface LiveBodyProps {
  /** Which scripted state to show, 0..steps-1. The body must handle any change in either direction and end in the same state for the same step. */
  step: number;
  steps: number;
  /** True once the visitor clicked in to use the editor: stop scripting (ignore `step`), the document is theirs now. */
  interactive: boolean;
  /** The visitor prefers reduced motion: apply a step's result at once, no typing or drawing animation. */
  reducedMotion: boolean;
  mode: LiveMode;
  /** Call once, after the editor has painted its first usable frame. The poster fades out then. */
  onReady: () => void;
}

export interface LiveEditorProps {
  kind: LiveKind;
  mode: LiveMode;
  /** Story mode: the story's id and this editor's chapter (0-based). Editors for chapters farther than one away are not loaded. */
  story?: string;
  chapter?: number;
  /** Steps per chapter or per hero loop. Default 3. */
  steps?: number;
  /** Accessible name of the window, e.g. "A live Pli.Documents editor". */
  label?: string;
  /** The window's title bar text. */
  title?: string;
  /** The static poster (Poster.astro): shown first, on phones, with data saver, and if scripts fail. */
  children?: ReactNode;
}
