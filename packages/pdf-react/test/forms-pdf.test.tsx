// @vitest-environment jsdom
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { openPdf } from "@pli.dev/pdf";
import { FormsPdf } from "../src";
import { fakeRenderer } from "../src/testing";
import { chooseMenu, click, control, drag, fixture, flush, host, openProperties, press, q, qa, render, replaceText, run, togglePrepareForm, toolButton, typeInto, useFormsHost, viewport } from "./formsHarness";

useFormsHost();
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // no storage
  }
});

async function mountBoth(props: Record<string, unknown> = {}, annotations: false | Record<string, unknown> = { storageKey: "t" }) {
  const session = await openPdf(fixture("forms-basic"));
  const renderer = fakeRenderer({ pages: [{ width: 300, height: 400 }] });
  await render(<FormsPdf session={session} renderer={renderer} viewport={viewport} defaultZoom={1} annotations={annotations as never} {...props} />);
  await flush();
  return session;
}

describe("FormsPdf: the form tools together with the annotation tools", () => {
  it("shows the form, the annotation ribbon, the Form menu and the form bar", async () => {
    await mountBoth();
    expect(q(".pli-pdf-formbar")).not.toBeNull();
    expect(document.querySelector(".pli-pdf-ribbon")).not.toBeNull();
    expect(control("name").value).toBe("Sample Name");
    expect(document.querySelector(".pli-pdf-toolbar")).toBeNull();
    await chooseMenu("Tools", "Form"); // the Form menu is in Tools; with topToolbar it is a drop-down in the toolbar too
    expect(qa("[role=menu] [role^='menuitem']").map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Export data")]));
  });

  it("typing letters that are annotation shortcuts in a field types them and changes no tool", async () => {
    const session = await mountBoth();
    await typeInto(control("name"), "thfx");
    expect(session.forms.byName("name")!.value).toBe("Sample Namethfx");
    expect(document.querySelector("[data-active-tool]")?.getAttribute("data-active-tool") ?? null).toBeNull();
  });

  it("a click on a signature field opens the signature dialog of the annotation tools", async () => {
    await mountBoth();
    expect(document.querySelector(".pli-pdf-sig")).toBeNull();
    await click(control("sig"));
    expect(document.querySelector(".pli-pdf-sig")).not.toBeNull();
  });

  it("the host's onSign wins", async () => {
    const calls: string[] = [];
    await mountBoth({ forms: { onSign: (f: { name: string }) => calls.push(f.name) } });
    await click(control("sig"));
    expect(calls).toEqual(["sig"]);
    expect(document.querySelector(".pli-pdf-sig")).toBeNull();
  });

  it("Prepare form puts its panel on the right, and the annotation panel is back when it is closed", async () => {
    const session = await mountBoth();
    await togglePrepareForm();
    expect(document.querySelector(".pli-pdf-right")).toBeNull(); // nothing selected yet
    await openProperties();
    expect(document.querySelector(".pli-pdf-right .pli-form-props")).not.toBeNull();
    await click(toolButton("Text field"));
    await drag([212, 152], [288, 176]);
    expect(session.doc.fields).toHaveLength(9);
    await replaceText(qa<HTMLInputElement>(".pli-form-props input[type=text]")[0]!, "extra");
    expect(session.forms.byName("extra")).toBeDefined();
    await click([...qa("button", q(".pli-pdf-designbar"))].find((b) => b.textContent === "Done"));
    expect(document.querySelector(".pli-form-props")).toBeNull();
  });

  it("works with the form tools alone", async () => {
    const session = await mountBoth({}, false);
    expect(document.querySelector("button[aria-label='Highlight']")).toBeNull(); // no annotation tools: the row has the Edit tool only
    await click(control("agree"));
    expect(session.forms.byName("agree")!.value).toBe(true);
    await click(control("sig"));
    expect(document.querySelector(".pli-pdf-sig")).toBeNull();
  });

  it("undo through the annotation shortcuts also undoes a form edit", async () => {
    const session = await mountBoth();
    await click(control("agree"));
    expect(session.forms.byName("agree")!.value).toBe(true);
    await press(q(".pli-pdf-scroller"), "z", { ctrlKey: true });
    expect(session.forms.byName("agree")!.value).toBe(false);
  });

  it("the whole form is disabled when read only", async () => {
    await mountBoth({ readOnly: true });
    expect(qa("[data-control]").every((e) => (e as HTMLInputElement).disabled)).toBe(true);
    await run(async () => {});
    expect(host.querySelector(".pli-pdf-designbar")).toBeNull();
  });
});

// ---- signing a signature field ---------------------------------------------------------------------------------------

describe("signing a signature field", () => {
  const pad = () => q("svg.pli-pdf-sigpad", q("dialog[open]"));
  const fire = async (el: Element, type: string, at: [number, number]) =>
    act(async () => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], button: 0, buttons: type === "pointerup" ? 0 : 1 })));
  /** Clicks the field, draws a stroke on the pad of the dialog and submits it. */
  async function sign() {
    await click(control("sig"));
    const p = pad();
    const pts: [number, number][] = [[100, 60], [160, 30], [220, 70], [300, 40]];
    await fire(p, "pointerdown", pts[0]!);
    for (const pt of pts.slice(1)) await fire(p, "pointermove", pt);
    await fire(p, "pointerup", pts.at(-1)!);
    await act(async () => void q("form", q("dialog[open]")).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flush();
  }
  const signatures = (s: Awaited<ReturnType<typeof mountBoth>>) => s.doc.pages.flatMap((p) => p.annots).filter((a) => a.type === "signature") as unknown as { id: string; rect: { x: number; y: number; w: number; h: number }; field?: string }[];
  const layer = () => q(".pli-form-layer");

  it("shows the caption on an unsigned field, and puts the signature inside the field's box, with nothing else drawn there", async () => {
    const session = await mountBoth();
    const field = session.forms.byName("sig")!;
    expect(layer().textContent).toContain("Sign here");
    await sign();
    const [signature] = signatures(session);
    expect(signature).toBeDefined();
    // inside the field's rectangle, with the proportions of what was drawn
    const box = field.widgets[0]!.rect;
    expect(signature!.field).toBe("sig");
    expect(signature!.rect.x).toBeGreaterThanOrEqual(box.x - 0.01);
    expect(signature!.rect.y).toBeGreaterThanOrEqual(box.y - 0.01);
    expect(signature!.rect.x + signature!.rect.w).toBeLessThanOrEqual(box.x + box.w + 0.01);
    expect(signature!.rect.y + signature!.rect.h).toBeLessThanOrEqual(box.y + box.h + 0.01);
    // the caption is gone, and so is the dashed box and its wash: the field draws nothing of its own
    expect(layer().textContent).not.toContain("Sign here");
    expect(document.querySelector(".pli-form-sign")).toBeNull();
    const covered = q(".pli-form-covered");
    expect(covered.getAttribute("aria-label")).toContain("signed");
    expect(covered.textContent).toBe("");
    // the signature under it can still be picked up: the box lets the pointer through
    expect(covered.style.pointerEvents).toBe("none");
    // the tool did not stay in "placing a signature" mode: it was placed
    expect(document.querySelector(".pli-pdf")!.getAttribute("data-tool")).not.toBe("signature");
  });

  it("brings the caption back when the signature is undone, and takes it away again on redo", async () => {
    const session = await mountBoth();
    await sign();
    expect(layer().textContent).not.toContain("Sign here");
    await run(() => session.undo());
    expect(signatures(session)).toHaveLength(0);
    expect(layer().textContent).toContain("Sign here");
    expect(document.querySelector(".pli-form-covered")).toBeNull();
    await run(() => session.redo());
    expect(layer().textContent).not.toContain("Sign here");
  });

  it("brings the caption back when the signature is deleted", async () => {
    const session = await mountBoth();
    await sign();
    const [signature] = signatures(session);
    await run(() => session.annots.remove([signature!.id]));
    expect(layer().textContent).toContain("Sign here");
    // and the field can be signed again
    await sign();
    expect(signatures(session)).toHaveLength(1);
    expect(layer().textContent).not.toContain("Sign here");
  });

  it("leaves the field as it was when the dialog is cancelled", async () => {
    const session = await mountBoth();
    await click(control("sig"));
    await act(async () => void q("dialog[open]").dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    await act(async () => q("dialog[open]")?.removeAttribute("open"));
    await flush();
    expect(signatures(session)).toHaveLength(0);
    expect(layer().textContent).toContain("Sign here");
    // a click on the page afterwards does not drop a signature somewhere: nothing is being placed
    expect(document.querySelector(".pli-pdf")!.getAttribute("data-tool")).not.toBe("signature");
  });
});
