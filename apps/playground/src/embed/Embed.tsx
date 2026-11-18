import { useCallback, useState, type CSSProperties } from "react";
import { createDoc, heading, paragraph, text, memoryVersionStorage, Users, type CommentNotice, type Doc, type PliUser } from "@pli.dev/docs";
import { PliDocument, useDocumentSession, type ExtraMenus, type FilePicker, type FilePickRequest, type PliTheme } from "@pli.dev/react";
import { createWorkbook, type Workbook } from "@pli.dev/sheets";
import { PliSheet, useSheetSession } from "@pli.dev/sheets-react";
import { SIZE_GOOGLE, createDeck } from "@pli.dev/decks";
import { PliDeck, useDeckSession } from "@pli.dev/decks-react";
import { BackToDemos } from "../BackToDemos";

type Which = "document" | "sheet" | "deck";

/** What your own app puts around an editor: the `theme` it is using, and its own buttons in the title row. */
const Back = () => <button type="button" className="pli-button" onClick={() => (location.hash = "#/")}>← Projects</button>;
const Export = () => <button type="button" className="pli-button">Export</button>;
const Account = () => <button type="button" className="pli-button" aria-label="Account">CS</button>;

/** One line for the log: what the app would send, and to whom. */
function describe(notice: CommentNotice): string {
  const to = notice.recipients.map((r) => `${r.user.name} (${r.reason})`).join(", ") || "nobody";
  return `${notice.type} by ${notice.actor.name} → notify ${to}`;
}

/** The menu items an app adds: a Share under File, and a menu of its own. */
const EXTRA_MENUS: ExtraMenus = {
  File: [{ label: "Share…", onSelect: () => alert("Your app's own share dialog opens here.") }],
  AI: [
    { label: "Summarize", onSelect: () => alert("Summarize with your model.") },
    { label: "Rewrite", items: [{ label: "Shorter", onSelect: () => alert("Shorter") }, { label: "Friendlier", onSelect: () => alert("Friendlier") }] },
  ],
};

/** A picture made on the spot, standing in for a file from the app's own storage. */
async function sampleImage(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 140;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#4f46e5";
  ctx.fillRect(0, 0, 240, 140);
  ctx.fillStyle = "#fff";
  ctx.font = "700 28px system-ui, sans-serif";
  ctx.fillText("From my files", 30, 78);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], "from-my-files.png", { type: "image/png" });
}

/** The app's own file chooser: its files, or the computer. The editors call it instead of opening the browser's chooser. */
function PickerDialog({ request, done }: { request: FilePickRequest; done: (files: File[] | null) => void }) {
  return (
    <div role="dialog" aria-label={request.label} style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "#0006", zIndex: 5000 }}>
      <div style={{ background: "#fff", color: "#1b1d22", borderRadius: 12, padding: "1rem 1.25rem", width: 340, display: "grid", gap: "0.6rem" }}>
        <strong>{request.label}</strong>
        {request.purpose === "image" && <button type="button" className="pli-button" onClick={async () => done([await sampleImage()])}>From my files: from-my-files.png</button>}
        <button type="button" className="pli-button" onClick={() => void request.browse().then((files) => done(files))}>From my computer…</button>
        <button type="button" className="pli-button" onClick={() => done(null)}>Cancel</button>
      </div>
    </div>
  );
}

/** The people of the example app. Ana is signed in. */
const PEOPLE: PliUser[] = [
  { id: "ana", name: "Ana Reyes" },
  { id: "ben", name: "Ben Ito" },
  { id: "cleo", name: "Cleo Park" },
];

/** Your people: `search` fills the @ list, and `open` is called when a name is clicked. */
const exampleUsers = () =>
  new Users({
    current: PEOPLE[0]!,
    lookup: (ids) => PEOPLE.filter((p) => ids.includes(p.id)),
    search: (query) => PEOPLE.filter((p) => p.id !== "ana" && p.name.toLowerCase().includes(query.toLowerCase())),
    open: (user) => alert(`Your app's profile card for ${user.name} opens here.`),
  });

