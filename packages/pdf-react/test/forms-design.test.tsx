// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openPdf, type FormField, type PdfSession } from "@pli.dev/pdf";
import { testSession } from "../src/testing";
import { blur, byLabel, choose, click, control, drag, dragOn, flush, fixture, focus, host, layerOf, mount, menuButton, openProperties, press, q, qa, rectOf, replaceText, round, run, tap, togglePrepareForm, toolButton, useFormsHost, widget, type Gesture } from "./formsHarness";

useFormsHost();

const startDesign = () => togglePrepareForm();
const prop = (label: string): HTMLInputElement => {
  const l = qa<HTMLLabelElement>(".pli-form-props label").find((x) => x.textContent === label);
  if (!l) throw new Error(`no property labelled ${label}: ${qa(".pli-form-props label").map((x) => x.textContent).join(", ")}`);
  return document.getElementById(l.htmlFor) as HTMLInputElement;
};
const frame = (id: string) => document.querySelector<HTMLElement>(`.pli-form-design[data-field-id="${id}"]`)!;
const last = (s: PdfSession): FormField => s.doc.fields[s.doc.fields.length - 1]!;
const bar = () => q(".pli-pdf-designbar");

describe("Prepare form", () => {
  it("is a switch in the Tools menu (and the Form menu); it shows the bar, frames over the widgets and the panel", async () => {
    const { c } = await mount();
    expect(document.querySelector(".pli-pdf-designbar")).toBeNull();
    await startDesign();
    expect(c().designing).toBe(true);
    expect(bar().getAttribute("role")).toBe("toolbar");
    // the fill-in banner gives way to the design bar
    expect(document.querySelector(".pli-pdf-formbar")).toBeNull();
    expect(qa(".pli-form-design")).toHaveLength(9);
    expect(qa("[data-control]:not([inert] *)")).toHaveLength(0); // nothing can be typed into
    expect(document.querySelector(".pli-pdf-right")).toBeNull(); // nothing selected: the panel waits
    await openProperties();
    expect(q(".pli-pdf-right .pli-form-props").getAttribute("aria-label")).toBe("Fields");
    expect(q(".pli-pdf-right").textContent).toContain("Fields (8)");
    await togglePrepareForm();
    expect(c().designing).toBe(false);
    expect(qa(".pli-form-design")).toHaveLength(0);
    expect(document.querySelector(".pli-pdf-formbar")).not.toBeNull();
    expect(document.querySelector(".pli-pdf-right")).toBeNull();
  });

  it("Done closes it", async () => {
    const { c } = await mount();
    await startDesign();
    await click([...qa("button", bar())].find((b) => b.textContent === "Done"));
    expect(c().designing).toBe(false);
  });

  it("is not there in a read-only viewer", async () => {
    const { c } = await mount({ props: { readOnly: true } });
    await click(menuButton("Tools"));
    expect(qa("[role=menu] [role^=menuitem]", document).map((b) => b.textContent).join("|")).not.toContain("Prepare form");
    await run(() => c().setDesigning(true));
    expect(c().designing).toBe(false);
  });

  it("works on a document with no fields", async () => {
    const session = testSession({ pages: [{ width: 300, height: 400 }] });
    const { c } = await mount({ session });
    expect(document.querySelector(".pli-pdf-formbar")).toBeNull();
    await startDesign();
    await click(toolButton("Text field"));
    await drag([40, 40], [140, 64]);
    expect(session.doc.fields).toHaveLength(1);
    expect(c().fields).toHaveLength(1);
  });
});

// ---- adding fields: every kind, every turn of the view, zoom not 1 -------------------------------------------

const KINDS: { label: string; kind: string; type: FormField["type"]; flags?: FormField["flags"] }[] = [
  { label: "Text field", kind: "text", type: "text" },
  { label: "Multi-line text", kind: "multiline", type: "text", flags: { multiline: true } },
  { label: "Check box", kind: "checkbox", type: "checkbox" },
  { label: "Dropdown".replace("Dropdown", "Drop-down"), kind: "dropdown", type: "dropdown" },
  { label: "List box", kind: "list", type: "list" },
  { label: "Signature field", kind: "signature", type: "signature" },
  { label: "Button", kind: "button", type: "button" },
];

