import { useState } from "react";
import {
  bold,
  code,
  codeBlock,
  createDoc,
  heading,
  image,
  italic,
  link,
  listItem,
  pageBreak,
  paragraph,
  quote,
  serializeDoc,
  subtitle,
  table,
  text,
  title,
  toHtml,
  toMarkdown,
  toc,
  Users,
  type Doc,
  type TableBlock,
} from "@pli.dev/docs";
import { PliDocument, useDocumentSession, useSessionRevision } from "@pli.dev/react";
import { demoStorage } from "../demo-storage";
import { ME, directory } from "../collab/people";
import { BackToDemos } from "../BackToDemos";

/** A small PNG drawn on the spot, so the demo has an image without shipping a file. */
function sampleImage(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 280;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const gradient = ctx.createLinearGradient(0, 0, 640, 280);
  gradient.addColorStop(0, "#4f46e5");
  gradient.addColorStop(1, "#ec4899");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 640, 280);
  ctx.fillStyle = "rgb(255 255 255 / 0.9)";
  ctx.font = "700 96px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Pli", 320, 175);
  return canvas.toDataURL("image/png");
}

const SENTENCES = [
  "Every edit is a small JSON operation, so history, export and scripting share one foundation.",
  "Pages are laid out by measuring the real text, so lines break where a printer would break them.",
  "The same engine runs in the browser today and inside native apps later.",
  "A table of contents is generated from the headings and stays current as you write.",
  "Headers and footers repeat on every page, and fields such as the page number update on their own.",
  "Select some text and try the toolbar, or use the keyboard shortcuts you already know.",
];

function filler(paragraphs: number, seed = 0): string[] {
  return Array.from({ length: paragraphs }, (_, i) =>
    Array.from({ length: 4 }, (_, j) => SENTENCES[(i + j + seed) % SENTENCES.length]).join(" "),
  );
}

function pricing() {
  const t = table(
    [
      ["Plan", "Seats", "Price", "Includes"],
      ["Starter", "1", "$0", "Documents and exports"],
      [[bold("Team")], "10", "$12 / seat", "Everything in Starter, plus shared drafts"],
      ["Business", "100", "$20 / seat", "Everything in Team, plus single sign-on"],
    ],
    { headerRow: true, columns: [2, 1, 2, 5] },
  );
  t.rows[2]!.cells[0]!.shade = "#fef3c7";
  return t;
}

/** Merges the given rectangles `[row, column, rows, columns]` the way the editor's Merge command does. */
function withMerges(t: TableBlock, merges: [number, number, number, number][]): TableBlock {
  const rows = t.rows.map((row) => ({ ...row, cells: row.cells.slice() }));
  for (const [row, col, rowSpan, colSpan] of merges) {
    const cell = rows[row]!.cells[col]!;
    rows[row]!.cells[col] = { ...cell, ...(rowSpan > 1 && { rowSpan }), ...(colSpan > 1 && { colSpan }) };
    for (let r = row; r < row + rowSpan; r++) {
      for (let c = col; c < col + colSpan; c++) {
        if (r !== row || c !== col) rows[r]!.cells[c] = { id: rows[r]!.cells[c]!.id, blocks: [], covered: true };
      }
    }
  }
  return { ...t, rows };
}

/** A schedule that uses merged cells, a tall row and vertical alignment. */
function schedule() {
  const t = table(
    [
      ["Q3 delivery plan", "", "", ""],
      ["Team", "Mon", "Tue", "Wed"],
      ["Design", "Kickoff", "Review", ""],
      ["", "Sketches", "Mockups", "Handoff"],
      ["Build", "Setup", "Sprint 1", ""],
      ["Total", "", "", "12 days"],
    ],
    { headerRow: true, columns: [2, 2, 2, 2] },
  );
  const merged = withMerges(t, [[0, 0, 1, 4], [2, 0, 2, 1], [4, 2, 1, 2], [5, 0, 1, 3]]);
  merged.rows[0]!.height = 30;
  merged.rows[2]!.cells[0]!.vAlign = "middle";
  merged.rows[2]!.cells[0]!.shade = "#e0f2fe";
  merged.rows[5]!.cells[0]!.shade = "#fef3c7";
  return merged;
}

function longTable() {
  return table(
    [
      ["#", "Item", "Status"],
      ...Array.from({ length: 28 }, (_, i) => [String(i + 1), `Line item ${i + 1}`, ["Done", "In progress", "Planned"][i % 3]!]),
    ],
    { headerRow: true, columns: [1, 5, 2] },
  );
}

