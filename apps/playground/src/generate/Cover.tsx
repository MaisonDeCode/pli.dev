import { useEffect, useMemo, useRef, useState } from "react";
import { createDoc, generateDocument, heading, pageBackground, pageBreak, paragraph, text, textBox, toDocx, type Doc } from "@pli.dev/docs";
import { PliDocument, downloadFile, useDocumentSession, useSessionRevision, type PlaceholderOptions } from "@pli.dev/react";
import { BackToDemos } from "../BackToDemos";

/**
 * A page-sized picture made here, so the demo needs no files: a pale top, a deep blue corner, and a few angled shapes between.
 * It is drawn on a canvas and kept as a PNG, because pictures in a document can't be SVG.
 */
function artwork(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 816;
  canvas.height = 1056;
  const g = canvas.getContext("2d");
  if (!g) return "";
  const fade = g.createLinearGradient(0, 0, 816, 1056);
  fade.addColorStop(0, "#f7f7f8");
  fade.addColorStop(1, "#d6d8dc");
  g.fillStyle = fade;
  g.fillRect(0, 0, 816, 1056);
  const poly = (points: [number, number][], fill: string | CanvasGradient) => {
    g.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  };
  poly([[250, 0], [640, 0], [440, 300]], "rgba(255,255,255,0.55)");
  const deep = g.createLinearGradient(0, 520, 816, 1056);
  deep.addColorStop(0, "#003a7d");
  deep.addColorStop(1, "#001f4d");
  poly([[0, 1056], [0, 860], [816, 520], [816, 1056]], deep);
  poly([[260, 1056], [520, 760], [640, 1056]], "rgba(10,74,153,0.6)");
  return canvas.toDataURL("image/png");
}

const NAVY = "#000066";

/**
 * A cover page, built in code the way it would be in the editor: a picture behind the page, a title box across the top, and a
 * framed box with the details that change. The details are `{{ placeholders }}`, so the page fills in like the rest of a template.
 */
export function coverTemplate(): Doc {
  const background = pageBackground(artwork(), { width: 816, height: 1056 }, undefined, { alt: "" });
  const titleBox = textBox(
    [
      [text("SITE SURVEY", { bold: true, fontSize: 30, color: NAVY })],
      [text("REPORT", { bold: true, fontSize: 30, color: NAVY })],
    ],
    { x: { from: "page", align: "center" }, y: { from: "page", offset: 120 }, width: 760, height: 130 },
  );
  const details = textBox(
    [
      [text("PROPERTY LOCATION", { bold: true, color: NAVY })],
      "{{ facility.name }}",
      "{{ facility.address }}",
      "",
      [text("PREPARED FOR", { bold: true, color: NAVY })],
      "{{ client.name }}",
      "{{ client.address }}",
      "",
      [text("PREPARED BY", { bold: true, color: NAVY })],
      "Northfield Studio",
      "{{ date | date }}",
    ],
    {
      x: { from: "page", align: "center" },
      y: { from: "page", offset: 360 },
      width: 560,
      height: 430,
      fill: "#ffffff",
      line: { color: "#000000", width: 8, style: "double" },
    },
  );
  const note = paragraph("");
  return createDoc("Survey report for {{ facility.name }}", [background, titleBox, details, note, pageBreak(), heading(1, "Summary"), paragraph("This report covers {{ facility.name }}, prepared for {{ client.name }}.")]);
}

const FIELDS: PlaceholderOptions = {
  labels: true,
  fields: [
    { path: "facility.name", label: "Facility name" },
    { path: "facility.address", label: "Facility address" },
    { path: "client.name", label: "Client name" },
    { path: "client.address", label: "Client address" },
    { path: "date", label: "Report date" },
  ],
};

const INITIAL = { facility: "Riverside Plant", facilityAddress: "1200 Mill Road, Shreveport, LA", client: "Harlow Foods", clientAddress: "88 Commerce Way, Dallas, TX", date: "2025-01-01" };

/**
 * Cover pages: a picture behind the page, boxes of text set at a place on it, and details that fill in from answers. Edit the
 * template (Insert > Text box, Shape and Page background), then try it with a few answers and download the DOCX.
 */
export function Cover() {
  const [view, setView] = useState<"write" | "try">("write");
  const [form, setForm] = useState(INITIAL);
  const templateSession = useDocumentSession(coverTemplate);
  const revision = useSessionRevision(templateSession);
  const template = useMemo(() => templateSession.state, [templateSession, revision]);

  const answers = useMemo(
    () => ({ facility: { name: form.facility, address: form.facilityAddress }, client: { name: form.client, address: form.clientAddress }, date: form.date }),
    [form],
  );
  const result = useMemo(() => generateDocument(template, answers, { locale: "en-US" }), [template, answers]);
  const output = useDocumentSession(() => result.doc);
  const shown = useRef(result.doc);
  useEffect(() => {
    if (shown.current === result.doc) return;
    shown.current = result.doc;
    output.replaceDocument(result.doc);
  }, [output, result.doc]);

  const set = (key: keyof typeof INITIAL) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  return (
    <div className="generate">
      <header className="generate-bar">
        <BackToDemos />
        <div className="generate-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "write"} onClick={() => setView("write")}>Design the cover</button>
          <button type="button" role="tab" aria-selected={view === "try"} onClick={() => setView("try")}>Try it</button>
        </div>
        <span className="generate-status" role="status">{result.missing.length > 0 ? `Still to answer: ${result.missing.join(", ")}` : "Every question has an answer"}</span>
        <button type="button" className="pli-button" onClick={() => downloadFile(`${result.doc.title || "Cover"}.docx`, toDocx(result.doc) as BlobPart, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}>
          Download DOCX
        </button>
      </header>
      <div className="generate-main">
        {view === "write" ? (
          <section className="generate-doc generate-template" aria-label="The cover template">
            <PliDocument session={templateSession} placeholders={FIELDS} />
          </section>
        ) : (
          <>
            <aside className="generate-side">
              <form className="generate-form" onSubmit={(e) => e.preventDefault()} aria-label="Questionnaire">
                <h2>The survey</h2>
                {(
                  [["facility", "Facility"], ["facilityAddress", "Facility address"], ["client", "Client"], ["clientAddress", "Client address"]] as const
                ).map(([key, label]) => (
                  <label key={key} className="generate-field">
                    <span>{label}</span>
                    <input value={form[key]} onChange={set(key)} />
                  </label>
                ))}
                <label className="generate-field">
                  <span>Report date</span>
                  <input type="date" value={form.date} onChange={set("date")} />
                </label>
              </form>
            </aside>
            <section className="generate-doc" aria-label="The document it makes">
              <PliDocument session={output} readOnly menu={false} toolbar={false} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