describe("adding a field by dragging", () => {
  for (const turns of [0, 1, 2, 3]) {
    for (const zoom of [1, 1.5]) {
      it(`every kind of field, view turned ${turns * 90} degrees, zoom ${zoom}`, async () => {
        const { session, c } = await mount({ turns, zoom });
        await startDesign();
        const g: Gesture = { rotation: turns * 90, zoom };
        for (const k of KINDS) {
          const before = session.doc.fields.length;
          await click(toolButton(k.label));
          expect(c().activeKind).toBe(k.kind);
          await drag([212.4, 152.3], [287.6, 195.9], g);
          expect(session.doc.fields).toHaveLength(before + 1);
          const f = last(session);
          expect(f.type).toBe(k.type);
          expect(f.flags ?? {}).toMatchObject(k.flags ?? {});
          // page space, snapped to the 4 point grid, whatever the turn and zoom of the view
          expect(f.widgets).toHaveLength(1);
          expect(f.widgets[0]!.page).toBe("p:main:0");
          expect({ ...f.widgets[0]!.rect }).toEqual({ x: 212, y: 152, w: 76, h: 44 });
          // selected, and the tool is put down
          expect(session.selection.fields).toEqual([f.id]);
          expect(c().selection?.field.id).toBe(f.id);
          expect(c().activeKind).toBeNull();
          expect(document.querySelector(".pli-pdf-interact")).toBeNull();
          // one undo step takes it away again, and redo brings it back
          await run(() => session.undo());
          expect(session.doc.fields).toHaveLength(before);
          await run(() => session.redo());
          expect(last(session).id).toBe(f.id);
          // clear the way for the next kind
          await run(() => c().removeField(f.id));
          expect(session.doc.fields).toHaveLength(before);
        }
      });
    }
  }

  it("a click (no drag) puts a field of the kind's own size, centred on the point", async () => {
    const { session } = await mount({ turns: 1, zoom: 1.5 });
    await startDesign();
    await click(toolButton("Text field"));
    await tap([150, 170], { rotation: 90, zoom: 1.5 });
    expect({ ...last(session).widgets[0]!.rect }).toEqual({ x: 76, y: 160, w: 150, h: 22 });
  });

  it("Alt skips the grid", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Text field"));
    await drag([212.4, 152.3], [287.6, 195.9], { init: { altKey: true } });
    const r = rectOf(session, last(session).name);
    expect(r).toEqual({ x: 212.4, y: 152.3, w: 75.2, h: 43.6 });
  });

  it("names new fields Text1, Text2... and gives each kind a sensible look", async () => {
    const { session } = await mount();
    await startDesign();
    for (let i = 0; i < 2; i++) {
      await click(toolButton("Text field"));
      await drag([212, 152 + i * 4], [288, 176 + i * 4]);
    }
    expect(session.doc.fields.slice(-2).map((f) => f.name)).toEqual(["Text1", "Text2"]);
    await click(toolButton("Drop-down"));
    await drag([212, 220], [288, 244]);
    const dd = last(session);
    expect(dd.options!.map((o) => o.value)).toEqual(["Option 1", "Option 2", "Option 3"]);
    expect(dd.appearance).toMatchObject({ font: "Helvetica", color: "#000000", border: "#000000" });
    await click(toolButton("Button"));
    await drag([212, 250], [288, 276]);
    expect(last(session).caption).toBe("Button");
  });

  it("keeps the drawn field inside the page", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Text field"));
    await drag([240, 380], [400, 500]);
    expect(rectOf(session, last(session).name)).toEqual({ x: 240, y: 380, w: 60, h: 20 });
  });

  it("Escape puts the tool down and drops what was being drawn", async () => {
    const { session, c } = await mount();
    await startDesign();
    await click(toolButton("Text field"));
    const layer = layerOf();
    await run(() => layer.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 300, clientY: 300, button: 0 })));
    expect(c().draft).not.toBeNull();
    expect(document.querySelector(".pli-form-draft")).not.toBeNull();
    await press(q(".pli-pdf-scroller"), "Escape");
    expect(c().draft).toBeNull();
    expect(c().activeKind).toBeNull();
    expect(session.doc.fields).toHaveLength(8);
  });

  it("pressing the tool again puts it down", async () => {
    const { c } = await mount();
    await startDesign();
    await click(toolButton("Text field"));
    expect(toolButton("Text field").getAttribute("aria-pressed")).toBe("true");
    await click(toolButton("Text field"));
    expect(c().activeKind).toBeNull();
  });

  it("Shift+Enter on a tool button puts a field in the middle of the page (the keyboard way)", async () => {
    const { session } = await mount();
    await startDesign();
    await press(toolButton("Check box"), "Enter", { shiftKey: true });
    const f = last(session);
    expect(f.type).toBe("checkbox");
    expect(rectOf(session, f.name)).toEqual({ x: 144, y: 192, w: 14, h: 14 });
  });

  it("the panel's buttons add a field in the middle of the page too", async () => {
    const { session } = await mount();
    await startDesign();
    await openProperties();
    await click([...qa("button", q(".pli-pdf-right"))].find((b) => b.textContent!.includes("Signature field")));
    expect(last(session).type).toBe("signature");
  });
});