export function starter(): Doc {
  const doc = createDoc("Pli product overview", [
    title("Pli product overview"),
    subtitle("A tour of the document editor"),
    toc(2),
    heading(1, "Introduction"),
    paragraph([
      "This is a ",
      bold("full document editor"),
      " built on the ",
      code("@pli.dev/docs"),
      " engine. It has pages, headers and footers, a table of contents, images and the formatting tools you expect. See the ",
      link("documentation", "https://pli.dev"),
      ".",
    ]),
    ...filler(3).map((t) => paragraph(t)),
    heading(2, "Things to try"),
    listItem("bullet", "Type, press Enter, and watch the page break move as you write"),
    listItem("bullet", "Select text and change its font, size or color", 1),
    listItem("ordered", "Double-click the header or footer to edit it"),
    listItem("ordered", "Use the Insert menu for images, page breaks and the table of contents"),
    listItem("ordered", "Switch to Pageless in the status bar for one continuous page"),
    { ...paragraph(["Tip: this paragraph uses a style called ", text("Note", { style: "key" }), ". Change it from Format > Your styles > Manage styles… and every paragraph that uses it follows."]), style: "note" },
    paragraph([
      "Ben suggested a change here: this sentence is ",
      text("now clearer", { suggest: { id: "demo-add", kind: "insert", by: "u_ben", at: Date.now() - 20 * 60_000 } }),
      text("hard to read", { suggest: { id: "demo-del", kind: "delete", by: "u_ben", at: Date.now() - 20 * 60_000 } }),
      ". Turn on ",
      bold("Suggesting"),
      " in the title bar to propose your own, and open the Suggestions panel to accept or reject.",
    ]),
    heading(1, "Working with images"),
    paragraph(["Images can be ", italic("dragged in, pasted, or uploaded"), ". Click one to select it, then drag a corner to resize it."]),
    image(sampleImage(), { width: 480, height: 210 }, { alt: "Pli logo", align: "center" }),
    ...filler(4, 2).map((t) => paragraph(t)),
    quote("A document is a story told in operations."),
    heading(1, "Tables"),
    paragraph(["Click in a table and press ", bold("Tab"), " to move between cells. Tab in the last cell adds a row. Drag a column border to resize, or drag across cells to select several."]),
    pricing(),
    paragraph(["Drag across cells and choose ", bold("Merge cells"), " in the table menu. Merged cells, tall rows and vertical alignment all survive export."]),
    schedule(),
    paragraph("Tables that run past the bottom of a page continue on the next one, one row at a time."),
    longTable(),
    pageBreak(),
    heading(1, "Layout and export"),
    ...filler(5, 4).map((t) => paragraph(t)),
    heading(2, "Code"),
    codeBlock('session.toggleMark("bold");', "ts"),
    heading(2, "Export formats"),
    paragraph("Download as PDF, DOCX, Markdown, HTML or JSON from the File menu."),
    ...filler(6, 1).map((t) => paragraph(t)),
  ]);
  return {
    ...doc,
    styles: {
      note: { name: "Note", kind: "paragraph", marks: { italic: true, color: "#1d4ed8" }, format: { spaceBefore: 6, spaceAfter: 12, indentLeft: 18 } },
      key: { name: "Key term", kind: "character", marks: { bold: true, color: "#be185d" } },
    },
    header: [paragraph([text("Pli product overview", { color: "#6b7280" })], "right")],
    footer: [paragraph([text("Page ", { color: "#6b7280" }), text("1", { field: "page", color: "#6b7280" }), text(" of ", { color: "#6b7280" }), text("1", { field: "pages", color: "#6b7280" })], "center")],
  };
}

type Tab = "markdown" | "html" | "json";

const users = new Users(directory(ME));

/** The editor on its own: the whole toolbar, a long sample document, and a panel showing the exported output. */
export function Basics() {
  const session = useDocumentSession(starter, { storage: demoStorage, comments: { users }, suggestions: { users } });
  // Add ?readonly to the address to review a document: the text can't change, but people can still comment.
  const readOnly = new URLSearchParams(location.search).has("readonly");
  const [showOutput, setShowOutput] = useState(false);
  const [tab, setTab] = useState<Tab>("markdown");
  useSessionRevision(session);

  const doc = session.state;
  const output = !showOutput
    ? ""
    : tab === "markdown"
      ? toMarkdown(doc)
      : tab === "html"
        ? toHtml(doc)
        : JSON.stringify(JSON.parse(serializeDoc(doc)), null, 2);

  return (
    <div className="playground" data-output={showOutput || undefined}>
      <PliDocument
        session={session}
        readOnly={readOnly}
        autoFocus
        aria-label="Document"
        actions={
          <>
            <BackToDemos />
            <button className="output-toggle" onClick={() => setShowOutput((v) => !v)} aria-pressed={showOutput}>
              {showOutput ? "Hide output" : "Show output"}
            </button>
          </>
        }
      />
      {showOutput && (
        <aside className="output">
          <div role="tablist" className="tabs">
            {(["markdown", "html", "json"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          <pre data-testid="output">{output}</pre>
        </aside>
      )}
    </div>
  );
}
