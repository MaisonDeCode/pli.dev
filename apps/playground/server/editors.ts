import { EditorRegistry, type EditorDefinition } from "@pli.dev/core";
import { docSyncModel, type Doc, type DocOp } from "@pli.dev/docs";
import { createWorkbook, sheetSyncModel, type Workbook, type SheetOp } from "@pli.dev/sheets";
import { createDeck, deckSyncModel, type Deck, type DeckOp } from "@pli.dev/decks";
import { emptyDoc as emptyPdf, pdfSyncModel, type PdfDoc, type PdfOp } from "@pli.dev/pdf";
import { labDocument } from "../src/collab/starter";

/**
 * The editors the playground's server knows: one definition per kind, naming how its operations merge (`model`) and how to
 * make a file nobody has opened yet (`create`). A room named `sheet:budget` is served by the `sheet` definition; add your own
 * editor by registering one more.
 *
 * The model is the same object a browser's `SyncClient` uses (`editorSession.model`), so the server and the clients always
 * merge the same way.
 */
export function defaultEditors(): EditorRegistry {
  const document: EditorDefinition<Doc, DocOp> = { kind: "document", model: docSyncModel, create: () => labDocument() };
  const sheet: EditorDefinition<Workbook, SheetOp> = {
    kind: "sheet",
    model: sheetSyncModel,
    create: (room) => createWorkbook(room),
  };
  const deck: EditorDefinition<Deck, DeckOp> = {
    kind: "deck",
    model: deckSyncModel,
    create: () => createDeck(),
  };
  const pdf: EditorDefinition<PdfDoc, PdfOp> = {
    kind: "pdf",
    model: pdfSyncModel,
    create: (room) => emptyPdf(room),
  };
  return new EditorRegistry([document, sheet, deck, pdf]);
}
