import { useEffect, useMemo, useRef, useState } from "react";
import { generateDocument, templateFields, toDocx } from "@pli.dev/docs";
import { PliDocument, downloadFile, insertValue, useDocumentSession, useSessionRevision, type PlaceholderField, type PlaceholderOptions } from "@pli.dev/react";
import { BackToDemos } from "../BackToDemos";
import { INITIAL, Questions, agreementTemplate, answersOf } from "./Generate";

/**
 * What the people who write templates are offered. These are the same questions as the form in "Documents from answers", with
 * plain names, the choices for the two that have choices, and what each service in the list has.
 */
const FIELDS: PlaceholderField[] = [
  { path: "client.name", label: "Client name" },
  { path: "client.email", label: "Client email" },
  { path: "company", label: "Company" },
  { path: "start", label: "Start date" },
  {
    path: "plan",
    label: "Plan",
    options: [
      { value: "starter", label: "Starter" },
      { value: "team", label: "Team" },
      { value: "enterprise", label: "Enterprise" },
    ],
  },
  { path: "seats", label: "Seats" },
  { path: "price", label: "Price per seat" },
  { path: "nda", label: "Confidentiality clause" },
  { path: "ndaYears", label: "Confidentiality years" },
  {
    path: "terms",
    label: "Payment terms",
    options: [
      { value: "net30", label: "Within 30 days" },
      { value: "upfront", label: "Up front" },
    ],
  },
  {
    path: "services",
    label: "Services",
    fields: [
      { path: "name", label: "Service" },
      { path: "fee", label: "Fee" },
    ],
  },
];

/** The questions people can click to add to the template, as a list of buttons. */
const QUESTIONS = FIELDS.filter((f) => typeof f !== "string" && !f.fields) as Exclude<PlaceholderField, string>[];

/**
 * The template editor for people who don't write code. Each `{{ … }}` is shown as a name ("Client name", "Only if Plan is team",
 * "End") and the code is hidden; underneath it is the same text, so the same template works anywhere else. Questions are added
 * from a list, or from Insert, and the caret treats each one as a single character.
 */
export function Builder() {
  const [view, setView] = useState<"write" | "try">("write");
  const [showCode, setShowCode] = useState(false);
  const [form, setForm] = useState(INITIAL);

  const templateSession = useDocumentSession(agreementTemplate);
  const revision = useSessionRevision(templateSession);
  const template = useMemo(() => templateSession.state, [templateSession, revision]);
  const options = useMemo<PlaceholderOptions>(() => ({ fields: FIELDS, labels: !showCode }), [showCode]);

  const answers = useMemo(() => answersOf(form), [form]);
  const result = useMemo(() => generateDocument(template, answers, { locale: "en-US" }), [template, answers]);
  const analysis = useMemo(() => templateFields(template), [template]);
  const unknown = analysis.fields.filter((f) => !FIELDS.some((x) => typeof x !== "string" && x.path === f.path));

  const output = useDocumentSession(() => result.doc);
  const shown = useRef(result.doc);
  useEffect(() => {
    if (shown.current === result.doc) return;
    shown.current = result.doc;
    output.replaceDocument(result.doc);
  }, [output, result.doc]);

  return (
    <div className="generate">
      <header className="generate-bar">
        <BackToDemos />
        <div className="generate-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "write"} onClick={() => setView("write")}>Write the template</button>
          <button type="button" role="tab" aria-selected={view === "try"} onClick={() => setView("try")}>Try it</button>
        </div>
        {view === "write" ? (
          <label className="generate-check">
            <input type="checkbox" checked={showCode} onChange={(e) => setShowCode(e.target.checked)} /> Show the code
          </label>
        ) : null}
        <span className="generate-status" role="status">
          {result.missing.length > 0 ? `Still to answer: ${result.missing.join(", ")}` : "Every question has an answer"}
          {unknown.length > 0 ? ` · Not in the list of questions: ${unknown.map((f) => f.path).join(", ")}` : ""}
        </span>
        <button type="button" className="pli-button" onClick={() => downloadFile(`${result.doc.title || "Document"}.docx`, toDocx(result.doc) as BlobPart, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}>
          Download DOCX
        </button>
      </header>
      <div className="generate-main">
        {view === "write" ? (
          <>
            <aside className="generate-side" aria-label="Questions">
              <h2 className="builder-heading">Questions</h2>
              <p className="builder-note">Click one to add it where the cursor is. For a part that is only sometimes there, or one that repeats, use Insert &gt; Only if… or Repeat for each….</p>
              <ul className="builder-list">
                {QUESTIONS.map((q) => (
                  <li key={q.path}>
                    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertValue(templateSession, q.path)}>
                      {q.label ?? q.path}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            <section className="generate-doc generate-template" aria-label="The template">
              <PliDocument session={templateSession} placeholders={options} />
            </section>
          </>
        ) : (
          <>
            <aside className="generate-side">
              <Questions form={form} onChange={setForm} />
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
