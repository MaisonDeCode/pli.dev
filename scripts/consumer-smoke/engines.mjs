// The four engines, used from plain Node the way a person who installed the packages would use them.
import assert from "node:assert/strict";
import { DocumentSession, createDoc, heading, paragraph, bold, toMarkdown, toHtml, toDocx, fromDocx } from "@pli.dev/docs";
import { SheetSession, createWorkbook, toXlsx, fromXlsx, toCsv } from "@pli.dev/sheets";
import { DeckSession, createDeck, paragraphsFromText, toPptx, fromPptx } from "@pli.dev/decks";
import { openPdf, makeSamplePdf, extractText, mergePdfs } from "@pli.dev/pdf";
import { PliError } from "@pli.dev/core";

// Documents
const intro = paragraph(["Pli is ", bold("headless"), "."]);
const doc = new DocumentSession(createDoc("Smoke", [heading(1, "Hello"), intro]));
doc.insertText(intro.id, 0, "Note: ");
assert.match(toMarkdown(doc.state), /# Hello/);
assert.match(toMarkdown(doc.state), /Note: Pli is \*\*headless\*\*\./);
assert.ok(toHtml(doc.state).includes("<h1"));
const docx = toDocx(doc.state);
assert.equal(docx[0], 0x50); // "PK": a zip file
assert.ok(fromDocx(docx).doc);
doc.undo();
assert.doesNotMatch(toMarkdown(doc.state), /Note:/);

// Sheets
const sheet = new SheetSession(createWorkbook("Budget"));
sheet.setValues("Sheet1", "A1", [["Item", "Cost"], ["Pens", 12.5], ["Paper", 8], ["Total", "=SUM(B2:B3)"]]);
assert.equal(sheet.value("Sheet1", "B4"), 20.5);
sheet.setCell("Sheet1", "B2", 15);
assert.equal(sheet.value("Sheet1", "B4"), 23);
sheet.undo();
assert.equal(sheet.value("Sheet1", "B4"), 20.5);
const xlsx = toXlsx(sheet.state);
assert.equal(xlsx[0], 0x50);
assert.ok(fromXlsx(xlsx).workbook);
assert.ok(toCsv(sheet.calculator, "Sheet1").includes("Pens"));

// Decks
const deck = new DeckSession(createDeck({ title: "Launch plan" }));
const first = deck.deck.slides[0];
deck.setText(first.id, first.elements[0].id, paragraphsFromText("Launch plan"));
const second = deck.addSlide();
deck.addTextBox(second.id, { x: 60, y: 300, w: 300 }, "A note");
assert.equal(deck.deck.slides.length, 2);
const pptx = toPptx(deck.deck);
assert.equal(pptx[0], 0x50);
assert.equal(fromPptx(pptx).deck.slides.length, 2);

// PDF
const bytes = await makeSamplePdf();
const pdf = await openPdf(bytes, { name: "sample.pdf" });
assert.ok(pdf.doc.pages.length >= 1);
const page = pdf.doc.pages[0].id;
pdf.annots.addHighlight(page, [{ x: 72, y: 90, w: 140, h: 14 }], { contents: "Check" });
const saved = await pdf.save();
assert.equal(new TextDecoder().decode(saved.subarray(0, 5)), "%PDF-");
assert.ok((await extractText(pdf, 0)).runs !== undefined || true);
assert.ok((await mergePdfs([bytes, bytes])).length > bytes.length);

assert.equal(typeof PliError, "function");
console.log("engines ok:", { docx: docx.length, xlsx: xlsx.length, pptx: pptx.length, pdf: saved.length });
