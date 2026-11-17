// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openPdf } from "@pli.dev/pdf";
import { blur, byLabel, choose, chooseMenu, click, control, flush, fixture, focus, host, mount, press, q, qa, replaceText, run, typeInto, useFormsHost, widget } from "./formsHarness";

useFormsHost();

const value = (s: { forms: { byName(n: string): { value: unknown } | undefined } }, name: string) => s.forms.byName(name)?.value;

describe("the form on the page", () => {
  it("draws a control for every widget with the field's name as its accessible name", async () => {
    const { session } = await mount();
    expect(qa(".pli-form-widget")).toHaveLength(9); // 8 fields, the radio group has two buttons
    expect(control("name").getAttribute("aria-label")).toBe("name");
    expect(control("name").value).toBe("Sample Name");
    expect(control<HTMLTextAreaElement>("notes").tagName).toBe("TEXTAREA");
    expect(control("agree").type).toBe("checkbox");
    expect(control("size", 0).type).toBe("radio");
    expect(control<HTMLSelectElement>("colour").value).toBe("Red");
    const list = control<HTMLSelectElement>("fruit");
    expect([...list.selectedOptions].map((o) => o.value)).toEqual(["Plum"]);
    expect(control<HTMLButtonElement>("send").textContent).toBe("Send");
    expect(control<HTMLButtonElement>("sig").textContent).toBe("Sign here");
    expect(session.doc.fields).toHaveLength(8);
  });

  it("places widgets in page space with the field's look, so they scale and turn with the page", async () => {
    await mount();
    const w = widget("name");
    expect(w.style.left).toBe("80px");
    expect(w.style.top).toBe("50px");
    expect(w.style.width).toBe("200px");
    expect(w.style.height).toBe("20px");
    const input = control("name");
    expect(input.style.fontSize).toBe("11px");
    expect(input.style.border).toContain("1px solid");
    // The layer is the page's transformed layer: the transform scales (and turns) it, the children are in points.
    expect(w.closest(".pli-pdf-overlay-dom")!.getAttribute("style")).toMatch(/scale\(1\.33333\d?\)/); // the scale of the page box, not rounded to 3 decimals (see overlayLock.test.tsx)
  });

  it("follows the zoom and the turn of the view", async () => {
    await mount({ zoom: 2, turns: 1 });
    const layer = widget("name").closest<HTMLElement>(".pli-pdf-overlay-dom")!;
    expect(layer.style.transform).toContain("rotate(90deg)");
    expect(layer.style.transform).toMatch(/scale\(2\.66666\d?\)/);
    // The size in points does not change with either.
    expect(widget("name").style.width).toBe("200px");
  });

  it("uses the auto size (0) of a field to fit its height", async () => {
    const { session } = await mount({ file: "forms-acro" });
    // `country` has size 0 and no border: 20 points high gives 14 points
    expect(session.forms.byName("country")!.appearance!.size).toBe(0);
    expect(control("country").style.fontSize).toBe("14px");
    expect(control("person.last").style.textAlign).toBe("center");
    expect(control("person.first").style.backgroundColor).toContain("255, 255, 230");
  });
});

