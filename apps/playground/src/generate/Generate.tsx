import { useEffect, useMemo, useRef, useState } from "react";
import { createDoc, generateDocument, heading, paragraph, table, templateFields, text, title, toDocx, type Answers, type Doc, type TableBlock } from "@pli.dev/docs";
import { PliDocument, downloadFile, useDocumentSession, useSessionRevision } from "@pli.dev/react";
import { BackToDemos } from "../BackToDemos";

/**
 * A template is a document like any other, with `{{ placeholders }}`, parts that are there only when something is true, and parts
 * that repeat for each item in a list. This one is built here in code; in your app it is a file someone wrote in the editor.
 */
export function agreementTemplate(): Doc {
  const services = table([["Service", "Fee"], ["x", "y"], ["Total", "{{ services | sum:\"fee\" | currency }}"]], { headerRow: true, columns: [0.7, 0.3] });
  // A row is repeated by opening the list in its first cell and closing it in its last.
  const row = (services as TableBlock).rows[1]!;
  row.cells[0]!.blocks = [paragraph("{{#each services as s}}") as never, paragraph("{{ s.name }}") as never];
  row.cells[1]!.blocks = [paragraph("{{ s.fee | currency }}") as never, paragraph("{{/each}}") as never];
  return createDoc("Service agreement for {{ client.name }}", [
    title("Service agreement"),
    paragraph("This agreement starts on {{ start | date }} between Northfield Studio and {{ client.name }}{{#if company}} of {{ company }}{{/if}}."),
    heading(2, "Plan"),
    paragraph("{{#if plan == \"starter\"}}"),
    paragraph("The Starter plan covers up to {{ seats }} {{ seats | plural:\"seat\",\"seats\" }}, at {{ price | currency }} a seat each month."),
    paragraph("{{#elseif plan == \"team\"}}"),
    paragraph("The Team plan covers up to {{ seats }} seats, at {{ price | currency }} a seat each month, with shared workspaces and priority support."),
    paragraph("{{else}}"),
    paragraph("The Enterprise plan covers {{ seats }} seats at {{ price | currency }} a seat each month, with a named contact and a custom service level."),
    paragraph("{{/if}}"),
    heading(2, "Services"),
    services,
    paragraph("{{#if nda}}"),
    heading(2, "Confidentiality"),
    paragraph("Both parties agree to keep the other's business information private for {{ ndaYears }} {{ ndaYears | plural:\"year\",\"years\" }} after this agreement ends."),
    paragraph("{{/if}}"),
    heading(2, "Payment"),
    paragraph("{{#if terms == \"net30\"}}"),
    paragraph("Invoices are due within 30 days of the date they are sent."),
    paragraph("{{#elseif terms == \"upfront\"}}"),
    paragraph("Payment is due in full before work starts."),
    paragraph("{{else}}"),
    paragraph("Payment is due as agreed in writing."),
    paragraph("{{/if}}"),
    paragraph([text("Prepared on {{ @today | date }} for "), text("{{ client.email }}", { italic: true }), text(".")]),
  ]);
}

const PLANS = { starter: { label: "Starter", price: 12 }, team: { label: "Team", price: 24 }, enterprise: { label: "Enterprise", price: 40 } } as const;
type Plan = keyof typeof PLANS;

/** What the questionnaire has collected. Your own form, a survey tool or a database row can give the same: it is only data. */
export interface Form {
  name: string;
  email: string;
  company: string;
  start: string;
  plan: Plan;
  seats: number;
  nda: boolean;
  ndaYears: number;
  terms: string;
  services: { name: string; fee: string }[];
}

export const INITIAL: Form = {
  name: "Ana Reyes",
  email: "ana@riverside.example",
  company: "Riverside Studio",
  start: "2026-12-01",
  plan: "team",
  seats: 8,
  nda: true,
  ndaYears: 2,
  terms: "net30",
  services: [
    { name: "Brand workshop", fee: "2400" },
    { name: "Website design", fee: "6800" },
  ],
};

