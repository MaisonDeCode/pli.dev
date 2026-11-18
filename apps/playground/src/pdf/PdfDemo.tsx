import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Users, defaultFonts, memoryVersionStorage } from "@pli.dev/core";
import { PdfEditor, downloadBytes } from "@pli.dev/pdf-react";
import { pdfjsRenderer } from "@pli.dev/pdf-react/pdfjs";
import { makeSamplePdf, openPdf, type PdfDoc, type PdfSession } from "@pli.dev/pdf";
// Vite copies the worker into the build and gives its address.
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { BackToDemos } from "../BackToDemos";

const YOU = { id: "you", name: "You" };

/** What the person is told when a file cannot be opened. */
function problem(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /password/i.test(message) ? "This file is protected by a password, which this demo cannot ask for. Open another file." : `Could not open the file. ${message}`;
}

/**
 * The PDF editor on its own, with a sample file made in the browser by the engine. Open your own file with the button, the
 * File menu or by dropping it on the page; it stays in this window. Save downloads the edited file.
 */
export function PdfDemo() {
  const [session, setSession] = useState<PdfSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The drop hint is shown only while a file is being dragged over the window. `dragover` repeats about every 50 ms
  // while it is, so a short silence (the drag left, was cancelled with Escape, or ended anywhere) hides it again.
  const dragTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragActive = useCallback(() => {
    setDragging(true);
    clearTimeout(dragTimer.current);
    dragTimer.current = setTimeout(() => setDragging(false), 250);
  }, []);
  const dragEnd = useCallback(() => {
    clearTimeout(dragTimer.current);
    setDragging(false);
  }, []);
  useEffect(() => {
    window.addEventListener("dragend", dragEnd);
    window.addEventListener("drop", dragEnd);
    window.addEventListener("blur", dragEnd);
    return () => {
      window.removeEventListener("dragend", dragEnd);
      window.removeEventListener("drop", dragEnd);
      window.removeEventListener("blur", dragEnd);
      clearTimeout(dragTimer.current);
    };
  }, [dragEnd]);
  const input = useRef<HTMLInputElement>(null);
  const renderer = useMemo(() => pdfjsRenderer({ workerSrc }), []);
  const users = useMemo(() => new Users(YOU), []);
  const versions = useMemo(() => memoryVersionStorage<PdfDoc>(), []);
  const fonts = useMemo(() => defaultFonts(), []);
  const latest = useRef<PdfSession | null>(null);
  latest.current = session;

  const load = useCallback(async (bytes: Uint8Array, name: string) => {
    setError(null);
    try {
      setSession(await openPdf(bytes, { name, user: YOU }));
    } catch (e) {
      setError(problem(e));
    }
  }, []);

  const loadSample = useCallback(async () => load(await makeSamplePdf(), "sample.pdf"), [load]);
  useEffect(() => void loadSample(), [loadSample]);

  const openFile = useCallback(
    async (file: File) => {
      if (latest.current?.dirty && !window.confirm("Your changes to the open file are not saved. Open this file anyway?")) return;
      await load(new Uint8Array(await file.arrayBuffer()), file.name);
    },
    [load],
  );

  const onDrop = (e: DragEvent) => {
    dragEnd();
    // A picture dropped on a page is for the annotation tools, and PDFs dropped between thumbnails add pages: those handle it.
    if (e.defaultPrevented) return;
    const file = [...e.dataTransfer.files].find((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (!file) return;
    e.preventDefault();
    void openFile(file);
  };

  return (
    <div
      className="pdf-demo"
      data-dragging={dragging ? "" : undefined}
      onDragOver={(e) => {
        if ([...e.dataTransfer.items].some((i) => i.kind === "file")) {
          e.preventDefault();
          dragActive();
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) dragEnd();
      }}
      onDrop={onDrop}
    >
      <header className="pdf-demo-bar">
        <strong>PDF</strong>
        <button type="button" className="pli-button" onClick={() => input.current?.click()}>
          Open PDF…
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          aria-label="Open a PDF file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void openFile(file);
          }}
        />
        <button type="button" className="pli-button" onClick={() => void loadSample()}>
          Sample file
        </button>
        <button type="button" className="pli-button" aria-pressed={readOnly} onClick={() => setReadOnly(!readOnly)}>
          Read only
        </button>
        <span className="pdf-demo-hint">Drop a PDF anywhere on this page to open it.</span>
        <span className="pdf-demo-spacer" />
        <BackToDemos />
      </header>
      {error && (
        <p className="pdf-demo-error" role="alert">
          {error}
        </p>
      )}
      <div className="pdf-demo-editor">
        {session ? (
          <PdfEditor
            key={session.doc.id}
            session={session}
            renderer={renderer}
            readOnly={readOnly}
            user={YOU}
            users={users}
            versions={versions}
            comments
            fonts={fonts}
            warnOnUnload
            onSave={(bytes) => downloadBytes(bytes, session.doc.name ?? "document.pdf", "application/pdf")}
            onOpen={load}
          />
        ) : (
          <p className="pdf-demo-loading">{error ? "" : "Making the sample file…"}</p>
        )}
      </div>
    </div>
  );
}
