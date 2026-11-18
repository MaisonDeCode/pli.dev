// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { type FilePickRequest } from "@pli.dev/react";
import { byLabel, chooseMenu, click, flush, menuButton, q, qa } from "./harness";
import { bluePng, editPdf, mountEditor, useEditHost } from "./editHarness";
import { fileOf } from "./pagesSupport";
import { mount as mountForms, control, run } from "./formsHarness";

useEditHost();

const labelOf = (e: Element) => e.querySelector(".pli-menu-label")?.textContent ?? e.textContent ?? "";
/** The entries of a menu, in order ("—" for a divider). */
async function entries(menu: string): Promise<string[]> {
  await click(menuButton(menu));
  const list = qa("[role=menu]", document)[0]!;
  const out = [...list.children].map((e) => (e.getAttribute("role") === "separator" ? "—" : labelOf(e)));
  await click(menuButton(menu)); // closes it again
  return out;
}
const bars = () => qa(".pli-menubar-button").map((b) => b.textContent);
const png = bluePng(20, 10);
const imageFile = (name = "dot.png") => fileOf(name, png, "image/png") as unknown as File;
const pdfFile = (name = "other.pdf") => fileOf(name, editPdf()) as unknown as File;

describe("extraMenus", () => {
  it("adds items to the end of a menu the editor has, after a divider, and calls their handler", async () => {
    const onSelect = vi.fn();
    await mountEditor(editPdf(), { props: { extraMenus: { File: [{ label: "Share with the team…", onSelect }], Insert: [{ label: "Clause" }] } } });
    const file = await entries("File");
    expect(file.at(-1)).toBe("Share with the team…");
    expect(file.at(-2)).toBe("—");
    expect((await entries("Insert")).slice(-2)).toEqual(["—", "Clause"]);
    await chooseMenu("File", "Share with the team…");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("puts a menu of its own before Help, and keeps the editor's menus as they were", async () => {
    const summarize = vi.fn();
    await mountEditor(editPdf(), { props: { extraMenus: { AI: [{ label: "Summarize", onSelect: summarize }, { label: "Rewrite", items: [{ label: "Shorter" }] }] } } });
    const names = bars();
    expect(names).toEqual(["File", "Edit", "View", "Insert", "Format", "Tools", "AI", "Help"]);
    expect(await entries("AI")).toEqual(["Summarize", "Rewrite"]);
    await chooseMenu("AI", "Summarize");
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(await entries("Help")).toEqual(["Keyboard shortcuts"]);
  });

  it("puts items next to a built-in item with `after` and `before`", async () => {
    const plain = await mountEditor(editPdf(), { props: {} });
    const base = await entries("Insert");
    expect(base.length).toBeGreaterThan(1);
    const first = base[0]!;
    await mountEditor(editPdf(), { props: { extraMenus: { Insert: { items: [{ label: "After first" }], after: first } } } });
    expect((await entries("Insert")).slice(0, 2)).toEqual([first, "After first"]);
    await mountEditor(editPdf(), { props: { extraMenus: { Insert: { items: [{ label: "Before first" }], before: first } } } });
    expect((await entries("Insert")).slice(0, 2)).toEqual(["Before first", first]);
    expect(plain.session.doc.pages.length).toBeGreaterThan(0);
  });

  it("leaves the editor's own items read-only when the file is, and keeps the host's items as the host made them", async () => {
    const onSelect = vi.fn();
    await mountEditor(editPdf(), { props: { readOnly: true, extraMenus: { File: [{ label: "Mine", onSelect }] } } });
    await chooseMenu("File", "Mine");
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("changes with the prop", async () => {
    const { render } = await import("./harness");
    const { PdfEditor } = await import("../src");
    const { fakeRenderer } = await import("../src/testing");
    const { openPdf } = await import("@pli.dev/pdf");
    const session = await openPdf(editPdf(), { name: "edit.pdf" });
    const renderer = fakeRenderer({ pages: 1 });
    const el = (extra?: Record<string, { label: string }[]>) => <PdfEditor session={session} renderer={renderer} viewport={{ width: 800, height: 600 }} defaultZoom={1} annotations={{ storageKey: "" }} extraMenus={extra} />;
    await render(el());
    expect(bars()).not.toContain("Reports");
    await render(el({ Reports: [{ label: "Monthly" }] }));
    await flush();
    expect(bars()).toContain("Reports");
    await render(el());
    await flush();
    expect(bars()).not.toContain("Reports");
  });

  it("adds a File entry to the File button of the toolbar when there is no menu bar", async () => {
    const onSelect = vi.fn();
    await mountEditor(editPdf(), { props: { menu: false, topToolbar: true, onSave: () => {}, extraMenus: { File: [{ label: "Archive", onSelect }] } } });
    await click(byLabel("File"));
    const item = qa("[role=menu] [role^=menuitem]", document).find((e) => labelOf(e) === "Archive");
    expect(item).toBeDefined();
    await click(item!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("filePicker", () => {
  it("is asked for the file when a PDF is opened, with the purpose and the file types, and what it returns is what is opened", async () => {
    const requests: FilePickRequest[] = [];
    const onOpen = vi.fn();
    await mountEditor(editPdf(), {
      props: {
        onOpen,
        filePicker: (r: FilePickRequest) => {
          requests.push(r);
          return pdfFile("from-my-app.pdf");
        },
      },
    });
    await chooseMenu("File", "Open PDF…");
    await flush();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ purpose: "open", accept: "application/pdf,.pdf", multiple: false });
    expect(typeof requests[0]!.label).toBe("string");
    expect(typeof requests[0]!.browse).toBe("function");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![1]).toBe("from-my-app.pdf");
    expect(onOpen.mock.calls[0]![0]).toBeInstanceOf(Uint8Array);
  });

  it("does nothing when the picker gives back null or an empty list, and never opens the browser's chooser", async () => {
    const onOpen = vi.fn();
    const clicked = vi.spyOn(HTMLInputElement.prototype, "click");
    for (const answer of [null, [] as File[], undefined]) {
      await mountEditor(editPdf(), { props: { onOpen, filePicker: () => answer } });
      await chooseMenu("File", "Open PDF…");
      await flush();
    }
    expect(onOpen).not.toHaveBeenCalled();
    expect(clicked).not.toHaveBeenCalled();
    clicked.mockRestore();
  });

  it("is asked for a picture to add, and puts what it returns on the page; the editor draws no file input of its own", async () => {
    const requests: FilePickRequest[] = [];
    const { session } = await mountEditor(editPdf(), {
      props: {
        filePicker: (r: FilePickRequest) => {
          requests.push(r);
          return imageFile();
        },
      },
    });
    expect(document.querySelector("input[type=file]")).toBeNull();
    await chooseMenu("Insert", "Image…");
    await flush(8);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ purpose: "image", accept: "image/png,image/jpeg", multiple: false });
    expect(session.doc.pages[0]!.annots.map((a) => a.type)).toContain("image");
  });

  it("adds no picture when the picker is cancelled", async () => {
    const { session } = await mountEditor(editPdf(), { props: { filePicker: () => null } });
    const before = session.doc.pages[0]!.annots.length;
    await chooseMenu("Insert", "Image…");
    await flush(8);
    expect(session.doc.pages[0]!.annots.length).toBe(before);
  });

  it("is asked for the files of Insert > Pages from a file, as several files to import", async () => {
    const requests: FilePickRequest[] = [];
    const { session } = await mountEditor(editPdf(), {
      props: {
        filePicker: (r: FilePickRequest) => {
          requests.push(r);
          return [pdfFile("more.pdf")];
        },
      },
    });
    const pages = session.doc.pages.length;
    await chooseMenu("Insert", "Pages from a file…");
    await flush(10);
    expect(requests[0]).toMatchObject({ purpose: "import", multiple: true });
    expect(requests[0]!.accept).toContain("application/pdf");
    expect(session.doc.pages.length).toBe(pages + 1);
  });

  it("without a picker keeps the hidden file input of the picture button, as before", async () => {
    await mountEditor(editPdf(), {});
    expect(document.querySelector("input[type=file][aria-label='Choose a picture']")).not.toBeNull();
    expect(q(".pli-pdf")).toBeTruthy();
  });

  it("is asked for the picture of a signature, in the dialog, which shows a button instead of a file input", async () => {
    const requests: FilePickRequest[] = [];
    await mountEditor(editPdf(), {
      props: {
        filePicker: (r: FilePickRequest) => {
          requests.push(r);
          return imageFile("sig.png");
        },
      },
    });
    await chooseMenu("Insert", "Signature", "Create signature…");
    const dialog = q("dialog[open]", document as unknown as ParentNode);
    await click(q("[role=tab]#pli-sig-tab-upload", dialog));
    expect(dialog.querySelector("input[type=file]")).toBeNull();
    const button = qa("button", dialog).find((b) => b.textContent === "Choose a picture…")!;
    await click(button);
    await flush(8);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ purpose: "image", accept: "image/png,image/jpeg", multiple: false });
    expect(q("img.pli-pdf-sigpreview", dialog).getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });

  it("is asked for the data file of Import data, and fills the form from what it returns", async () => {
    const requests: FilePickRequest[] = [];
    const data = new File([JSON.stringify({ name: "From my app" })], "data.json", { type: "application/json" });
    const { session, c } = await mountForms({
      props: {
        filePicker: (r: FilePickRequest) => {
          requests.push(r);
          return data;
        },
      },
    });
    expect(document.querySelector("input[aria-label='Import form data']")).toBeNull();
    await run(async () => c().actions.pickFile?.());
    await flush(8);
    expect(requests[0]).toMatchObject({ purpose: "import", accept: "application/json,.json", multiple: false });
    expect(session.forms.byName("name")?.value).toBe("From my app");
    expect(control("name").value).toBe("From my app");
  });
});
