// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DocumentSession, createDoc, paragraph } from "@pli.dev/docs";
import { DownloadProvider, PliDocument, bytesOf, handOver, useDownloadHandler, type DownloadFile, type DownloadHandler } from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
const saved: { download: string | null; type: string }[] = [];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  saved.length = 0;
  // jsdom can't make object URLs or follow a link, so note what would have been downloaded.
  URL.createObjectURL = ((blob: Blob) => `blob:test/${blob.size}-${blob.type}`) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ download: this.getAttribute("download"), type: this.href.split("-").slice(1).join("-") });
  });
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("handOver", () => {
  it("downloads in the browser when there is no function", async () => {
    await handOver(undefined, "a.txt", "hello", "text/plain");
    expect(saved).toEqual([{ download: "a.txt", type: "text/plain" }]);
  });

  it("gives a function the file as bytes, whatever the export made", async () => {
    const got: DownloadFile[] = [];
    const take: DownloadHandler = (file) => void got.push(file);
    await handOver(take, "t.md", "héllo", "text/markdown");
    await handOver(take, "b.bin", new Uint8Array([1, 2, 3]).buffer, "application/octet-stream");
    await handOver(take, "c.bin", new Uint8Array([4, 5]), "application/octet-stream");
    expect(got.map((f) => [f.name, f.type, [...f.data]])).toEqual([
      ["t.md", "text/markdown", [...new TextEncoder().encode("héllo")]],
      ["b.bin", "application/octet-stream", [1, 2, 3]],
      ["c.bin", "application/octet-stream", [4, 5]],
    ]);
    expect(saved).toEqual([]);
  });

  it("lets the function fall back to the browser, for some files or some places", async () => {
    const take: DownloadHandler = (file, { browserDownload }) => (file.name.endsWith(".pdf") ? browserDownload() : undefined);
    await handOver(take, "a.pdf", new Uint8Array([1]), "application/pdf");
    await handOver(take, "b.docx", new Uint8Array([2]), "application/x");
    expect(saved).toEqual([{ download: "a.pdf", type: "application/pdf" }]);
  });

  it("waits for the function and passes on what it throws, whether it throws at once or later", async () => {
    let finished = false;
    await handOver(async () => {
      await new Promise((r) => setTimeout(r, 5));
      finished = true;
    }, "a", "x", "text/plain");
    expect(finished).toBe(true);
    await expect(handOver(() => Promise.reject(new Error("no room")), "a", "x", "text/plain")).rejects.toThrow("no room");
    await expect(handOver(() => { throw new Error("now"); }, "a", "x", "text/plain")).rejects.toThrow("now");
  });

  it("views typed arrays and buffers without copying them wrongly", () => {
    const big = new Uint8Array([9, 8, 7, 6]);
    expect([...bytesOf(big.subarray(1, 3))]).toEqual([8, 7]);
    expect([...bytesOf(new DataView(big.buffer, 2, 2))]).toEqual([7, 6]);
  });
});

describe("DownloadProvider", () => {
  function Probe({ own, seen }: { own?: DownloadHandler; seen: (h: DownloadHandler | undefined) => void }) {
    seen(useDownloadHandler(own));
    return null;
  }

  it("gives the nearest function, and an editor's own wins", () => {
    const outer: DownloadHandler = () => undefined;
    const inner: DownloadHandler = () => undefined;
    const own: DownloadHandler = () => undefined;
    const found: (DownloadHandler | undefined)[] = [];
    act(() =>
      root.render(
        <>
          <Probe seen={(h) => found.push(h)} />
          <DownloadProvider onDownload={outer}>
            <Probe seen={(h) => found.push(h)} />
            <DownloadProvider onDownload={inner}>
              <Probe seen={(h) => found.push(h)} />
              <Probe own={own} seen={(h) => found.push(h)} />
            </DownloadProvider>
          </DownloadProvider>
        </>,
      ),
    );
    expect(found).toEqual([undefined, outer, inner, own]);
  });
});

describe("File > Download in Documents", () => {
  const session = () => new DocumentSession(createDoc("Report", [paragraph("Hello")]));
  const pick = (match: (b: HTMLElement) => boolean) => act(() => void [...host.querySelectorAll<HTMLElement>("button, [role=menuitem]")].find(match)!.click());
  const downloadDocx = async () => {
    pick((b) => b.textContent?.trim().startsWith("File") ?? false);
    pick((b) => b.textContent?.startsWith("Download") ?? false);
    pick((b) => b.textContent?.includes("DOCX document") ?? false);
    await act(async () => {});
  };

  it("downloads in the browser by default", async () => {
    act(() => root.render(<PliDocument session={session()} />));
    await downloadDocx();
    expect(saved.map((s) => s.download)).toEqual(["Report.docx"]);
  });

  it("uses the provider's function for every editor inside it", async () => {
    const got: DownloadFile[] = [];
    act(() =>
      root.render(
        <DownloadProvider onDownload={(file) => void got.push(file)}>
          <PliDocument session={session()} />
        </DownloadProvider>,
      ),
    );
    await downloadDocx();
    expect(got.map((f) => f.name)).toEqual(["Report.docx"]);
    expect(saved).toEqual([]);
  });

  it("prefers the editor's own function to the provider's", async () => {
    const outer = vi.fn();
    const own = vi.fn();
    act(() =>
      root.render(
        <DownloadProvider onDownload={outer}>
          <PliDocument session={session()} onDownload={own} />
        </DownloadProvider>,
      ),
    );
    await downloadDocx();
    expect(own).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("can fall back to the browser from the function", async () => {
    act(() => root.render(<PliDocument session={session()} onDownload={(_file, { browserDownload }) => browserDownload()} />));
    await downloadDocx();
    expect(saved.map((s) => s.download)).toEqual(["Report.docx"]);
  });

  it("tells the person the file couldn't be saved when the function rejects, with its reason", async () => {
    act(() => root.render(<PliDocument session={session()} onDownload={() => Promise.reject(new Error("the drive is full"))} />));
    await downloadDocx();
    await act(async () => {});
    expect(host.textContent).toContain("The file couldn't be saved: the drive is full");
  });
});