describe("radio groups", () => {
  it("one click per button, then Enter makes the group", async () => {
    const { session, c } = await mount();
    await startDesign();
    await click(toolButton("Radio group"));
    await tap([210, 120]);
    await tap([240, 120]);
    await tap([270, 120]);
    expect(c().radio!.points).toHaveLength(3);
    expect(session.doc.fields).toHaveLength(8);
    expect(document.querySelectorAll(".pli-form-draft")).toHaveLength(3);
    expect(bar().textContent).toContain("Finish radio group (3)");
    await press(q(".pli-pdf-scroller"), "Enter");
    const f = last(session);
    expect(f.type).toBe("radio");
    expect(f.name).toBe("Radio1");
    expect(f.widgets.map((w) => w.on)).toEqual(["Choice1", "Choice2", "Choice3"]);
    expect(f.widgets.map((w) => ({ ...w.rect }))).toEqual([
      { x: 204, y: 112, w: 14, h: 14 },
      { x: 232, y: 112, w: 14, h: 14 },
      { x: 264, y: 112, w: 14, h: 14 },
    ]);
    expect(f.appearance!.checkStyle).toBe("circle");
    expect(c().radio).toBeNull();
    // one undo step
    await run(() => session.undo());
    expect(session.doc.fields).toHaveLength(8);
  });

  it("a double-click on the last button finishes the group; the button on it is not added twice", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Radio group"));
    await tap([210, 120], { zoom: 1 });
    await tap([250, 120]);
    await tap([250, 120]);
    expect(last(session).type).toBe("radio");
    expect(last(session).widgets).toHaveLength(2);
  });

  it("the bar's button finishes it, and Escape drops it", async () => {
    const { session, c } = await mount();
    await startDesign();
    await click(toolButton("Radio group"));
    await tap([210, 120]);
    await tap([250, 160]);
    await click([...qa("button", bar())].find((b) => b.textContent!.startsWith("Finish radio group")));
    expect(last(session).widgets).toHaveLength(2);
    await click(toolButton("Radio group"));
    await tap([210, 250]);
    expect(c().radio!.points).toHaveLength(1);
    await press(q(".pli-pdf-scroller"), "Escape");
    expect(c().radio).toBeNull();
    expect(session.doc.fields).toHaveLength(9);
  });

  for (const turns of [1, 2, 3]) {
    it(`takes its points in page space with the view turned ${turns * 90} degrees`, async () => {
      const { session } = await mount({ turns, zoom: 1.5 });
      await startDesign();
      await click(toolButton("Radio group"));
      await tap([210, 120], { rotation: turns * 90, zoom: 1.5 });
      await tap([250, 200], { rotation: turns * 90, zoom: 1.5 });
      await click([...qa("button", bar())].find((b) => b.textContent!.startsWith("Finish")));
      expect(last(session).widgets.map((w) => ({ ...w.rect }))).toEqual([
        { x: 204, y: 112, w: 14, h: 14 },
        { x: 244, y: 192, w: 14, h: 14 },
      ]);
    });
  }

  it("filling the group in fill mode picks one of the new buttons", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Radio group"));
    await tap([210, 120]);
    await tap([250, 160]);
    await press(q(".pli-pdf-scroller"), "Enter");
    await click([...qa("button", bar())].find((b) => b.textContent === "Done"));
    await click(control("Radio1", 1));
    expect(session.forms.byName("Radio1")!.value).toBe("Choice2");
  });
});

// ---- the properties panel ---------------------------------------------------------------------------------------

async function addText(session: PdfSession) {
  await startDesign();
  await click(toolButton("Text field"));
  await drag([212, 152], [288, 176]);
  return last(session);
}

