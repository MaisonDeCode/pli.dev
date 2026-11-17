// Type-checked, not run: every public name has to resolve to a declaration.
import { DocumentSession, createDoc, type Doc } from "@pli.dev/docs";
import { PliDocument, useDocumentSession, type PliDocumentProps } from "@pli.dev/react";
import { useRoomPeers } from "@pli.dev/react/collab";
import { SheetSession, createWorkbook, type Workbook } from "@pli.dev/sheets";
import { PliSheet, type PliSheetProps } from "@pli.dev/sheets-react";
import { DeckSession, createDeck, type Deck } from "@pli.dev/decks";
import { PliDeck, type PliDeckProps } from "@pli.dev/decks-react";
import { openPdf, type PdfSession } from "@pli.dev/pdf";
import { PliPdf, type PliPdfProps } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
import { fakeRenderer } from "@pli.dev/pdf-react/testing";
import { PliError } from "@pli.dev/core";

export const used = [DocumentSession, createDoc, PliDocument, useDocumentSession, useRoomPeers, SheetSession, createWorkbook, PliSheet, DeckSession, createDeck, PliDeck, openPdf, PliPdf, pdfjsRenderer, fakeRenderer, PliError];
export type Used = [Doc, PliDocumentProps, Workbook, PliSheetProps, Deck, PliDeckProps, PdfSession, PliPdfProps];
const session: DocumentSession = new DocumentSession(createDoc("Types", []));
export const title: string = session.state.title;
