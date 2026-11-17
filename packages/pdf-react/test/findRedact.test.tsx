// @vitest-environment jsdom
// "Redact all matches" in the find bar: every match of the search is marked, and the apply-redactions dialog asks.
import { describe, expect, it } from "vitest";
import { makeSamplePdf, openPdf } from "@pli.dev/pdf";
import { PdfEditor } from "../src";
import { fakeRenderer } from "../src/testing";
import { renderPdf } from "../../pdf/test/support/render";
import { click, flush, key, q, qa, render, setValue, useHost } from "./harness";
import { beforeEach } from "vitest";

useHost();
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

async function mount(extra: Record<string, unknown> = {}) {
  const session = await openPdf(await makeSamplePdf(), { name: "sample.pdf", user: { id: "u1", name: "Ana Reyes" } });
  await render(<PdfEditor session={session} renderer={fakeRenderer({ pages: 2 })} viewport={{ width: 800, height: 600 }} defaultZoom={1} annotations={{ storageKey: "" }} {...extra} />);
  await flush();
  return session;
}

async function search(query: string) {
  await key(q(".pli-pdf-scroller"), "f", { ctrlKey: true });
  await flush();
  await setValue(q<HTMLInputElement>(".pli-pdf-find input[type=search]"), query);
  await flush(10);
}

const said = () => qa("[role=status]", document.body).map((e) => e.textContent).join(" | ");
const marks = (session: Awaited<ReturnType<typeof mount>>) => session.doc.pages.flatMap((p) => p.annots.filter((a) => a.type === "redact"));

describe("redact all matches", () => {
  it("marks every match in one undo step, asks, and applies on confirm so that the saved file has none of it", async () => {
    const session = await mount();
    await search("quick");
    const button = q<HTMLButtonElement>("button[aria-label='Redact all matches']");
    expect(button.disabled).toBe(false);
    await click(button);
    await flush();
    expect(marks(session)).toHaveLength(2);
    const dialog = q("dialog[open]");
    expect(dialog.querySelector(".pli-dialog-title")!.textContent).toBe("Apply redactions");
    expect(dialog.textContent).toContain("under 2 marks on 1 page");
    expect(said()).toContain("2 matches of \"quick\" marked for redaction");
    // Cancel keeps the marks (they are marks until applied); one undo takes all of them away
    await click(qa("dialog[open] button").find((b) => b.textContent === "Cancel")!);
    expect(marks(session)).toHaveLength(2);
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(marks(session)).toHaveLength(0);
    await key(q(".pli-pdf-scroller"), "z", { ctrlKey: true, shiftKey: true });
    expect(marks(session)).toHaveLength(2);
    // apply
    await click(button);
    await flush();
    await click(qa("dialog[open] button").find((b) => b.textContent === "Apply redactions")!);
    await flush();
    expect(marks(session)).toHaveLength(0);
    expect(session.doc.pages[1]!.edits!.some((e) => e.type === "redact")).toBe(true);
    const out = await session.save();
    const r = await renderPdf(out, 1, 1);
    expect(r.text).not.toContain("quick");
    expect(r.text).toContain("Pack my box");
    expect(Buffer.from(out).includes("quick")).toBe(false);
  });

  it("follows the match case and whole word switches of the find bar", async () => {
    const session = await mount();
    await search("QUICK");
    await click(q("button[aria-label='Match case']"));
    await flush(10);
    await click(q("button[aria-label='Redact all matches']"));
    await flush();
    expect(marks(session)).toHaveLength(0); // nothing is "QUICK" with the case
    expect(said()).toContain("No matches");
    expect(qa("dialog[open]")).toHaveLength(0);
  });

  it("is off with nothing to search for", async () => {
    await mount();
    await key(q(".pli-pdf-scroller"), "f", { ctrlKey: true });
    await flush();
    expect(q<HTMLButtonElement>("button[aria-label='Redact all matches']").disabled).toBe(true);
  });

  it("is not there in a read-only viewer", async () => {
    await mount({ readOnly: true });
    await key(q(".pli-pdf-scroller"), "f", { ctrlKey: true });
    await flush();
    expect(qa("button[aria-label='Redact all matches']")).toHaveLength(0);
  });

  it("is not there when the editor has no annotation tools", async () => {
    await mount({ annotations: false });
    await key(q(".pli-pdf-scroller"), "f", { ctrlKey: true });
    await flush();
    expect(qa("button[aria-label='Redact all matches']")).toHaveLength(0);
  });
});
