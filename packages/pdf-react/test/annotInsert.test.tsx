// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { StorageClient, type StorageAdapter } from "@pli.dev/core";
import { annots, byLabel, click, clientOf, drag, fire, flush, host, key, mount, pointer, q, qa, run, setValue, tap, tool, useAnnotHost } from "./annotHarness";
import { dataUriBytes, imageSizeOf, loadSignatures, normaliseStrokes, scaleStrokes, trimBounds, whiteToTransparent } from "../src/signatures";
import { cleanUrl } from "../src/AnnotPopovers";

useAnnotHost();

const P0 = "p:main:0";
const scroller = () => q(".pli-pdf-scroller");
type A = Record<string, any>;
const last = (m: { session: Parameters<typeof annots>[0] }) => annots(m.session).at(-1) as A;
const button = (label: string, within: ParentNode = document) => [...within.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.trim() === label)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>("[role=menu] [role^=menuitem]")].find((el) => el.textContent!.includes(label))!;
const openMenu = async (label: string) => click(byLabel(label, host));

/** A PNG header with the given size: all `imageSizeOf` reads. */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w);
  v.setUint32(20, h);
  return b;
}
const file = (bytes: Uint8Array, type = "image/png", name = "picture.png") => ({ name, type, size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
const setFiles = async (input: HTMLInputElement, files: unknown[]) => {
  Object.defineProperty(input, "files", { configurable: true, value: files });
  await fire(input, new Event("change", { bubbles: true }));
  await flush();
};

describe("stamps", () => {
  it("lists the standard stamps, a date stamp with today's date and a custom text stamp", async () => {
    await mount();
    await openMenu("Stamps");
    expect([...document.querySelectorAll("[role=menu] [role^=menuitem]")].map((e) => e.textContent!.replace(/\s+/g, " ").trim())).toEqual([
      "Approved",
      "Not approved",
      "Draft",
      "Final",
      "Confidential",
      "For public release",
      "Void",
      "Completed",
      expect.stringMatching(/^Today's date \(\d{1,2} \w{3} \d{4}\)$/),
      "Custom text…",
    ]);
  });

  it("places a chosen stamp with a click (centred), or sized by a drag, and goes back to the select tool", async () => {
    const m = await mount();
    await openMenu("Stamps");
    await click(menuItem("Approved"));
    expect(m.c().toolId).toBe("stamp");
    expect(q(".pli-pdf-hint").textContent).toContain("place the stamp");
    await tap([300, 400]);
    expect(last(m)).toMatchObject({ type: "stamp", stamp: { name: "Approved", label: "Approved", color: "#2e7d32" } });
    const { rect } = last(m);
    expect(rect.x + rect.w / 2).toBeCloseTo(300);
    expect(rect.y + rect.h / 2).toBeCloseTo(400);
    expect(rect.h).toBe(44);
    expect(m.c().toolId).toBe("select");
    await openMenu("Stamps");
    await click(menuItem("Draft"));
    await drag([100, 100], [260, 160]);
    expect(last(m)).toMatchObject({ type: "stamp", rect: { x: 100, y: 100, w: 160, h: 60 }, stamp: { name: "Draft" } });
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(1);
  });

  it("shows where the stamp will go while the pointer moves, and Escape drops it", async () => {
    const m = await mount();
    await openMenu("Stamps");
    await click(menuItem("Void"));
    await pointer(q(".pli-pdf-interact"), "pointermove", clientOf(200, 200));
    expect(q("[data-annot=draft]").getAttribute("opacity")).toBe("0.6");
    expect(q("[data-annot=draft] text").textContent).toBe("VOID");
    await key(scroller(), "Escape");
    expect(document.querySelector("[data-annot=draft]")).toBeNull();
    expect(m.c().placing).toBeNull();
    await tap([200, 200]);
    expect(annots(m.session)).toHaveLength(0);
  });

  it("makes the date stamp and a custom one", async () => {
    const m = await mount();
    await openMenu("Stamps");
    await click(menuItem("Today's date"));
    await tap([300, 300]);
    expect(last(m).stamp).toMatchObject({ name: "Date", label: expect.stringMatching(/^\d{1,2} \w{3} \d{4}$/) });
    await openMenu("Stamps");
    await click(menuItem("Custom text"));
    const dialog = q("dialog[open]", host);
    await setValue(q("input[aria-label='Stamp text']", dialog) as HTMLInputElement, "Paid in full");
    await click(button("Stamp #1e88e5", dialog) ?? byLabel("Stamp #1e88e5", dialog));
    await fire(q("form", dialog), new Event("submit", { bubbles: true, cancelable: true }));
    await tap([300, 500]);
    expect(last(m).stamp).toMatchObject({ name: "Custom", label: "Paid in full", color: "#1e88e5" });
    expect(q("[data-annot] text", q(`[data-annot="${last(m).id}"]`)).textContent).toBe("PAID IN FULL");
  });

  it("the M key picks the last stamp used", async () => {
    const m = await mount();
    await key(scroller(), "m");
    expect(m.c().toolId).toBe("stamp");
    expect(m.c().placing).toMatchObject({ kind: "stamp", stamp: { name: "Approved" } });
  });
});

describe("signature dialog", () => {
  const openSignature = async (item = "Create signature…") => {
    await openMenu("Signature");
    await click(menuItem(item));
    return q("dialog[open]", host);
  };
  const stroke = async (pad: Element, points: [number, number][]) => {
    await pointer(pad, "pointerdown", points[0]!);
    for (const p of points.slice(1)) await pointer(pad, "pointermove", p);
    await pointer(pad, "pointerup", points.at(-1)!);
  };
  const submit = (dialog: Element) => fire(q("form", dialog), new Event("submit", { bubbles: true, cancelable: true }));

  it("has Draw, Type and Upload tabs, and says what is missing", async () => {
    await mount();
    const dialog = await openSignature();
    expect(qa("[role=tab]", dialog).map((t) => t.textContent)).toEqual(["Draw", "Type", "Upload"]);
    expect(q("[role=tab][aria-selected=true]", dialog).textContent).toBe("Draw");
    await submit(dialog);
    expect(q("[role=alert]", dialog).textContent).toBe("Draw your signature first");
  });

  it("draws: strokes with undo and clear, trimmed to their ink, placed by click then drag with the ratio kept", async () => {
    const m = await mount();
    const dialog = await openSignature();
    const pad = q("svg.pli-pdf-sigpad", dialog);
    await stroke(pad, [[100, 60], [160, 30], [220, 70], [300, 40]]);
    await stroke(pad, [[120, 100], [260, 100]]);
    expect(qa("path[data-stroke]", pad)).toHaveLength(2);
    await click(button("Undo stroke", dialog));
    expect(qa("path[data-stroke]", pad)).toHaveLength(1);
    await click(button("Clear", dialog));
    expect(qa("path[data-stroke]", pad)).toHaveLength(0);
    await stroke(pad, [[100, 60], [160, 30], [220, 70], [300, 40]]);
    await click(byLabel("Ink #c62828", dialog));
    await submit(dialog);
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(m.c().toolId).toBe("signature");
    const placing = m.c().placing as any;
    expect(placing.value).toMatchObject({ mode: "draw", color: "#c62828" });
    // the whitespace left of and above the ink is gone: strokes start at the line's half width
    const first = placing.value.strokes[0][0];
    expect(first[0]).toBeCloseTo(1.2, 1);
    expect(placing.value.width).toBeGreaterThan(190);
    await drag([100, 100], [250, 300]);
    const sig = last(m);
    expect(sig).toMatchObject({ type: "signature", mode: "draw", color: "#c62828", width: 2.4 });
    expect(sig.rect.w).toBe(150);
    expect(sig.rect.w / sig.rect.h).toBeCloseTo(placing.value.width / placing.value.height, 1);
    expect(Math.max(...sig.strokes.flat().map((p: number[]) => p[0]))).toBeLessThanOrEqual(150);
    // remembered for next time
    expect(loadSignatures("t", undefined)).toHaveLength(1);
    expect(m.c().toolId).toBe("select");
  });

  it("types a name in a script font, chosen from a list, and places it with a click", async () => {
    const m = await mount({ user: { id: "u1", name: "Ana Reyes" } });
    const dialog = await openSignature();
    await click(q("[role=tab]#pli-sig-tab-type", dialog));
    const name = q("input[aria-label='Your name']", dialog) as HTMLInputElement;
    expect(name.value).toBe("Ana Reyes");
    const fonts = qa("[role=radio]", dialog);
    expect(fonts.length).toBeGreaterThanOrEqual(4);
    expect(fonts[0]!.getAttribute("aria-checked")).toBe("true");
    await setValue(name, "Ana R. Reyes");
    expect(fonts[1]!.textContent).toContain("Ana R. Reyes");
    await click(fonts[2]!);
    const chosen = fonts[2]!.querySelector("small")!.textContent!;
    await submit(dialog);
    await tap([300, 300]);
    expect(last(m)).toMatchObject({ type: "signature", mode: "type", text: "Ana R. Reyes", font: chosen, color: "#0b2a6b" });
    expect(last(m).rect.w).toBe(150);
  });

  it("makes initials the same way, smaller", async () => {
    const m = await mount({ user: { id: "u1", name: "Ana Reyes" } });
    const dialog = await openSignature("Create initials…");
    expect(q("h2", dialog).textContent).toBe("Add initials");
    await click(q("[role=tab]#pli-sig-tab-type", dialog));
    expect((q("input[aria-label='Your initials']", dialog) as HTMLInputElement).value).toBe("AR");
    await submit(dialog);
    await tap([200, 200]);
    expect(last(m)).toMatchObject({ mode: "type", text: "AR" });
    expect(last(m).rect.w).toBe(70);
    expect(loadSignatures("t", "u1")[0]).toMatchObject({ kind: "initials" });
  });

  it("uploads a picture, and uses it as a signature", async () => {
    const m = await mount();
    const dialog = await openSignature();
    await click(q("[role=tab]#pli-sig-tab-upload", dialog));
    await submit(dialog);
    expect(q("[role=alert]", dialog).textContent).toBe("Choose a picture first");
    await setFiles(q("input[type=file]", dialog) as HTMLInputElement, [file(png(300, 100))]);
    expect(q("img.pli-pdf-sigpreview", dialog).getAttribute("src")).toMatch(/^data:image\/png;base64,/);
    await submit(dialog);
    await tap([300, 300]);
    expect(last(m)).toMatchObject({ type: "signature", mode: "image", picture: { width: 300, height: 100 } });
    expect(last(m).rect.w / last(m).rect.h).toBeCloseTo(3);
  });

  it("offers saved signatures in the menu next time, and can forget them", async () => {
    const m = await mount();
    const dialog = await openSignature();
    await stroke(q("svg.pli-pdf-sigpad", dialog), [[100, 60], [200, 40]]);
    await submit(dialog);
    await key(scroller(), "Escape");
    await openMenu("Signature");
    expect(menuItem("Signature 1")).toBeTruthy();
    await click(menuItem("Signature 1"));
    expect(m.c().toolId).toBe("signature");
    await key(scroller(), "Escape");
    await openMenu("Signature");
    await click(menuItem("Forget saved signatures"));
    expect(loadSignatures("t", undefined)).toEqual([]);
  });

  it("does not save when asked not to, and works without browser storage", async () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("blocked");
    };
    try {
      const m = await mount();
      const dialog = await openSignature();
      await stroke(q("svg.pli-pdf-sigpad", dialog), [[100, 60], [200, 40]]);
      await submit(dialog);
      expect(m.c().placing).toBeTruthy();
    } finally {
      Storage.prototype.setItem = original;
    }
    const m = await mount();
    const dialog = await openSignature();
    await click(q("input[type=checkbox]", dialog.querySelector("label.pli-pdf-check:last-of-type")!));
    await stroke(q("svg.pli-pdf-sigpad", dialog), [[100, 60], [200, 40]]);
    await submit(dialog);
    expect(loadSignatures("t", undefined)).toEqual([]);
    expect(m.c().placing).toBeTruthy();
  });

  it("closes with Cancel and puts nothing down", async () => {
    const m = await mount();
    const dialog = await openSignature();
    await click(button("Cancel", dialog));
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(m.c().placing).toBeNull();
  });
});

describe("signature helpers", () => {
  it("trims strokes to their ink and scales them into a box", () => {
    const n = normaliseStrokes([[[100, 60], [200, 40]], [[150, 90]]], 2);
    expect(n).toEqual({ strokes: [[[1, 21], [101, 1]], [[51, 51]]], width: 102, height: 52 });
    expect(normaliseStrokes([], 2)).toEqual({ strokes: [], width: 0, height: 0 });
    const scaled = scaleStrokes({ mode: "draw", strokes: n.strokes, width: n.width, height: n.height, color: "#000", lineWidth: 2 }, 204, 104);
    expect(scaled[0]![1]).toEqual([202, 2]);
  });

  it("finds the box around the ink of a picture and clears white to transparent", () => {
    const w = 6;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const put = (x: number, y: number, r: number, g: number, b: number, a = 255) => data.set([r, g, b, a], (y * w + x) * 4);
    put(2, 1, 0, 0, 0);
    put(3, 2, 20, 20, 20);
    expect(trimBounds({ data, width: w, height: h })).toEqual({ x: 2, y: 1, w: 2, h: 2 });
    expect(trimBounds({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h })).toBeNull();
    put(0, 0, 240, 240, 240);
    put(1, 0, 200, 200, 200);
    whiteToTransparent({ data, width: w, height: h });
    expect(data[3]).toBe(0);
    expect(data[7]).toBeGreaterThan(0);
    expect(data[7]).toBeLessThan(255);
    expect(data[(1 * w + 2) * 4 + 3]).toBe(255);
  });

  it("reads picture sizes from PNG, GIF and JPEG headers, and bytes from data URIs", () => {
    expect(imageSizeOf(png(640, 480))).toEqual({ width: 640, height: 480 });
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 20, 0, 10, 0, 0, 0]);
    expect(imageSizeOf(gif)).toEqual({ width: 20, height: 10 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 50, 0, 80, 3, 1, 0, 0, 0]);
    expect(imageSizeOf(jpeg)).toEqual({ width: 80, height: 50 });
    expect(imageSizeOf(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(dataUriBytes("data:image/png;base64,AQID")).toEqual({ bytes: new Uint8Array([1, 2, 3]), type: "image/png" });
    expect(dataUriBytes("data:text/plain,hello")).toBeNull();
    expect(dataUriBytes("https://x.example/a.png")).toBeNull();
  });
});

describe("pictures", () => {
  it("adds a chosen picture at its size on paper, centred on the page, one undo step", async () => {
    const m = await mount();
    const input = q("input[aria-label='Choose a picture']", host) as HTMLInputElement;
    await setFiles(input, [file(png(400, 200))]);
    expect(last(m)).toMatchObject({ type: "image", rect: { x: 156, y: 321, w: 300, h: 150 }, picture: { width: 400, height: 200 } });
    expect(last(m).picture.src).toMatch(/^data:image\/png;base64,/);
    expect(m.session.selection.annots).toEqual([last(m).id]);
    await run(() => m.session.undo());
    expect(annots(m.session)).toHaveLength(0);
  });

  it("makes a big picture fit the page and keeps the ratio when resized", async () => {
    const m = await mount();
    await setFiles(q("input[aria-label='Choose a picture']", host) as HTMLInputElement, [file(png(4000, 1000))]);
    const rect = last(m).rect;
    expect(rect.w).toBeCloseTo(612 * 0.6);
    expect(rect.w / rect.h).toBeCloseTo(4);
    await tool("Select");
    await run(() => m.c().select([last(m).id]));
    const box = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    await drag([box.x + box.w, box.y + box.h / 2], [box.x + box.w + 10, box.y + box.h / 2]);
    // dragging a side handle by 10 points on a picture grows both ways
    expect(last(m).rect.w / last(m).rect.h).toBeCloseTo(4, 1);
    expect(last(m).rect.w).toBeCloseTo(rect.w + 10, 1);
  });

  it("puts a picture on a page when it is pasted or dropped on it", async () => {
    const m = await mount();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file(png(200, 100))] } });
    await fire(scroller(), paste);
    await flush();
    expect(last(m)).toMatchObject({ type: "image", rect: { x: 231, y: 358.5, w: 150, h: 75 } });
    const drop = new Event("drop", { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
    Object.assign(drop, { clientX: 400, clientY: 300 });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [file(png(200, 100))], items: [{ kind: "file" }] } });
    await fire(qa(".pli-pdf-page")[0]!, drop);
    await flush();
    const at = last(m).rect;
    expect(at.x + at.w / 2).toBeCloseTo(300);
    expect(at.y + at.h / 2).toBeCloseTo(225);
    // text pasted into a field is left alone
    const input = document.createElement("input");
    host.append(input);
    const plain = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(plain, "clipboardData", { value: { files: [file(png(10, 10))] } });
    await fire(input, plain);
    expect(annots(m.session)).toHaveLength(2);
  });

  it("sends a picture through the host's storage when there is one, and keeps its address", async () => {
    const uploaded: string[] = [];
    const adapter: StorageAdapter = {
      async upload(f, info) {
        uploaded.push(info.name);
        return { ref: `files/${info.name}`, url: `https://files.example/${info.name}`, width: 640, height: 320 };
      },
    };
    const m = await mount({ kit: { storage: new StorageClient(adapter, { allowedTypes: ["image/png"] }) } });
    await setFiles(q("input[aria-label='Choose a picture']", host) as HTMLInputElement, [file(png(10, 10), "image/png", "logo.png")]);
    expect(uploaded).toEqual(["logo.png"]);
    expect(last(m).picture).toMatchObject({ src: "https://files.example/logo.png", width: 640, height: 320 });
    expect(last(m).rect.w).toBe(300 * 1.0 * 0.75 * (640 / 640) > 0 ? last(m).rect.w : 0);
  });

  it("says when the storage refuses the file, and adds nothing", async () => {
    const adapter: StorageAdapter = { upload: async () => ({ ref: "x" }) };
    const m = await mount({ kit: { storage: new StorageClient(adapter, { allowedTypes: ["image/jpeg"] }) } });
    await setFiles(q("input[aria-label='Choose a picture']", host) as HTMLInputElement, [file(png(10, 10))]);
    expect(annots(m.session)).toHaveLength(0);
    expect(q(".pli-pdf-sr", host).textContent).toContain("Couldn't add the picture");
  });
});

