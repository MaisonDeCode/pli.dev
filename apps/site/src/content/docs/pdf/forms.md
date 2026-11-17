---
title: Forms
description: "Fill, make and flatten PDF form fields (AcroForm) with Pli.PDF: values, checks, new fields, and what a saved file looks like in other readers."
---

A PDF form is a list of fields (text, check box, radio group, drop-down, list, button, signature), each shown by one or more widgets on the pages. Pli.PDF reads them into `session.doc.fields` as plain JSON, changes them with undoable operations, and writes them back as real PDF form fields with appearances, so any reader shows what you set.

```ts
import { openPdf } from "@pli.dev/pdf";

const session = await openPdf(bytes);
session.forms.list();                    // every field: name, type, value, options, flags, widgets
session.forms.fill({ "person.name": "Ana", agree: true, size: "M", colour: "Green" });
const filled = await session.save();     // the original file plus the change
```

## What is read

Every field in the form tree, with the entries it inherits from its parents (type, flags, value, default, font, alignment, options, maximum length). A field's name is its parts joined by dots (`person.name`). A field can have several widgets: a radio group has one per button, and `on` says which value a button stands for. Widgets that sit on a page but are missing from the form's field list are read too.

Each field has an id (`f:person.name`, and `#2` after it if a name repeats) and each widget one (`w:main:42`). Two people who open the same file get the same ids. Rectangles are in page space: points from the top left of the page's visible box.

## Fill

`fill` checks every value before it changes anything, then applies them all as one undo step.

| Field | Value |
|---|---|
| text | text, no longer than its maximum length |
| check box | `true` or `false` |
| radio group | one of its buttons' `on` values, or `null` for none |
| drop-down | one of its options (its label works too), or any text if it is editable |
| list | an array of options, one only unless it takes several |
| button, signature | cannot be filled |

A wrong value, a name that does not exist or a read-only field throws a `PliError` (`invalid_operation` or `not_found`) and nothing changes.

```ts
session.forms.reset();                           // every field back to its default value
session.forms.problems();                        // required fields left empty, text too long, a choice not in the list
session.forms.isValid();
const data = session.forms.exportData();         // { "person.name": "Ana", agree: true, … }
session.forms.importData(data);                  // fills what fits, reports { applied, skipped }
```

## Make, change and remove

```ts
const page = session.doc.pages[0]!.id;

const nameId = session.forms.addField(page, { type: "text", name: "person.name", rect: { x: 72, y: 100, w: 200, h: 22 } });   // returns the field's id
session.forms.addField(page, { type: "checkbox", name: "agree", rect: { x: 72, y: 140, w: 14, h: 14 } });
session.forms.addField(page, {
  type: "radio",
  name: "size",
  buttons: [{ rect: { x: 72, y: 170, w: 14, h: 14 }, on: "S" }, { rect: { x: 110, y: 170, w: 14, h: 14 }, on: "M" }],
});
session.forms.addField(page, { type: "dropdown", name: "colour", rect: { x: 72, y: 200, w: 120, h: 20 }, options: ["Red", { value: "g", label: "Green" }] });

session.forms.update(nameId, { flags: { required: true }, appearance: { size: 14, fill: "#ffffe6" } });
const [widget] = session.forms.get(nameId).widgets;                  // a field's boxes on the pages
session.forms.setRect(widget!.id, { x: 80, y: 100, w: 180, h: 22 });  // move or resize one
session.forms.setRects([{ widget: widget!.id, rect: { x: 80, y: 120, w: 180, h: 22 } }]);   // several at once, one undo step
session.forms.remove([session.forms.byName("agree")!.id]);
```

New fields get a black one-point border and 12-point Helvetica; `appearance` changes that (font, size, colour, fill, border, alignment, and the mark of a check box). Names must be new: `a` and `a.b` cannot both hold values, because `a` would be both a field and a group. Dots in a name make groups, and fields in the same group share its parent in the file.

## Saving

- Update of the original. Filling and making fields add to the end of the file, so the original bytes stay exactly as they were. That is what keeps a digital signature valid. Pli.PDF cannot make or check a signature. It keeps one that is there and can make an empty signature field for someone else to sign.
- Appearances. Text, drop-downs, lists and buttons are drawn again whenever they change: single and multiple lines (wrapped), comb cells, password dots, alignment, automatic font size, the border and background. Check boxes and radio buttons keep the look they have or get a mark (check, cross, circle, square, diamond, star). The form's "need appearances" flag is switched off, so no reader paints something else.
- Fonts. A field keeps the font its form names. Text that standard fonts can't show (Western European letters are fine) needs a TrueType file in `session.save({ fonts: { Lora: bytes } })`; without one the characters are drawn as `?` and `save` reports a warning.
- XFA. Forms made by Adobe LiveCycle carry XFA data next to the fields. Pli.PDF works on the fields, and removes the XFA data when it changes values, because readers would show the old values from it.
- Flatten. `session.save({ flatten: "forms" })` draws every field into its page and removes the widgets and the form. It writes a new file.

JavaScript in a form (calculations, formatting, validation scripts) is kept in the file but not run: after you change one field, fields that depend on it are not recalculated.

## In the editor