/** Turns the form into the answers the template reads. A value the person left empty is left out, so the template can tell. */
export function answersOf(form: Form): Answers {
  const blank = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    client: { name: blank(form.name), email: blank(form.email) },
    company: blank(form.company),
    start: blank(form.start),
    plan: form.plan,
    seats: form.seats,
    // Your own logic can work out answers too: here, the price comes from the plan.
    price: PLANS[form.plan].price,
    nda: form.nda,
    ndaYears: form.ndaYears,
    terms: form.terms,
    services: form.services.filter((s) => s.name.trim() !== "").map((s) => ({ name: s.name.trim(), fee: Number(s.fee) || 0 })),
  };
}

/** The answers the sample questionnaire collects, for the Insert > Field menu while the template is edited. */
const FIELDS = [
  { path: "client.name", label: "Client name" },
  { path: "client.email", label: "Client email" },
  { path: "company", label: "Company" },
  { path: "start", label: "Start date" },
  { path: "plan", label: "Plan" },
  { path: "seats", label: "Seats" },
  { path: "price", label: "Price per seat" },
  { path: "nda", label: "Confidentiality clause" },
  { path: "ndaYears", label: "Confidentiality years" },
  { path: "terms", label: "Payment terms" },
  { path: "services", label: "Services" },
];

/** The document the sample questionnaire makes with its starting answers, for the landing page. */
export const generatedSample = (): Doc => generateDocument(agreementTemplate(), answersOf(INITIAL), { locale: "en-US" }).doc;

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="generate-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