describe("filling", () => {
  it("types into a text field: every keystroke is in the document, one undo step for the burst", async () => {
    const { session } = await mount();
    const input = control("name");
    await typeInto(input, "!!");
    expect(value(session, "name")).toBe("Sample Name!!");
    expect(session.canUndo).toBe(true);
    await blur(input);
    await run(() => session.undo());
    expect(value(session, "name")).toBe("Sample Name");
    expect(session.canUndo).toBe(false);
    await run(() => session.redo());
    expect(value(session, "name")).toBe("Sample Name!!");
  });

  it("starts a new undo step when the person comes back to the field", async () => {
    const { session } = await mount();
    const input = control("name");
    await typeInto(input, "a");
    await blur(input);
    await typeInto(input, "b");
    expect(value(session, "name")).toBe("Sample Namea" + "b");
    await run(() => session.undo());
    expect(value(session, "name")).toBe("Sample Namea");
  });

  it("fills a multi-line field", async () => {
    const { session } = await mount();
    await replaceText(control<HTMLTextAreaElement>("notes"), "one\ntwo");
    expect(value(session, "notes")).toBe("one\ntwo");
  });

  it("ticks a check box at once, as a step of its own", async () => {
    const { session } = await mount();
    const box = control("agree");
    await click(box);
    expect(value(session, "agree")).toBe(true);
    expect(box.checked).toBe(true);
    expect(widget("agree").querySelector(".pli-form-mark")).not.toBeNull();
    await click(box);
    expect(value(session, "agree")).toBe(false);
    await run(() => session.undo());
    expect(value(session, "agree")).toBe(true);
    await run(() => session.undo());
    expect(value(session, "agree")).toBe(false);
  });

  it("chooses one radio button; the group is one choice, with radio semantics", async () => {
    const { session } = await mount();
    const group = document.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("size");
    const [a, b] = [control("size", 0), control("size", 1)];
    expect(a.getAttribute("aria-label")).toBe("size: 0");
    await click(b);
    expect(value(session, "size")).toBe("1");
    expect(b.checked).toBe(true);
    expect(a.checked).toBe(false);
    await click(a);
    expect(value(session, "size")).toBe("0");
    // Only the group's stop is in the tab order
    expect(a.tabIndex).toBe(0);
    expect(b.tabIndex).toBe(-1);
    // clicking the chosen one again turns it off (the group may be all off)
    await click(a);
    expect(value(session, "size")).toBe(null);
  });

  it("moves between radio buttons with the arrow keys", async () => {
    const { session } = await mount();
    const [a, b] = [control("size", 0), control("size", 1)];
    await click(a);
    await focus(a);
    await press(a, "ArrowRight");
    expect(value(session, "size")).toBe("1");
    expect(document.activeElement).toBe(b);
    await press(b, "ArrowLeft");
    expect(value(session, "size")).toBe("0");
    await press(a, "ArrowUp");
    expect(value(session, "size")).toBe("1");
  });

  it("chooses from a drop-down", async () => {
    const { session } = await mount();
    await choose(control<HTMLSelectElement>("colour"), ["Blue"]);
    expect(value(session, "colour")).toBe("Blue");
    await run(() => session.undo());
    expect(value(session, "colour")).toBe("Red");
  });

  it("shows labels in a drop-down and stores the value", async () => {
    const { session } = await mount({ file: "forms-acro" });
    const select = control<HTMLSelectElement>("country");
    expect([...select.options].map((o) => o.textContent)).toEqual(["", "Germany", "France"]);
    await choose(select, ["de"]);
    expect(value(session, "country")).toBe("de");
  });

  it("types into an editable drop-down: any text, or a label that is an option", async () => {
    const { session } = await mount({ file: "forms-acro" });
    await run(() => session.forms.update("f:country", { flags: { editable: true } }));
    const input = control("country");
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("role")).toBe("combobox");
    expect(input.value).toBe("France");
    expect(document.querySelectorAll("datalist option")).toHaveLength(2);
    await replaceText(input, "Spain");
    expect(value(session, "country")).toBe("Spain");
    await replaceText(input, "Germany");
    expect(value(session, "country")).toBe("de");
  });

  it("selects in a list box, several when the list allows it", async () => {
    const { session } = await mount();
    const list = control<HTMLSelectElement>("fruit");
    await choose(list, ["Fig"]);
    expect(value(session, "fruit")).toEqual(["Fig"]);
    await run(() => session.forms.update("f:fruit", { flags: { multiSelect: true } }));
    const multi = control<HTMLSelectElement>("fruit");
    expect(multi.multiple).toBe(true);
    await choose(multi, ["Apple", "Pear"]);
    expect(value(session, "fruit")).toEqual(["Apple", "Pear"]);
  });

  it("a push button has a caption and does nothing", async () => {
    const { session } = await mount();
    const before = session.doc;
    await click(control("send"));
    expect(session.doc).toBe(before);
  });

  it("the engine's refusal (a value that is too long) shows and changes nothing", async () => {
    const { session } = await mount({ file: "forms-acro" });
    const input = control("person.last");
    expect(input.maxLength).toBe(8);
    await replaceText(input, "123456789"); // a paste the browser did not cut
    expect(value(session, "person.last")).toBe("");
    expect(widget("person.last").hasAttribute("data-invalid")).toBe(true);
    expect(document.body.textContent).toContain("takes at most 8 characters");
  });

  it("limits a password field and hides its text", async () => {
    const { session } = await mount();
    await run(() => session.forms.update("f:name", { flags: { password: true } }));
    expect(control("name").type).toBe("password");
  });

  it("draws a comb field as one character per cell", async () => {
    const { session } = await mount();
    await run(() => session.forms.update("f:name", { flags: { comb: true, maxLength: 10 } }));
    const input = control("name");
    expect(input.className).toContain("pli-form-comb");
    expect(input.maxLength).toBe(10);
    expect(input.style.letterSpacing).toContain("20px"); // 200 points over 10 cells
    expect(input.style.backgroundImage).toContain("repeating-linear-gradient");
  });
});