describe("properties", () => {
  it("shows the selected field and edits its name, tooltip and flags", async () => {
    const { session } = await mount();
    const f = await addText(session);
    expect(q(".pli-pdf-right .pli-pdf-props-title").textContent).toBe("Text field");
    expect(prop("Name").value).toBe("Text1");
    await replaceText(prop("Name"), "surname");
    expect(session.doc.fields.find((x) => x.id === f.id)!.name).toBe("surname");
    await replaceText(prop("Tooltip"), "Your family name");
    expect(session.forms.byName("surname")!.tooltip).toBe("Your family name");
    expect(frame(f.id).getAttribute("aria-label")).toBe("Your family name, text field");
    const [required, readOnly] = qa<HTMLInputElement>(".pli-form-props .pli-pdf-actions input[type=checkbox]");
    await click(required);
    expect(session.forms.byName("surname")!.flags).toEqual({ required: true });
    await click(readOnly);
    expect(session.forms.byName("surname")!.flags).toEqual({ required: true, readOnly: true });
    await click(required);
    await click(readOnly);
    expect(session.forms.byName("surname")!.flags).toBeUndefined();
  });

  it("names are unique: a name that is taken shows the engine's message and changes nothing", async () => {
    const { session } = await mount();
    const f = await addText(session);
    const name = prop("Name");
    await replaceText(name, "notes");
    expect(q(".pli-form-props [role=alert]").textContent).toBe("there is already a field named notes");
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(name.getAttribute("aria-describedby")!)!.textContent).toContain("already a field");
    expect(session.doc.fields.find((x) => x.id === f.id)!.name).toBe("Text1");
    // an empty name, and a name inside a group
    await replaceText(name, "");
    expect(q(".pli-form-props [role=alert]").textContent).toContain("needs a name");
    await replaceText(name, "name.first");
    expect(q(".pli-form-props [role=alert]").textContent).toContain("holds a value");
    // leaving it shows the stored name again
    await blur(name);
    expect(prop("Name").value).toBe("Text1");
    expect(document.querySelector(".pli-form-props [role=alert]")).toBeNull();
    await replaceText(prop("Name"), "first.name");
    expect(session.doc.fields.find((x) => x.id === f.id)!.name).toBe("first.name");
  });

  it("typing a name is one undo step", async () => {
    const { session } = await mount();
    await addText(session);
    for (const n of ["a", "ab", "abc"]) await replaceText(prop("Name"), n);
    expect(session.forms.byName("abc")).toBeDefined();
    await run(() => session.undo());
    expect(session.forms.byName("Text1")).toBeDefined();
  });

  it("changes the position and size in points", async () => {
    const { session } = await mount();
    const f = await addText(session);
    await replaceText(prop("X"), "100");
    await replaceText(prop("Width"), "90.5");
    expect({ ...session.forms.get(f.id).widgets[0]!.rect }).toEqual({ x: 100, y: 152, w: 90.5, h: 24 });
    await replaceText(prop("Height"), "0");
    expect(q(".pli-form-props [role=alert]").textContent).toContain("width and a height");
    expect(session.forms.get(f.id).widgets[0]!.rect.h).toBe(24);
  });

  it("sets up the text options: multi-line, password, comb (which needs a length), maximum length", async () => {
    const { session } = await mount();
    const f = await addText(session);
    const check = (label: string) => qa<HTMLInputElement>(".pli-form-props .pli-pdf-check input").find((i) => i.parentElement!.textContent === label)!;
    await click(check("Password"));
    expect(session.forms.get(f.id).flags).toEqual({ password: true });
    expect(check("Multi-line").disabled).toBe(true);
    await click(check("Password"));
    await click(check("Comb (one character per cell)"));
    expect(session.forms.get(f.id).flags).toEqual({ comb: true, maxLength: 10 });
    expect(prop("Characters (cells)").value).toBe("10");
    await replaceText(prop("Characters (cells)"), "6");
    expect(session.forms.get(f.id).flags).toEqual({ comb: true, maxLength: 6 });
    await replaceText(prop("Characters (cells)"), "0");
    expect(session.forms.get(f.id).flags).toBeUndefined();
    await click(check("Multi-line"));
    expect(session.forms.get(f.id).flags).toEqual({ multiline: true });
  });

  it("sets the look: font, size, colours, border, fill, alignment", async () => {
    const { session } = await mount();
    const f = await addText(session);
    const select = (label: string) => prop(label) as unknown as HTMLSelectElement;
    await choose(select("Font"), ["Times-Bold"]);
    await replaceText(prop("Size (0 fits the text)"), "14");
    await choose(select("Align"), ["right"]);
    await replaceText(prop("Text colour"), "#cc0000");
    await replaceText(prop("Border width"), "2");
    await replaceText(prop("Border"), "#0000cc");
    const fillBox = qa<HTMLInputElement>(".pli-form-props .pli-pdf-check input").find((i) => i.parentElement!.textContent === "No fill")!;
    await click(fillBox);
    expect(fillBox.checked).toBe(false);
    await replaceText(prop("Fill"), "#ffffcc");
    expect(session.forms.get(f.id).appearance).toMatchObject({ font: "Times-Bold", size: 14, align: "right", color: "#cc0000", borderWidth: 2, border: "#0000cc", fill: "#ffffcc" });
    // and no border at all
    const noBorder = qa<HTMLInputElement>(".pli-form-props .pli-pdf-check input").find((i) => i.parentElement!.textContent === "No border")!;
    await click(noBorder);
    expect(session.forms.get(f.id).appearance!.border).toBeUndefined();
    // the preview in the frame follows
    const preview = frame(f.id).querySelector<HTMLInputElement>("[data-control]")!;
    expect(preview.style.fontSize).toBe("14px");
    expect(preview.style.textAlign).toBe("right");
  });

  it("sets a default value, which is what Clear form goes back to", async () => {
    const { session } = await mount();
    const f = await addText(session);
    await replaceText(prop("Default value"), "N/A");
    expect(session.forms.get(f.id)).toMatchObject({ value: "N/A", defaultValue: "N/A" });
    await run(() => session.forms.setValue(f.id, "changed"));
    await run(() => session.forms.reset());
    expect(session.forms.get(f.id).value).toBe("N/A");
  });

  it("edits the choices of a drop-down: add, change the value and label, reorder, remove", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Drop-down"));
    await drag([212, 152], [288, 176]);
    const f = last(session);
    const options = () => session.forms.get(f.id).options;
    expect(q(".pli-form-props fieldset legend").textContent).toBeDefined();
    await replaceText(byLabel("Choice 1 value", document) as HTMLInputElement, "red");
    await replaceText(byLabel("Choice 1 label", document) as HTMLInputElement, "Red");
    expect(options()![0]).toEqual({ value: "red", label: "Red" });
    await replaceText(byLabel("Choice 1 label", document) as HTMLInputElement, "");
    expect(options()![0]).toEqual({ value: "red" });
    await click([...qa("button", q(".pli-form-props"))].find((b) => b.textContent === "Add choice"));
    expect(options()!.map((o) => o.value)).toEqual(["red", "Option 2", "Option 3", "Option 4"]);
    await click(byLabel("Move choice 4 up", document));
    expect(options()!.map((o) => o.value)).toEqual(["red", "Option 2", "Option 4", "Option 3"]);
    expect((byLabel("Move choice 1 up", document) as HTMLButtonElement).disabled).toBe(true);
    await click(byLabel("Remove choice 2", document));
    expect(options()!.map((o) => o.value)).toEqual(["red", "Option 4", "Option 3"]);
    // a duplicate value is flagged but kept (the person may be midway through typing)
    await replaceText(byLabel("Choice 2 value", document) as HTMLInputElement, "red");
    expect(q(".pli-form-props [role=alert]").textContent).toBe("Two choices have the same value");
  });

  it("taking away the chosen option of a drop-down clears the value; a default can be picked from the choices", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Drop-down"));
    await drag([212, 152], [288, 176]);
    const f = last(session);
    await choose(prop("Default choice") as unknown as HTMLSelectElement, ["Option 2"]);
    expect(session.forms.get(f.id)).toMatchObject({ value: "Option 2", defaultValue: "Option 2" });
    await click(byLabel("Remove choice 2", document));
    expect(session.forms.get(f.id).value).toBe("");
    expect(session.forms.problems()).toEqual([]);
  });

  it("a list box allows several choices when told", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("List box"));
    await drag([212, 152], [288, 220]);
    const f = last(session);
    await click(qa<HTMLInputElement>(".pli-form-props .pli-pdf-check input").find((i) => i.parentElement!.textContent === "Allow several choices"));
    expect(session.forms.get(f.id).flags).toEqual({ multiSelect: true });
  });

  it("edits what each radio button stands for, and the mark of a check box", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Radio group"));
    await tap([210, 120]);
    await tap([250, 160]);
    await press(q(".pli-pdf-scroller"), "Enter");
    const f = last(session);
    await run(() => session.forms.setValue(f.id, "Choice2"));
    await replaceText(prop("Button 2 value"), "yes");
    expect(session.forms.get(f.id).widgets.map((w) => w.on)).toEqual(["Choice1", "yes"]);
    expect(session.forms.get(f.id).value).toBe("yes");
    await replaceText(prop("Button 2 value"), "Choice1");
    expect(q(".pli-form-props [role=alert]").textContent).toBe('Two buttons stand for "Choice1"');
    await replaceText(prop("Button 2 value"), "Off");
    expect(q(".pli-form-props [role=alert]").textContent).toContain("cannot be empty or Off");
    // the other button can be chosen to change its position
    await click([...qa("button", q(".pli-form-props"))].find((b) => b.textContent === "Select button"));
    expect(session.selection.fields).toEqual([f.id]);
    await choose(prop("Mark") as unknown as HTMLSelectElement, ["star"]);
    expect(session.forms.get(f.id).appearance!.checkStyle).toBe("star");

    await click(toolButton("Check box"));
    await drag([212, 252], [226, 266]);
    const box = last(session);
    expect(box.widgets[0]!.on).toBe("Yes");
    await replaceText(prop("Value when checked"), "agreed");
    expect(session.forms.get(box.id).widgets[0]!.on).toBe("agreed");
    for (const style of ["cross", "diamond", "square"]) {
      await choose(prop("Mark") as unknown as HTMLSelectElement, [style]);
      expect(session.forms.get(box.id).appearance!.checkStyle).toBe(style);
    }
  });

  it("edits a button's caption", async () => {
    const { session } = await mount();
    await startDesign();
    await click(toolButton("Button"));
    await drag([212, 152], [288, 176]);
    await replaceText(prop("Caption"), "Submit");
    expect(last(session).caption).toBe("Submit");
    expect(frame(last(session).id).textContent).toContain("Submit");
  });

  it("with nothing selected, lists the fields: choosing one selects it", async () => {
    const { session, c } = await mount();
    await startDesign();
    await openProperties();
    const row = [...qa("button", q(".pli-pdf-right"))].find((b) => b.textContent!.startsWith("fruit"))!;
    expect(row.textContent).toContain("List box, page 1");
    await click(row);
    expect(c().selection!.field.name).toBe("fruit");
    expect(session.selection.fields).toEqual(["f:fruit"]);
    expect(q(".pli-pdf-right .pli-pdf-props-title").textContent).toBe("List box");
  });

  it("Delete field and Duplicate in the panel", async () => {
    const { session } = await mount();
    const f = await addText(session);
    await click([...qa("button", q(".pli-form-props"))].find((b) => b.textContent!.includes("Duplicate")));
    expect(last(session).name).toBe("Text2");
    expect(last(session).id).not.toBe(f.id);
    await click([...qa("button", q(".pli-form-props"))].find((b) => b.textContent!.includes("Delete field")));
    expect(session.doc.fields.map((x) => x.name)).not.toContain("Text2");
    expect(session.doc.fields.map((x) => x.name)).toContain("Text1");
  });
});

