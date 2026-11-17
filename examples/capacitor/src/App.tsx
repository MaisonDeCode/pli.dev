import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { bold, createDoc, heading, italic, listItem, paragraph, parseDoc, serializeDoc, table, text, title, type Doc } from "@pli.dev/docs";
import { PliDocument, useDocumentSession, type PliDownload } from "@pli.dev/react";

const KEY = "pli-example-document";

/** The document saved last time, or a short one to start from. */
function startingDocument(): Doc {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return parseDoc(saved);
  } catch {
    // Nothing saved, or what was saved can't be read: start fresh.
  }
  return createDoc("Pli on a phone", [
    title("Pli on a phone"),
    paragraph(["This is the web editor, running inside a native app with ", bold("Capacitor"), ". Everything works as it does in the browser: ", italic("formatting"), ", lists, tables, comments, and files in and out."]),
    heading(1, "Try it"),
    listItem("ordered", "Tap here and type"),
    listItem("ordered", "Use the toolbar at the bottom to format"),
    listItem("ordered", "Open File to save a DOCX or PDF, or to open one"),
    table([["Platform", "Runs in"], ["iPhone and iPad", "WKWebView"], ["Android", "WebView"]], { headerRow: true }),
    paragraph([text("Your changes are saved on the device as you type.", { italic: true })]),
  ]);
}

/** A web view can't download a file, so File > Download hands it here: it is written to the app's cache and shared (Save to Files, AirDrop, Mail…). */
async function saveAndShare(file: PliDownload): Promise<void> {
  let binary = "";
  for (let i = 0; i < file.data.length; i += 0x8000) binary += String.fromCharCode(...file.data.subarray(i, i + 0x8000));
  const written = await Filesystem.writeFile({ path: file.name, data: btoa(binary), directory: Directory.Cache });
  try {
    await Share.share({ title: file.name, url: written.uri });
  } catch (cause) {
    // Closing the share sheet without choosing anything is not an error.
    if (!/cancel/i.test(String((cause as Error)?.message ?? cause))) throw cause;
  }
}

export function App() {
  const session = useDocumentSession(startingDocument);

  // Save what you type, a moment after you stop.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = session.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(KEY, serializeDoc(session.state));
        } catch {
          // Storage is full or turned off: the document stays open, it just isn't kept.
        }
      }, 400);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [session]);

  // A phone is narrow, so start without page edges (the status bar can switch to pages).
  const narrow = typeof window !== "undefined" && window.innerWidth < 700;

  return (
    <PliDocument
      session={session}
      defaultView={narrow ? "continuous" : "pages"}
      ruler={!narrow}
      // In a browser, File > Download works as usual. In the app it goes through the share sheet.
      onDownload={Capacitor.isNativePlatform() ? saveAndShare : undefined}
    />
  );
}
