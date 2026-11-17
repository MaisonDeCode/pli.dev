// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// A renderer that draws labelled rectangles: pdf.js needs a real canvas.
vi.mock("@pli.dev/pdf-react/pdfjs", async () => {
  const { fakeRenderer } = await import("../../../packages/pdf-react/src/testing");
  return { pdfjsRenderer: () => fakeRenderer({ pages: 2 }) };
});

import { PdfDemo } from "../src/pdf/PdfDemo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

describe("the PDF demo", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("makes the sample file in the browser and opens the full editor on it", async () => {
    await act(async () => root.render(<PdfDemo />));
    await settle();
    await settle();
    expect(host.querySelector(".pli-pdf")).not.toBeNull();
    expect(host.querySelectorAll(".pli-pdf-page").length).toBeGreaterThan(0);
    expect(host.querySelector(".pli-pdf-ribbon")).not.toBeNull(); // annotation tools
    expect(host.querySelectorAll(".pli-form-widget").length).toBe(4); // the sample's form
    expect(host.querySelector("[aria-label='Open a PDF file']")).not.toBeNull();
    expect(host.querySelector("[aria-label='Sidebar'][role=tablist]")!.textContent).toContain("Comments");
  });

  it("opens a dropped PDF, and says so when the file is not one", async () => {
    await act(async () => root.render(<PdfDemo />));
    await settle();
    await settle();
    const { makeSamplePdf } = await import("@pli.dev/pdf");
    const bytes = await makeSamplePdf({ title: "Dropped" });
    const file = (name: string, data: Uint8Array) => ({ name, type: "application/pdf", arrayBuffer: async () => data.slice().buffer as ArrayBuffer });
    const drop = (file: unknown) => {
      const event = new Event("drop", { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
      event.dataTransfer = { files: [file], items: [{ kind: "file" }] };
      return act(async () => void host.querySelector(".pdf-demo")!.dispatchEvent(event));
    };
    await drop(file("mine.pdf", bytes));
    await settle();
    await settle();
    expect(host.querySelector(".pdf-demo-error")).toBeNull();
    expect(host.querySelector("[aria-label='Rename mine.pdf']")).not.toBeNull();
    await drop(file("broken.pdf", new TextEncoder().encode("nope")));
    await settle();
    expect(host.querySelector(".pdf-demo-error")!.textContent).toMatch(/Could not open/);
  });

  it("shows the drop hint only while a file is being dragged over the window", async () => {
    await act(async () => root.render(<PdfDemo />));
    await settle();
    const demo = () => host.querySelector(".pdf-demo") as HTMLElement;
    const over = () => {
      const event = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
      event.dataTransfer = { files: [], items: [{ kind: "file" }] };
      return act(async () => void demo().dispatchEvent(event));
    };
    expect(demo().hasAttribute("data-dragging")).toBe(false);
    await over();
    expect(demo().hasAttribute("data-dragging")).toBe(true);
    // The drag left, or was cancelled, without a `dragleave` on the demo itself: the hint goes by itself.
    await act(async () => void (await new Promise((r) => setTimeout(r, 400))));
    expect(demo().hasAttribute("data-dragging")).toBe(false);
    // A drag that ends anywhere hides it at once.
    await over();
    await act(async () => void window.dispatchEvent(new Event("dragend")));
    expect(demo().hasAttribute("data-dragging")).toBe(false);
    // A drag of something that is not a file never shows it.
    const text = new Event("dragover", { bubbles: true, cancelable: true }) as Event & { dataTransfer?: unknown };
    text.dataTransfer = { files: [], items: [{ kind: "string" }] };
    await act(async () => void demo().dispatchEvent(text));
    expect(demo().hasAttribute("data-dragging")).toBe(false);
  });

  it("draws the drop hint only through the dragging rule of the stylesheet", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(`${process.cwd()}/apps/playground/src/app.css`, "utf8");
    expect(css).toMatch(/\.pdf-demo:not\(\[data-dragging\]\)::after\s*\{\s*content:\s*none/);
    expect(css).toMatch(/\.pdf-demo\[data-dragging\]::after\s*\{[^}]*pointer-events:\s*none/);
  });
});