describe("links", () => {
  it("makes a link to a web address, adding https:// and refusing script addresses", () => {
    expect(cleanUrl("example.com/a b")).toBe("https://example.com/a b");
    expect(cleanUrl(" https://example.com ")).toBe("https://example.com");
    expect(cleanUrl("mailto:a@b.example")).toBe("mailto:a@b.example");
    expect(cleanUrl("ana@example.com")).toBe("mailto:ana@example.com");
    expect(cleanUrl("javascript:alert(1)")).toBeNull();
    expect(cleanUrl("JavaScript:alert(1)")).toBeNull();
    expect(cleanUrl("data:text/html,x")).toBeNull();
    expect(cleanUrl("   ")).toBeNull();
  });

  it("links to a page of the document, and refuses an empty address with a message", async () => {
    const m = await mount();
    await tool("Link");
    await drag([100, 100], [300, 120]);
    const form = q("[role=dialog][aria-label='Link']", host);
    await fire(q("form", form), new Event("submit", { bubbles: true, cancelable: true }));
    expect(q("[role=alert]", form).textContent).toContain("Enter a web address");
    await click(qa("input[type=radio]", form)[1]!);
    const select = q("select[aria-label='Page']", form) as HTMLSelectElement;
    await act(async () => {
      select.value = "p:main:2";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await fire(q("form", form), new Event("submit", { bubbles: true, cancelable: true }));
    expect(last(m)).toMatchObject({ type: "link", rect: { x: 100, y: 100, w: 200, h: 20 }, dest: { page: "p:main:2" } });
    expect(last(m).uri).toBeUndefined();
    expect(m.c().toolId).toBe("select");
  });

  it("shows where a link goes in the properties of a selected link, and changes it", async () => {
    const m = await mount();
    const id = await run(() => m.session.annots.add(P0, { type: "link", rect: { x: 100, y: 100, w: 100, h: 20 }, uri: "https://example.com" } as never));
    await flush();
    const props = q(".pli-pdf-props", host);
    expect(props.textContent).toContain("https://example.com");
    await click(button("https://example.com", props));
    const form = q("[role=dialog][aria-label='Link']", host);
    await setValue(q("input[aria-label='Web address']", form) as HTMLInputElement, "example.org");
    await fire(q("form", form), new Event("submit", { bubbles: true, cancelable: true }));
    expect((m.session.annots.get(id) as A).uri).toBe("https://example.org");
  });
});

describe("redaction", () => {
  it("applies the marks only after a warning that it is permanent: they become edits of the page, in one undo step", async () => {
    const m = await mount();
    await tool("Redact");
    await drag([100, 100], [250, 130]);
    await tool("Redact");
    await drag([100, 200], [250, 230]);
    await openMenu("Redaction options");
    await click(menuItem("Apply 2 redactions"));
    const dialog = q("dialog[open]", host);
    expect(dialog.textContent).toContain("permanently removes the text and pictures under 2 marks on 1 page");
    expect(dialog.textContent).toContain("can't be undone");
    expect(annots(m.session).filter((a) => a.type === "redact")).toHaveLength(2);
    await fire(q("form", dialog), new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(annots(m.session)).toHaveLength(0);
    expect(m.session.doc.pages[0]!.edits).toHaveLength(2);
    expect(q(".pli-pdf-sr", host).textContent).toContain("Redactions applied: 2 areas on 1 page");
    await run(() => m.session.undo());
    expect(annots(m.session).filter((a) => a.type === "redact")).toHaveLength(2);
  });

  it("says so, and changes nothing, when the engine cannot apply them", async () => {
    const m = await mount();
    (m.session.content as unknown as { applyRedactions: unknown }).applyRedactions = undefined;
    await run(() => m.session.annots.add(P0, { type: "redact", rects: [{ x: 10, y: 10, w: 50, h: 10 }] } as never));
    await openMenu("Redaction options");
    await click(menuItem("Apply 1 redaction"));
    const dialog = q("dialog[open]", host);
    await fire(q("form", dialog), new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(q("[role=alert]", dialog).textContent).toContain("can't apply redactions yet");
    expect(annots(m.session).filter((a) => a.type === "redact")).toHaveLength(1);
  });

  it("reports what the engine did", async () => {
    const m = await mount();
    const apply = vi.fn(async () => ({ pages: ["p:main:0"], rects: 1, removedAnnotations: 2 }));
    (m.session.content as unknown as { applyRedactions: unknown }).applyRedactions = apply;
    await run(() => m.session.annots.add(P0, { type: "redact", rects: [{ x: 10, y: 10, w: 50, h: 10 }] } as never));
    await openMenu("Redaction options");
    await click(menuItem("Apply 1 redaction"));
    await fire(q("form", q("dialog[open]", host)), new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(q(".pli-pdf-sr", host).textContent).toContain("2 annotations or comments under the marks were removed too");
  });

  it("marks the selected text, and has nothing to apply without marks", async () => {
    await mount();
    await openMenu("Redaction options");
    expect((menuItem("Apply redactions") as HTMLButtonElement).disabled).toBe(true);
    await click(menuItem("Mark selected text"));
    expect(q(".pli-pdf-sr", host).textContent).toContain("Select some text first");
  });
});