function Documents({ theme, filePicker, onNotice }: { theme: PliTheme; filePicker: FilePicker; onNotice: (line: string) => void }) {
  const session = useDocumentSession(() => createDoc("Quarterly plan", [heading(1, [text("Quarterly plan")]), paragraph([text("Select some text, then use Insert > Comment, and type @ to mention someone.")])]), {
    comments: {
      users: exampleUsers(),
      // What your app does with it: Pli sends nothing itself.
      onNotify: (notice: CommentNotice) => onNotice(describe(notice)),
    },
  });
  const [versions] = useState(() => memoryVersionStorage<Doc>());
  // `versions` keeps the history (here in memory); a version is kept by itself a few seconds after a change, to try it out.
  return <PliDocument session={session} theme={theme} versions={versions} autoSaveVersions={{ every: 4000 }} extraMenus={EXTRA_MENUS} filePicker={filePicker} startActions={<Back />} actions={<Export />} endActions={<Account />} />;
}

function Sheets({ theme, filePicker, onNotice }: { theme: PliTheme; filePicker: FilePicker; onNotice: (line: string) => void }) {
  const [users] = useState(exampleUsers);
  const [versions] = useState(() => memoryVersionStorage<Workbook>());
  const session = useSheetSession(() => createWorkbook("Budget"));
  return <PliSheet session={session} theme={theme} users={users} versions={versions} autoSaveVersions={{ every: 4000 }} comments={{ onNotify: (n: CommentNotice) => onNotice(describe(n)) }} extraMenus={EXTRA_MENUS} filePicker={filePicker} startActions={<Back />} actions={<Export />} endActions={<Account />} />;
}

function Decks({ theme, filePicker, onNotice }: { theme: PliTheme; filePicker: FilePicker; onNotice: (line: string) => void }) {
  const [users] = useState(exampleUsers);
  const session = useDeckSession(() => createDeck({ title: "Quarterly review", size: SIZE_GOOGLE }));
  return <PliDeck session={session} theme={theme} users={users} comments={{ onNotify: (n: CommentNotice) => onNotice(describe(n)) }} extraMenus={EXTRA_MENUS} filePicker={filePicker} startActions={<Back />} actions={<Export />} endActions={<Account />} />;
}

/** A labelled dropdown in the playground's own style: the host app's control, not part of the editor. */
function Choose<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; text: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="embed-field">
      <span className="embed-label">{label}</span>
      <span className="embed-select">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.text}</option>
          ))}
        </select>
      </span>
    </label>
  );
}

/** The editors with the `theme` prop, your own menus and file chooser, and buttons in the title row, inside a page that has a light or dark look of its own. */
export function Embed() {
  const [theme, setTheme] = useState<PliTheme>("auto");
  const [which, setWhich] = useState<Which>("document");
  const [notices, setNotices] = useState<string[]>([]);
  const [asking, setAsking] = useState<{ request: FilePickRequest; resolve: (files: File[] | null) => void } | null>(null);
  const onNotice = useCallback((line: string) => setNotices((all) => [line, ...all].slice(0, 5)), []);
  const filePicker = useCallback<FilePicker>((request) => new Promise((resolve) => setAsking({ request, resolve })), []);
  const pageLook = (theme === "dark" ? { background: "#101114", color: "#e8eaed" } : theme === "light" ? { background: "#ffffff", color: "#1b1d22" } : {}) as CSSProperties;
  return (
    <div className="embed" style={pageLook}>
      <header className="embed-bar">
        <BackToDemos />
        <Choose
          label="Editor"
          value={which}
          onChange={setWhich}
          options={[{ value: "document", text: "Documents" }, { value: "sheet", text: "Sheets" }, { value: "deck", text: "Decks" }]}
        />
        <Choose
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[{ value: "auto", text: "Auto" }, { value: "light", text: "Light" }, { value: "dark", text: "Dark" }]}
        />
      </header>
      <main className="embed-main">
        {which === "document" ? <Documents key="d" theme={theme} filePicker={filePicker} onNotice={onNotice} /> : which === "sheet" ? <Sheets key="s" theme={theme} filePicker={filePicker} onNotice={onNotice} /> : <Decks key="k" theme={theme} filePicker={filePicker} onNotice={onNotice} />}
        {notices.length > 0 && (
          <aside className="embed-log" aria-label="What your app would send">
            <strong>What your app would send</strong>
            {notices.map((line, i) => <div key={i}>{line}</div>)}
          </aside>
        )}
        {asking && <PickerDialog request={asking.request} done={(files) => { asking.resolve(files); setAsking(null); }} />}
      </main>
    </div>
  );
}
