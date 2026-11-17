import { toHtml, type Doc } from "@pli.dev/docs";

/**
 * Opens the browser's print dialog for a document (choose "Save as PDF" to make a PDF).
 *
 * The document is exported to HTML with its page size and margins and printed from a hidden
 * frame, so the browser paginates it. Page breaks can differ slightly from the editor's view.
 */
export async function printDocument(doc: Doc): Promise<void> {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("tabindex", "-1");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.append(frame);

  const win = frame.contentWindow!;
  const page = frame.contentDocument!;
  page.open();
  page.write(toHtml(doc, { fullDocument: true }));
  page.close();

  // Printing before images decode would leave blanks.
  await Promise.all([...page.images].map((img) => img.decode?.().catch(() => undefined)));
  win.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 500), { once: true });
  win.focus();
  win.print();
}

/** Saves bytes or text as a file download. */
export function downloadFile(filename: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