// ---- select, move, resize, delete, duplicate ---------------------------------------------------------------------

describe("moving and resizing", () => {
  it("selects a widget with a click, and deselects with Escape", async () => {
    const { session, c } = await mount();
    await startDesign();
    const f = frame("f:name");
    await click(f);
    expect(f.getAttribute("aria-pressed")).toBe("false"); // a click event alone is not a pointer
    await dragOn(f, [100, 60], [100, 60]);
    expect(c().selected).toBe("w:main:8");
    expect(f.getAttribute("aria-pressed")).toBe("true");
    expect(session.selection.fields).toEqual(["f:name"]);
    expect(q(".pli-pdf-right .pli-pdf-props-title").textContent).toBe("Text field");
    expect(prop("Name").value).toBe("name");
    await press(f, "Escape");
    expect(c().selected).toBeNull();
  });

  for (const turns of [0, 1, 2, 3]) {
    it(`drags a widget (snapped to the grid) with the view turned ${turns * 90} degrees at zoom 1.5`, async () => {
      const { session } = await mount({ turns, zoom: 1.5 });
      await startDesign();
      const g: Gesture = { rotation: turns * 90, zoom: 1.5 };
      await dragOn(frame("f:name"), [100, 60], [111, 87], g);
      // moved by (11, 27), the corner snapped: x 80 + 11 = 91 -> 92, y 50 + 27 = 77 -> 76
      expect(rectOf(session, "name")).toEqual({ x: 92, y: 76, w: 200, h: 20 });
      expect(session.canUndo).toBe(true);
      await run(() => session.undo());
      expect(rectOf(session, "name")).toEqual({ x: 80, y: 50, w: 200, h: 20 });
    });
  }

  it("shows the widget where it is dragged while the pointer is down and commits once", async () => {
    const { session, c } = await mount();
    await startDesign();
    const f = frame("f:agree");
    const at = (x: number, y: number) => [x * (96 / 72), y * (96 / 72)] as const;
    const fire = (type: string, p: readonly [number, number]) => run(() => f.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: p[0], clientY: p[1], button: 0 })));
    await fire("pointerdown", at(85, 150));
    await fire("pointermove", at(125, 191));
    expect(c().preview.get("w:main:16")).toEqual({ x: 120, y: 184, w: 14, h: 14 });
    expect(f.style.left).toBe("120px");
    expect(rectOf(session, "agree")).toEqual({ x: 80, y: 142, w: 14, h: 14 }); // not yet in the document
    await fire("pointerup", at(125, 191));
    expect(c().preview.size).toBe(0);
    expect(rectOf(session, "agree")).toEqual({ x: 120, y: 184, w: 14, h: 14 });
  });

  it("a small wobble of the pointer is a click, not a move", async () => {
    const { session } = await mount();
    await startDesign();
    const doc = session.doc;
    await dragOn(frame("f:name"), [100, 60], [100.5, 60.5]);
    expect(session.doc).toBe(doc);
  });

  it("Alt drags without the grid, and keeps the widget on the page", async () => {
    const { session } = await mount();
    await startDesign();
    await dragOn(frame("f:agree"), [85, 150], [92.3, 158.4], { init: { altKey: true } });
    expect(rectOf(session, "agree")).toEqual({ x: 87.3, y: 150.4, w: 14, h: 14 });
    await dragOn(frame("f:agree"), [90, 155], [900, 900]);
    expect(rectOf(session, "agree")).toEqual({ x: 286, y: 386, w: 14, h: 14 });
  });

  it("resizes with the handles of the selected widget, with the grid, from any corner", async () => {
    const { session } = await mount();
    await startDesign();
    await dragOn(frame("f:notes"), [150, 100], [150, 100]);
    const handle = (h: string) => frame("f:notes").querySelector<HTMLElement>(`.pli-form-handle[data-handle="${h}"]`)!;
    expect(qa(".pli-form-handle", frame("f:notes"))).toHaveLength(8);
    await dragOn(handle("se"), [280, 130], [300, 152]);
    expect(rectOf(session, "notes")).toEqual({ x: 80, y: 80, w: 220, h: 72 });
    await dragOn(handle("nw"), [80, 80], [60, 60]);
    expect(rectOf(session, "notes")).toEqual({ x: 60, y: 60, w: 240, h: 92 });
    await dragOn(handle("e"), [300, 100], [248, 100]);
    expect(rectOf(session, "notes")).toEqual({ x: 60, y: 60, w: 188, h: 92 });
    await dragOn(handle("s"), [150, 152], [150, 100]);
    expect(rectOf(session, "notes")).toEqual({ x: 60, y: 60, w: 188, h: 40 });
    // never smaller than 8 points
    await dragOn(handle("se"), [248, 100], [0, 0]);
    expect(rectOf(session, "notes")).toMatchObject({ w: 8, h: 8 });
  });

  it("resizes at a turned view and zoom", async () => {
    const { session } = await mount({ turns: 3, zoom: 2 });
    await startDesign();
    const g: Gesture = { rotation: 270, zoom: 2 };
    await dragOn(frame("f:notes"), [150, 100], [150, 100], g);
    await dragOn(frame("f:notes").querySelector<HTMLElement>('.pli-form-handle[data-handle="se"]')!, [280, 130], [300, 152], g);
    expect(rectOf(session, "notes")).toEqual({ x: 80, y: 80, w: 220, h: 72 });
  });

  it("handles are big enough to hit: 12 screen pixels with a 24 pixel hit area, scaled to the zoom", async () => {
    await mount({ zoom: 2 });
    await startDesign();
    await dragOn(frame("f:notes"), [150, 100], [150, 100], { zoom: 2 });
    const h = frame("f:notes").querySelector<HTMLElement>('.pli-form-handle[data-handle="se"]')!;
    const scale = 2 * (96 / 72);
    expect(round(parseFloat(h.style.width) * scale)).toBe(12);
    expect(round(parseFloat(h.style.getPropertyValue("--hit")) * scale)).toBe(24);
  });

  it("a small widget only gets corner handles", async () => {
    await mount();
    await startDesign();
    await dragOn(frame("f:agree"), [85, 150], [85, 150]);
    expect(qa(".pli-form-handle", frame("f:agree")).map((h) => h.dataset.handle).sort()).toEqual(["ne", "nw", "se", "sw"]);
  });
});