[`PdfEditor`](/pdf/ready-made-ui/) has the form tools, and so has `FormsPdf` (the same component). `AnnotatedPdf` does not. Fields are drawn as real controls on the page (text boxes, text areas, check boxes, radio buttons, drop-downs, lists) and update the session as people type, so every change can be undone, is shared with other people and is saved. Tab and Shift with Tab go through the fields in reading order, also across pages; a field with a mistake (too long, required and empty) says so next to it.

- The form bar above the pages appears when the file has fields. It has **Highlight fields** (a wash over every field, on by default), **Clear form** and **Flatten…**, and the cross dismisses it.
- The Form menu (Tools > Form, and a drop-down in the toolbar with `topToolbar`) has the same, plus **Export data…** (the values as a JSON file), **Import data…**, **Prepare form** and **Show form bar**.
- **Flatten…** explains what it does (it writes a new file in which the values are part of the page and the fields are gone), then saves it. With `onFlatten(bytes, { name })` you get the file. Without it the browser downloads `<name>-flattened.pdf`.
- **Prepare form** is where you design the form. Pick a field type (text field, multi-line text, check box, radio group, drop-down, list box, signature field, button) and drag a box or click on a page, or press Shift with Enter on the button to put one in the middle. A radio group is made by clicking each button's place and then Enter or a double click. Drag a field to move it, drag its handles to resize it (they snap to a 4 point grid; hold Alt to place freely), duplicate and delete it, **align and distribute** several (below), and **Show tab order** to see the order Tab visits the fields in. The properties panel on the right (it opens when a field is selected, and from the Properties button) sets the name, tooltip, required and read-only flags, the position and size, the options of a drop-down or list, the maximum length, comb cells, password and multi-line of a text field, the mark of a check box and the value of each radio button, the caption of a button, the default value, and the look: font, size, colours, border and fill.

**Align and distribute.** In Prepare form, Shift or Ctrl/Cmd with a click adds a field to the selection (or takes it out). The panel then shows "3 fields" with the same six **Align** buttons (left, centre, right, top, middle, bottom) and two **Distribute** buttons (horizontally, vertically) as the annotation tools have. Align lines the fields up on an edge or a middle line of the box around all of them. Distribute makes the gaps between them equal and keeps the outer two where they are (it needs three). They work on the fields on the same page as the first one selected, they do not use the 4 point grid (the fields line up exactly), and each is one undo step (it calls `session.forms.setRects`). With several fields selected the arrow keys move them all together and Delete deletes them all. Handles and the properties of one field show again when you click a single field.

```tsx
import { PdfEditor } from "@pli.dev/pdf-react";

<PdfEditor
  session={session}
  renderer={renderer}
  forms={{
    onSign: (field) => openMySignatureDialog(field.name),
    onFlatten: async (bytes, { name }) => {
      await fetch(`/flattened/${name}`, { method: "PUT", body: bytes as BodyInit });
    },
  }}
/>
```

`forms` takes `onSign(field, widget)` (a signature field was clicked: with the annotation tools included, the signature dialog opens by default, and what the person draws, types or uploads is put inside that field: see [Signing a signature field](#signing-a-signature-field)), `onFlatten(bytes, { name })`, `download` (how data files are handed over; default the editor's `onDownload`) and `highlight` (start with the fields highlighted, default `true`). For the form tools alone, use `annotations={false}`. As in the engine, a drawn signature is a picture, not a cryptographic signature. The keys are on [Keyboard shortcuts](/pdf/shortcuts/#forms).

### Signing a signature field

Click a signature field (the box that says **Sign here**) and the signature dialog opens (draw, type or upload). **Use signature** puts the signature inside the field's box, as big as fits with its own proportions (a small margin is left), in one step of undo. From then on:

- the field draws **nothing of its own**: no caption, no wash, no dashed border. The signature is the only thing in the box, and the box lets the pointer through, so the signature can be picked up, moved or deleted;
- in the **saved file** the field's widget gets an empty appearance and is marked hidden (some readers, MuPDF among them, draw their own mark over every signature field that holds no digital signature, whatever its appearance says), the signature is an ordinary annotation that keeps the name of the field it signs, and **flattening** leaves the signature on the page with no caption and no field;
- **undo, redo or deleting the signature** bring the field back as it was (the caption again). Cancelling the dialog changes nothing. Signing again replaces the signature in one step.

The same from code, with the field's id or name:

```ts
session.forms.sign("signature", { mode: "draw", strokes, box: { width: 300, height: 60 }, color: "#112233", width: 2 }); // or { mode: "type", text } or { mode: "image", picture }
signatureOf(session.doc, session.forms.byName("signature")!); // the signature annotation of a field, or undefined
```

This is a signature picture, as in every PDF editor, not a digital signature ([Files](/pdf/files/#digital-signatures)). A signature field that already holds a digital signature (`field.signed`) refuses it. If the field is renamed afterwards the link to its signature is not followed; a field made by another program keeps the caption its own appearance had until it is signed.

For your own layout, `useFormsKit(session, options)` returns the pieces as props for `PliPdf` (the controls on the pages, the form bar and Prepare form, the properties panel) and `hostProps` for an element around it. Its `controller` is a plain `FormController` you can drive: `controller.designing`, `setDesigning(true)`, `clear()`, `exportData()`.