/** The questionnaire. Any form would do: this is a plain React one, which is the point. */
export function Questions({ form, onChange }: { form: Form; onChange: (next: Form) => void }) {
  const set = <K extends keyof Form>(key: K, value: Form[K]) => onChange({ ...form, [key]: value });
  return (
    <form className="generate-form" onSubmit={(e) => e.preventDefault()} aria-label="Questionnaire">
      <h2>About the client</h2>
      <Field label="Name">
        <input value={form.name} onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field label="Email">
        <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <Field label="Company (optional)">
        <input value={form.company} onChange={(e) => set("company", e.target.value)} />
      </Field>
      <Field label="Start date">
        <input type="date" value={form.start} onChange={(e) => set("start", e.target.value)} />
      </Field>

      <h2>The plan</h2>
      <Field label="Plan">
        <select value={form.plan} onChange={(e) => set("plan", e.target.value as Plan)}>
          {(Object.keys(PLANS) as Plan[]).map((p) => (
            <option key={p} value={p}>{PLANS[p].label}</option>
          ))}
        </select>
      </Field>
      <Field label="Seats">
        <input type="number" min={1} value={form.seats} onChange={(e) => set("seats", Math.max(1, Number(e.target.value) || 1))} />
      </Field>
      <Field label="Payment">
        <select value={form.terms} onChange={(e) => set("terms", e.target.value)}>
          <option value="net30">Within 30 days</option>
          <option value="upfront">Up front</option>
          <option value="other">Something else</option>
        </select>
      </Field>
      <label className="generate-check">
        <input type="checkbox" checked={form.nda} onChange={(e) => set("nda", e.target.checked)} /> Include a confidentiality clause
      </label>
      {form.nda && (
        <Field label="For how many years">
          <input type="number" min={1} value={form.ndaYears} onChange={(e) => set("ndaYears", Math.max(1, Number(e.target.value) || 1))} />
        </Field>
      )}

      <h2>Services</h2>
      {form.services.map((s, i) => (
        <div className="generate-row" key={i}>
          <input
            aria-label={`Service ${i + 1}`}
            placeholder="Service"
            value={s.name}
            onChange={(e) => set("services", form.services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
          />
          <input
            aria-label={`Fee for service ${i + 1}`}
            type="number"
            min={0}
            placeholder="Fee"
            value={s.fee}
            onChange={(e) => set("services", form.services.map((x, j) => (j === i ? { ...x, fee: e.target.value } : x)))}
          />
          <button type="button" className="generate-remove" aria-label={`Remove service ${i + 1}`} onClick={() => set("services", form.services.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="generate-add" onClick={() => set("services", [...form.services, { name: "", fee: "" }])}>+ Add a service</button>
    </form>
  );
}

/** Making a document from a template and answers, live: the questionnaire on one side and the document it makes on the other. */
export function Generate() {
  const [form, setForm] = useState(INITIAL);
  const [view, setView] = useState<"fill" | "template">("fill");

  // The template is edited in the same editor as everything else.
  const templateSession = useDocumentSession(agreementTemplate);
  const templateRevision = useSessionRevision(templateSession);
  const template = useMemo(() => templateSession.state, [templateSession, templateRevision]);

  const answers = useMemo(() => answersOf(form), [form]);
  const result = useMemo(() => generateDocument(template, answers, { locale: "en-US" }), [template, answers]);
  const analysis = useMemo(() => templateFields(template), [template]);

  // The document it makes is shown in a read-only editor, replaced whenever the answers or the template change.
  const output = useDocumentSession(() => result.doc);
  const shown = useRef(result.doc);
  useEffect(() => {
    if (shown.current === result.doc) return;
    shown.current = result.doc;
    output.replaceDocument(result.doc);
  }, [output, result.doc]);

  const problems = result.issues.filter((i) => i.type !== "missing");

  return (
    <div className="generate">
      <header className="generate-bar">
        <BackToDemos />
        <div className="generate-tabs" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={view === "fill"} onClick={() => setView("fill")}>Fill in the questions</button>
          <button type="button" role="tab" aria-selected={view === "template"} onClick={() => setView("template")}>Edit the template</button>
        </div>
        <span className="generate-status" role="status">
          {result.missing.length > 0 ? `Still to answer: ${result.missing.join(", ")}` : problems.length > 0 ? `${problems.length} problem${problems.length === 1 ? "" : "s"} in the template` : "Every placeholder has an answer"}
        </span>
        <button type="button" className="pli-button" onClick={() => downloadFile(`${result.doc.title || "Document"}.docx`, toDocx(result.doc) as BlobPart, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}>
          Download DOCX
        </button>
      </header>
      <div className="generate-main">
        {view === "fill" ? (
          <>
            <aside className="generate-side">
              <Questions form={form} onChange={setForm} />
              <details className="generate-asks">
                <summary>What the template asks for ({analysis.fields.length})</summary>
                <p>Read from the template itself, so a questionnaire can be built from it or checked against it.</p>
                <ul>
                  {analysis.fields.map((f) => (
                    <li key={f.path}>
                      <code>{f.path}</code> <span>{f.type}</span>
                      {f.options && <span> · {f.options.join(", ")}</span>}
                      {f.fields && <span> · each has {f.fields.map((x) => x.path).join(", ")}</span>}
                    </li>
                  ))}
                </ul>
              </details>
              {problems.length > 0 && (
                <ul className="generate-problems" aria-label="Problems">
                  {problems.map((p, i) => (
                    <li key={i}><code>{p.tag}</code> {p.message}</li>
                  ))}
                </ul>
              )}
            </aside>
            <section className="generate-doc" aria-label="The document it makes">
              <PliDocument session={output} readOnly menu={false} toolbar={false} />
            </section>
          </>
        ) : (
          <section className="generate-doc generate-template" aria-label="The template">
            <p className="generate-hint">
              The template is an ordinary document. Use Insert &gt; Field to add an answer, or type <code>{"{{ name }}"}</code>. Put <code>{"{{#if plan == \"team\"}}"}</code> and <code>{"{{/if}}"}</code> on lines of their own around text that is only sometimes there, and <code>{"{{#each services as s}}"}</code> and <code>{"{{/each}}"}</code> around text that repeats. Switch back to see the result.
            </p>
            <PliDocument session={templateSession} placeholders={{ fields: FIELDS }} />
          </section>
        )}
      </div>
    </div>
  );
}
