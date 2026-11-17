import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DocumentSession, createDoc, paragraph, parseDoc, serializeDoc, toDocx, toHtml, toMarkdown, type Doc } from "@pli.dev/docs";
import { PliDocument, type PliDownload } from "@pli.dev/react";
import "@pli.dev/react/styles.css";
import "./host.css";
import { post, toBase64 } from "./transport";

/**
 * The page a Swift or Kotlin app puts in a web view to show the Pli editor. The app talks to it through `window.pliHost`:
 *
 *   load(json)            open a document (the JSON `PliDocument.json()` gives), or an empty one
 *   setReadOnly(boolean)  turn editing off or on
 *   call(id, name, args)  ask for something; the answer comes back as a `response` message with the same id.
 *                         names: "json", "exportDocx" (base64), "exportMarkdown", "exportHtml"
 *
 * and it tells the app, with `post`, when it is ready, when the document changes, and when a file was made.
 */

interface Options {
  readOnly: boolean;
  title: string;
}

const host: {
  load?: (json: string | null, options?: Partial<Options>) => void;
  setReadOnly?: (readOnly: boolean) => void;
  getSession?: () => DocumentSession;
} = {};

function Host() {
  const [state, setState] = useState<{ session: DocumentSession; options: Options; version: number }>(() => ({
    session: new DocumentSession(createDoc("Untitled", [paragraph("")])),
    options: { readOnly: false, title: "Untitled" },
    version: 0,
  }));
  const { session, options } = state;

  useEffect(() => {
    host.load = (json, next = {}) => {
      let doc: Doc;
      try {
        doc = json ? parseDoc(json) : createDoc(next.title ?? "Untitled", [paragraph("")]);
      } catch (cause) {
        post({ type: "error", message: `The document couldn't be opened: ${(cause as Error).message}` });
        return;
      }
      setState((old) => ({ session: new DocumentSession(doc), options: { ...old.options, ...next }, version: old.version + 1 }));
    };
    host.setReadOnly = (readOnly) => setState((old) => ({ ...old, options: { ...old.options, readOnly } }));
    host.getSession = () => session;
    return () => {
      host.getSession = undefined;
    };
  }, [session]);

  // Tell the app about edits, a moment after the last one.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = session.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => post({ type: "change", json: serializeDoc(session.state) }), 300);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [session]);

  const phone = useMemo(() => window.innerWidth < 700, []);
  const onDownload = (file: PliDownload) => post({ type: "download", name: file.name, mime: file.type, base64: toBase64(file.data) });

  return (
    <PliDocument
      key={state.version}
      session={session}
      readOnly={options.readOnly}
      defaultView={phone ? "continuous" : "pages"}
      ruler={!phone}
      onDownload={onDownload}
    />
  );
}

/** Answers the app's `call`s. */
function call(id: number, name: string, args: string): void {
  try {
    const session = host.getSession?.();
    if (!session) throw new Error("The editor isn't ready");
    let value: string;
    switch (name) {
      case "json":
        value = serializeDoc(session.state);
        break;
      case "exportDocx":
        value = toBase64(toDocx(session.state));
        break;
      case "exportMarkdown":
        value = toMarkdown(session.state);
        break;
      case "exportHtml":
        value = toHtml(session.state, { fullDocument: true });
        break;
      default:
        throw new Error(`Nothing called "${name}" can be asked for`);
    }
    void args;
    post({ type: "response", id, ok: true, value });
  } catch (cause) {
    post({ type: "response", id, ok: false, error: (cause as Error).message });
  }
}

(window as unknown as { pliHost: unknown }).pliHost = {
  load: (json: string | null, options?: Partial<Options>) => host.load?.(json, options),
  setReadOnly: (readOnly: boolean) => host.setReadOnly?.(readOnly),
  call,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Host />
  </StrictMode>,
);
post({ type: "ready" });