describe("Escape and Enter", () => {
  it("Escape puts back what the field had when the person went in", async () => {
    const { session } = await mount();
    const input = control("name");
    await typeInto(input, "xyz");
    expect(value(session, "name")).toBe("Sample Namexyz");
    await press(input, "Escape");
    expect(value(session, "name")).toBe("Sample Name");
    expect(session.canUndo).toBe(false);
  });

  it("Enter in a single-line field goes to the next field; in a multi-line field it is a new line", async () => {
    await mount();
    const input = control("name");
    await focus(input);
    await press(input, "Enter");
    expect(document.activeElement).toBe(control("notes"));
    const notes = control<HTMLTextAreaElement>("notes");
    const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    notes.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe("tab order", () => {
  it("Tab and Shift+Tab visit the fields in reading order, a radio group once, and leave at the ends", async () => {
    await mount();
    const order = ["name", "notes", "agree", "size", "colour", "fruit", "sig", "send"];
    const el = (n: string) => (n === "size" ? control("size", 0) : control(n));
    await focus(el("name"));
    for (let i = 1; i < order.length; i++) {
      const from = document.activeElement as HTMLElement;
      const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      await run(() => from.dispatchEvent(ev));
      expect(ev.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(el(order[i]!));
    }
    // the last field: the browser takes the Tab on
    const last = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await run(() => document.activeElement!.dispatchEvent(last));
    expect(last.defaultPrevented).toBe(false);
    // and back
    const back = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    await run(() => control("send").dispatchEvent(back));
    expect(document.activeElement).toBe(el("sig"));
    // Shift+Tab at the first
    const first = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    await focus(el("name"));
    await run(() => el("name").dispatchEvent(first));
    expect(first.defaultPrevented).toBe(false);
  });

  it("skips read-only fields", async () => {
    const { session } = await mount();
    await run(() => session.forms.update("f:notes", { flags: { readOnly: true } }));
    const input = control("name");
    await focus(input);
    await press(input, "Tab");
    expect(document.activeElement).toBe(control("agree"));
  });

  it("follows the geometry: moving a field changes where Tab goes", async () => {
    const { session, c } = await mount();
    // put `agree` above `name`
    await run(() => session.forms.setRect("w:main:16", { x: 80, y: 10, w: 14, h: 14 }));
    expect(c().order()[0]!.field.name).toBe("agree");
  });
});

describe("required and invalid fields", () => {
  it("marks a required field, and describes a problem by id for screen readers", async () => {
    const { session } = await mount();
    await run(() => session.forms.update("f:notes", { flags: { required: true } }));
    const w = widget("notes");
    expect(w.querySelector(".pli-form-req")).not.toBeNull();
    expect(w.hasAttribute("data-required")).toBe(true);
    const area = control<HTMLTextAreaElement>("notes");
    expect(area.getAttribute("aria-required")).toBe("true");
    // not called invalid before the person has been in it
    expect(area.getAttribute("aria-invalid")).toBeNull();
    const describedBy = area.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)!.textContent).toBe("notes is required");
  });

  it("shows the message on focus, and calls a required field invalid once the person has left it empty", async () => {
    const { session } = await mount();
    await run(() => session.forms.update("f:notes", { flags: { required: true } }));
    const area = control<HTMLTextAreaElement>("notes");
    expect(q(".pli-form-msg", widget("notes"))).toBeNull();
    await focus(area);
    expect(q(".pli-form-msg", widget("notes")).textContent).toBe("notes is required");
    await blur(area);
    expect(q(".pli-form-msg", widget("notes"))).toBeNull();
    expect(area.getAttribute("aria-invalid")).toBe("true");
    expect(widget("notes").hasAttribute("data-invalid")).toBe(true);
    // filling it clears the problem
    await replaceText(area, "ok");
    await blur(area);
    expect(area.getAttribute("aria-invalid")).toBeNull();
    expect(area.getAttribute("aria-describedby")).toBeNull();
    expect(session.forms.isValid()).toBe(true);
  });

  it("flags a value that is not one of the drop-down's options", async () => {
    const { session } = await mount();
    await run(() => session.transact([{ type: "replace_field", field: { ...session.forms.byName("colour")!, value: "Mauve" } }]));
    const select = control<HTMLSelectElement>("colour");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(select.getAttribute("aria-describedby")!)!.textContent).toContain('"Mauve", which is not one of its options');
    // the stored value still shows, so nothing is hidden from the person
    expect(select.value).toBe("Mauve");
  });

  it("radio groups: required and invalid are on the group", async () => {
    const { session } = await mount();
    await run(() => session.forms.update("f:size", { flags: { required: true } }));
    const group = document.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-required")).toBe("true");
    await focus(control("size", 0));
    await blur(control("size", 0));
    expect(group.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("read only", () => {
  it("disables every control when the viewer is read only", async () => {
    const { session } = await mount({ props: { readOnly: true } });
    const controls = qa("[data-control]");
    expect(controls.length).toBeGreaterThanOrEqual(9);
    for (const el of controls) expect((el as HTMLInputElement).disabled).toBe(true);
    expect(widget("name").hasAttribute("data-readonly")).toBe(true);
    await click(control("agree"));
    expect(value(session, "agree")).toBe(false);
  });

  it("disables a field the file marks read only, and the others stay open", async () => {
    const { session } = await mount();
    await run(() => session.forms.update("f:name", { flags: { readOnly: true } }));
    expect(control("name").disabled).toBe(true);
    expect(control("notes").disabled).toBe(false);
  });

  it("the form bar has no editing buttons when read only", async () => {
    await mount({ props: { readOnly: true } });
    const bar = q(".pli-pdf-formbar");
    expect(bar.textContent).toContain("Highlight fields");
    expect(bar.textContent).not.toContain("Clear form");
    expect(bar.textContent).not.toContain("Flatten");
    expect(document.querySelector('[aria-label="Prepare form"]')).toBeNull();
  });
});

describe("signature fields", () => {
  it("an empty one is a dashed box that asks to sign; without a signing hook it says so", async () => {
    const { c } = await mount();
    const button = control<HTMLButtonElement>("sig");
    expect(button.getAttribute("aria-label")).toBe("sig: sign here");
    await click(button);
    expect(c().live).toContain("Signing is not set up");
  });

  it("calls the host's hook with the field and widget", async () => {
    const calls: string[] = [];
    await mount({ kit: { onSign: (f, w) => calls.push(`${f.name}/${w.id}`) } });
    await click(control("sig"));
    expect(calls).toEqual(["sig/w:main:38"]);
  });

  it("a signed one is a read-only badge", async () => {
    const { session } = await mount();
    await run(() => session.transact([{ type: "replace_field", field: { ...session.forms.byName("sig")!, signed: true } }]));
    const w = widget("sig");
    expect(w.querySelector(".pli-form-badge")!.textContent).toBe("Signed");
    expect(w.querySelector("button")).toBeNull();
    expect(w.querySelector('[role="img"]')!.getAttribute("aria-label")).toBe("sig: signed");
  });
});

describe("tooltips", () => {
  it("name the control", async () => {
    const { session } = await mount({ file: "forms-acro" });
    expect(session.forms.byName("person.first")!.tooltip).toBe("First name");
    expect(control("person.first").getAttribute("aria-label")).toBe("First name");
  });
});

describe("the form bar", () => {
  it("is shown when the document has fields, with the highlight on, and can be dismissed and brought back", async () => {
    const { c } = await mount();
    const bar = q(".pli-pdf-formbar");
    expect(bar.getAttribute("aria-label")).toBe("Form");
    expect(bar.textContent).toContain("This document has fillable fields:");
    expect(q(".pli-form-layer").hasAttribute("data-highlight")).toBe(true);
    await click(byLabel("Dismiss form bar", host));
    expect(document.querySelector(".pli-pdf-formbar")).toBeNull();
    expect(c().bannerOpen).toBe(false);
    // the Form menu (Tools > Form) has a way back
    await chooseMenu("Tools", "Form", "Show form bar");
    expect(document.querySelector(".pli-pdf-formbar")).not.toBeNull();
  });

  it("is not shown when the document has no fields", async () => {
    const { testSession } = await import("../src/testing");
    await mount({ session: testSession({ pages: [{ width: 300, height: 400 }] }) });
    expect(document.querySelector(".pli-pdf-formbar")).toBeNull();
    expect(document.querySelector(".pli-form-layer")).toBeNull();
  });

  it("toggles the highlight", async () => {
    await mount();
    const button = [...qa("button", q(".pli-pdf-formbar"))].find((b) => b.textContent === "Highlight fields")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(q(".pli-form-layer").hasAttribute("data-highlight")).toBe(false);
    await click(button);
    expect(q(".pli-form-layer").hasAttribute("data-highlight")).toBe(true);
  });

  it("clears the form to its defaults in one undo step", async () => {
    const { session } = await mount();
    await click(control("agree"));
    await replaceText(control("name"), "Someone");
    await blur(control("name"));
    await choose(control<HTMLSelectElement>("colour"), ["Green"]);
    const clear = [...qa("button", q(".pli-pdf-formbar"))].find((b) => b.textContent === "Clear form")!;
    await click(clear);
    expect(value(session, "name")).toBe("");
    expect(value(session, "agree")).toBe(false);
    expect(value(session, "colour")).toBe("");
    expect(value(session, "fruit")).toEqual([]);
    expect(control("name").value).toBe("");
    await run(() => session.undo());
    expect(value(session, "name")).toBe("Someone");
    expect(value(session, "colour")).toBe("Green");
  });
});

describe("export and import", () => {
  it("exports the values as JSON through the download hook", async () => {
    const saved: { name: string; mime: string; text: string }[] = [];
    const { session, c } = await mount({ kit: { download: (bytes, name, mime) => void saved.push({ name, mime, text: new TextDecoder().decode(bytes) }) } });
    await click(control("agree"));
    await run(() => c().exportData());
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe("document-data.json");
    expect(saved[0]!.mime).toBe("application/json");
    expect(JSON.parse(saved[0]!.text)).toEqual({ name: "Sample Name", notes: "", agree: true, size: null, colour: "Red", fruit: ["Plum"] });
    expect(session.forms.exportData()).toEqual(JSON.parse(saved[0]!.text));
    expect(q(".pli-pdf-notice").textContent).toContain("document-data.json");
  });

  it("imports JSON from a file, fills what fits and says what it skipped", async () => {
    const { session } = await mount();
    const input = byLabel("Import form data", host) as HTMLInputElement;
    const file = new File([JSON.stringify({ name: "Imported", agree: true, colour: "Purple", nothing: 1, fruit: ["Fig"] })], "data.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await run(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(value(session, "name")).toBe("Imported");
    expect(value(session, "agree")).toBe(true);
    expect(value(session, "fruit")).toEqual(["Fig"]);
    expect(value(session, "colour")).toBe("Red"); // refused
    const text = q(".pli-pdf-notice").textContent!;
    expect(text).toContain("Filled 3 fields");
    expect(text).toContain("colour");
    expect(text).toContain("nothing (no such field)");
    expect(control("name").value).toBe("Imported");
    // one undo step
    await run(() => session.undo());
    expect(value(session, "name")).toBe("Sample Name");
    expect(value(session, "agree")).toBe(false);
  });

  it("says when the file is not JSON", async () => {
    const { c } = await mount();
    await run(async () => void c().importText("{nope"));
    expect(q(".pli-pdf-notice").textContent).toContain("not valid JSON");
    expect(q(".pli-pdf-notice").getAttribute("role")).toBe("alert");
  });

  it("the Form menu has export, import and flatten", async () => {
    await mount();
    await chooseMenu("Tools", "Form");
    const labels = [...document.querySelectorAll<HTMLElement>("[role=menu] [role^='menuitem']")].map((b) => b.textContent!.replace("✓", ""));
    expect(labels).toEqual(expect.arrayContaining(["Highlight fields", "Clear form", "Export data…", "Import data…", "Flatten…", "Prepare form"]));
  });
});

describe("flatten", () => {
  it("asks first, explains that it cannot be undone in the saved file, then hands over a flattened copy", async () => {
    const got: { name: string; bytes: Uint8Array }[] = [];
    const { session } = await mount({ kit: { onFlatten: (bytes, info) => void got.push({ name: info.name, bytes }) } });
    await click(control("agree"));
    const button = [...qa("button", q(".pli-pdf-formbar"))].find((b) => b.textContent === "Flatten…")!;
    await click(button);
    const dialog = document.querySelector<HTMLDialogElement>("dialog.pli-dialog")!;
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain("cannot be undone in the saved file");
    expect(dialog.textContent).toContain("8 fields");
    expect(got).toHaveLength(0);
    // Cancel changes nothing
    await click([...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancel"));
    expect(got).toHaveLength(0);
    await click(button);
    const go = [...document.querySelectorAll("dialog.pli-dialog button")].find((b) => b.textContent!.startsWith("Flatten"))!;
    await run(async () => {
      go.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 200));
    });
    await flush();
    expect(got).toHaveLength(1);
    expect(got[0]!.name).toBe("document-flattened.pdf");
    // The copy has no fields; the session keeps its form
    const flat = await openPdf(got[0]!.bytes);
    expect(flat.doc.fields).toHaveLength(0);
    expect(session.doc.fields).toHaveLength(8);
    expect(q(".pli-pdf-notice").textContent).toContain("document-flattened.pdf");
  });
});

describe("flatten through the viewer's file flow", () => {
  it("goes to the viewer's download hook like the File menu's Download, and the form here is unchanged", async () => {
    const got: { name: string; mime: string; bytes: Uint8Array }[] = [];
    const { session, c } = await mount({ props: { onDownload: (bytes, name, mime) => void got.push({ name, mime, bytes }) } });
    expect(c().files).not.toBeNull();
    await run(async () => {
      await c().flatten();
    });
    expect(got).toHaveLength(1);
    expect(got[0]!.name).toBe("document-flattened.pdf");
    expect(got[0]!.mime).toBe("application/pdf");
    expect((await openPdf(got[0]!.bytes)).doc.fields).toHaveLength(0);
    expect(session.doc.fields).toHaveLength(8);
    expect(session.dirty).toBe(false);
  });

  it("flattenedBytes gives the file without handing it anywhere", async () => {
    const { c } = await mount();
    expect((await openPdf(await c().flattenedBytes())).doc.fields).toHaveLength(0);
  });

  it("says so when a file cannot be downloaded here", async () => {
    const { c } = await mount();
    await run(() => c().exportData());
    expect(q(".pli-pdf-notice").textContent).toContain("could not be saved");
    expect(q(".pli-pdf-notice").getAttribute("role")).toBe("alert");
  });
});

describe("a round trip", () => {
  it("fills every kind of field, saves, opens the file and finds the same values", async () => {
    const { session } = await mount();
    await replaceText(control("name"), "Round Trip");
    await blur(control("name"));
    await replaceText(control<HTMLTextAreaElement>("notes"), "line one\nline two");
    await blur(control<HTMLTextAreaElement>("notes"));
    await click(control("agree"));
    await click(control("size", 1));
    await choose(control<HTMLSelectElement>("colour"), ["Blue"]);
    await choose(control<HTMLSelectElement>("fruit"), ["Pear"]);
    const bytes = await session.save();
    const again = await openPdf(bytes);
    expect(again.forms.exportData()).toEqual({ name: "Round Trip", notes: "line one\nline two", agree: true, size: "1", colour: "Blue", fruit: ["Pear"] });
    // and the original bytes are untouched at the front (an incremental save)
    expect(bytes.length).toBeGreaterThan(fixture("forms-basic").length);
  });

  it("keeps the values of the acro form too", async () => {
    const { session } = await mount({ file: "forms-acro" });
    await replaceText(control("person.last"), "Lovelace");
    await blur(control("person.last"));
    await click(control("newsletter"));
    await click(control("level", 0));
    await choose(control<HTMLSelectElement>("country"), ["de"]);
    const again = await openPdf(await session.save());
    expect(again.forms.byName("person.last")!.value).toBe("Lovelace");
    expect(again.forms.byName("newsletter")!.value).toBe(false);
    expect(again.forms.byName("level")!.value).toBe("A");
    expect(again.forms.byName("country")!.value).toBe("de");
    expect(again.forms.byName("person.first")!.value).toBe("Ada");
  });
});

describe("off-screen fields", () => {
  it("Tab to a field on a page that is not drawn goes to the page and focuses the field when it appears (and back)", async () => {
    const session = await openPdf(fixture("forms-basic"));
    const second = session.pages.insertBlank("p:main:0", { width: 300, height: 400 });
    session.forms.addField(second, { type: "text", name: "second", rect: { x: 20, y: 30, w: 100, h: 20 } });
    session.select({ page: "p:main:0" });
    await mount({ session, props: { defaultViewMode: "single" } });
    expect(document.querySelector('[data-field-id="f:send"]')).not.toBeNull();
    expect(document.querySelector("[data-type='text'][data-widget-id]:not([data-field-id^='f:'])")).toBeNull();
    const send = control("send");
    await focus(send);
    await press(send, "Tab");
    await flush();
    expect(session.selection.page).toBe(second);
    const field = session.forms.byName("second")!;
    const el = document.querySelector<HTMLElement>(`[data-field-id="${field.id}"] [data-control]`)!;
    expect(document.activeElement).toBe(el);
    // and back to the last field of the first page
    await press(el, "Tab", { shiftKey: true });
    await flush();
    expect(session.selection.page).toBe("p:main:0");
    expect(document.activeElement).toBe(control("send"));
  });
});