describe("the keyboard", () => {
  it("arrow keys nudge the selected widget (Shift: 10), and a run of them is one undo step", async () => {
    const { session } = await mount();
    await startDesign();
    const f = frame("f:name");
    await focus(f);
    expect(f.getAttribute("aria-pressed")).toBe("true"); // focus selects
    await press(f, "ArrowRight");
    await press(f, "ArrowRight");
    await press(f, "ArrowDown", { shiftKey: true });
    expect(rectOf(session, "name")).toEqual({ x: 82, y: 60, w: 200, h: 20 });
    await run(() => session.undo());
    expect(rectOf(session, "name")).toEqual({ x: 80, y: 50, w: 200, h: 20 });
    expect(session.canUndo).toBe(false);
  });

  it("Alt+arrows resize; the widget stays on the page", async () => {
    const { session } = await mount();
    await startDesign();
    const f = frame("f:name");
    await focus(f);
    await press(f, "ArrowRight", { altKey: true });
    await press(f, "ArrowDown", { altKey: true, shiftKey: true });
    expect(rectOf(session, "name")).toEqual({ x: 80, y: 50, w: 201, h: 30 });
    for (let i = 0; i < 4; i++) await press(f, "ArrowLeft", { shiftKey: true });
    await press(f, "ArrowUp", { shiftKey: true });
    await press(f, "ArrowUp", { shiftKey: true });
    await press(f, "ArrowUp", { shiftKey: true });
    await press(f, "ArrowUp", { shiftKey: true });
    await press(f, "ArrowUp", { shiftKey: true });
    expect(rectOf(session, "name")).toEqual({ x: 40, y: 0, w: 201, h: 30 });
  });

  it("Delete removes the field, Ctrl+D copies it, and both undo", async () => {
    const { session, c } = await mount();
    await startDesign();
    const f = frame("f:notes");
    await focus(f);
    await press(f, "d", { ctrlKey: true });
    const copy = last(session);
    expect(copy.name).toBe("notes2");
    expect(copy.flags).toEqual({ multiline: true });
    expect(rectOf(session, "notes2")).toEqual({ x: 92, y: 92, w: 200, h: 50 });
    expect(c().selection!.field.id).toBe(copy.id);
    const g = frame(copy.id);
    await focus(g);
    await press(g, "Delete");
    expect(session.forms.byName("notes2")).toBeUndefined();
    expect(c().selected).toBeNull();
    await run(() => session.undo());
    expect(session.forms.byName("notes2")).toBeDefined();
    await run(() => session.undo());
    expect(session.forms.byName("notes2")).toBeUndefined();
    expect(session.doc.fields).toHaveLength(8);
  });

  it("Delete takes one button out of a radio group; the last one takes the group", async () => {
    const { session, c } = await mount();
    await startDesign();
    const widgets = session.forms.byName("size")!.widgets;
    await dragOn(frame("f:size"), [87, 179], [87, 179]);
    const first = document.querySelector<HTMLElement>(`[data-widget-id="${widgets[0]!.id}"]`)!;
    await dragOn(first, [87, 179], [87, 179]);
    expect(c().selected).toBe(widgets[0]!.id);
    await press(first, "Delete");
    expect(session.forms.byName("size")!.widgets.map((w) => w.on)).toEqual(["1"]);
    const second = document.querySelector<HTMLElement>(`[data-widget-id="${widgets[1]!.id}"]`)!;
    await focus(second);
    await press(second, "Delete");
    expect(session.forms.byName("size")).toBeUndefined();
  });

  it("Tab moves through the frames in reading order, and selects each", async () => {
    const { c } = await mount();
    await startDesign();
    await focus(frame("f:name"));
    await press(frame("f:name"), "Tab");
    expect(document.activeElement).toBe(frame("f:notes"));
    expect(c().selection!.field.name).toBe("notes");
    await press(frame("f:notes"), "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(frame("f:name"));
  });

  it("every frame is a button with a name that says what it is", async () => {
    await mount();
    await startDesign();
    expect(frame("f:name").getAttribute("aria-label")).toBe("name, text field");
    expect(frame("f:notes").getAttribute("aria-label")).toBe("notes, multi-line text");
    expect(frame("f:size").getAttribute("aria-label")).toBe("size: 0, radio group");
    expect(frame("f:send").getAttribute("aria-label")).toBe("Send, button");
    expect(frame("f:name").tabIndex).toBe(0);
  });
});

describe("tab order view", () => {
  it("numbers the fields in the order Tab visits them", async () => {
    const { session } = await mount();
    await startDesign();
    expect(document.querySelector(".pli-form-order")).toBeNull();
    await click(byLabel("Show tab order", document));
    const numbers = qa(".pli-form-order").map((n) => `${n.closest<HTMLElement>(".pli-form-design")!.dataset.fieldId}:${n.textContent}`);
    expect(numbers).toEqual(["f:name:1", "f:notes:2", "f:agree:3", "f:size:4", "f:colour:5", "f:fruit:6", "f:sig:7", "f:send:8"]); // one for the radio group
    // moving a field changes its number
    await run(() => session.forms.setRect("w:main:16", { x: 80, y: 10, w: 14, h: 14 }));
    expect(frame("f:agree").querySelector(".pli-form-order")!.textContent).toBe("1");
    expect(frame("f:name").querySelector(".pli-form-order")!.textContent).toBe("2");
    await click(byLabel("Show tab order", document));
    expect(document.querySelector(".pli-form-order")).toBeNull();
  });
});

describe("the bar's buttons", () => {
  it("duplicate and delete are off with nothing selected", async () => {
    await mount();
    await startDesign();
    expect((byLabel("Duplicate field", document) as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel("Delete field", document) as HTMLButtonElement).disabled).toBe(true);
    await dragOn(frame("f:name"), [100, 60], [100, 60]);
    expect((byLabel("Delete field", document) as HTMLButtonElement).disabled).toBe(false);
  });

  it("delete and duplicate work on the selection", async () => {
    const { session } = await mount();
    await startDesign();
    await dragOn(frame("f:name"), [100, 60], [100, 60]);
    await click(byLabel("Duplicate field", document));
    expect(last(session).name).toBe("name2");
    await click(byLabel("Delete field", document));
    expect(session.forms.byName("name2")).toBeUndefined();
  });

  it("duplicating a radio group copies every button and keeps the values", async () => {
    const { session, c } = await mount();
    await startDesign();
    await dragOn(frame("f:size"), [87, 179], [87, 179]);
    await click(byLabel("Duplicate field", document));
    const copy = session.forms.byName("size2")!;
    expect(copy.widgets.map((w) => w.on)).toEqual(["0", "1"]);
    expect(copy.widgets.map((w) => ({ ...w.rect }))).toEqual([
      { x: 92, y: 184, w: 14, h: 14 },
      { x: 124, y: 184, w: 14, h: 14 },
    ]);
    expect(c().selection!.field.id).toBe(copy.id);
  });
});

// ---- the whole thing ---------------------------------------------------------------------------------------------

describe("a form made here, filled, saved and opened again", () => {
  it("round trips through a PDF file", async () => {
    const session = await openPdf(fixture("forms-basic"));
    await mount({ session });
    await startDesign();
    await click(toolButton("Text field"));
    await drag([212, 152], [288, 176]);
    await replaceText(prop("Name"), "city");
    await replaceText(prop("Default value"), "Oslo");
    await click(toolButton("Drop-down"));
    await drag([212, 200], [288, 224]);
    await replaceText(prop("Name"), "pick");
    await click(toolButton("Radio group"));
    await tap([210, 250]);
    await tap([250, 250]);
    await press(q(".pli-pdf-scroller"), "Enter");
    await replaceText(prop("Name"), "choice");
    await click([...qa("button", bar())].find((b) => b.textContent === "Done"));
    const pick = session.forms.byName("pick")!;
    await choose(document.querySelector<HTMLSelectElement>(`[data-field-id="${pick.id}"] select`)!, ["Option 2"]);
    await click(document.querySelector<HTMLInputElement>(`[data-field-id="${session.forms.byName("choice")!.id}"][data-widget-id="${session.forms.byName("choice")!.widgets[1]!.id}"] input`)!);
    const again = await openPdf(await session.save());
    expect(again.forms.exportData()).toMatchObject({ city: "Oslo", pick: "Option 2", choice: "Choice2" });
    expect(again.forms.byName("city")!.widgets[0]!.rect).toEqual({ x: 212, y: 152, w: 76, h: 24 });
    expect(again.forms.byName("choice")!.widgets).toHaveLength(2);
    expect(again.forms.byName("pick")!.options!.map((o) => o.value)).toEqual(["Option 1", "Option 2", "Option 3"]);
    expect(widget("name")).not.toBeNull();
  });
});
