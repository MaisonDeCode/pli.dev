---
title: Text boxes, shapes and page backgrounds
description: Put a picture behind a page, and text boxes, shapes and pictures at a place on it. They fill in like the rest of a template.
---

Most of a document is text that flows from one page to the next. Some things don't flow: the picture behind a cover page, a framed box with the client's details, a logo in a corner. Those sit **at a place on the page** and take no room in the text, so the text around them doesn't move.

There are three kinds, and all three are made the same way:

- **A page background**, a picture the size of the page, behind the text.
- **A text box**, a box of text with an optional fill and outline. Text in it is edited like any other.
- **A shape**, a text box with nothing in it: a rectangle, rounded rectangle or oval.

## Adding them

- **Insert > Page background…** chooses a picture and fits it to the page. If its shape isn't the page's, the edges that don't fit are cropped, so it is never stretched.
- **Insert > Text box** puts a box at the paragraph the caret is in, with the caret in it, ready to type.
- **Insert > Shape** puts in a rectangle, a rounded rectangle or an oval.

A box or picture belongs to the paragraph after it (or before it, if it is the last thing in the document), and is drawn on the page that paragraph is on. If that paragraph moves to the next page, the box goes with it.

## Moving and changing them

- **Drag** a picture, or the bar along the top of a text box, to move it. Drag the square at a text box's corner to resize it. A picture has the same corner handles as any picture.
- **Format > Object on the page > Options…** sets where it is and how it looks: what its position is measured from (the edge of the page, the margin, the text column, or its paragraph), how far, or whether to line it up with a side or the middle; its size; whether it is behind the text; and for a text box its shape, fill and outline.
- **Behind the text** puts it under the text. Text goes over it, and it can't be clicked, so clicks go to the text. To select one, choose it from the list at the bottom of **Format > Object on the page**.
- **Delete** removes it. Backspace and Delete next to one never remove it or join paragraphs across it by accident.

Anything that runs off the edge of the page is cut off there, as in Word.

## Templates

The text in a text box can hold `{{ placeholders }}`, conditions and everything else a [template](/documents/guides/documents-from-answers/) can, and it is filled in when the document is made. A cover page with the facility's name and address is one template.

To leave a whole box or picture out sometimes, put it between a `{{#if …}}` and its `{{/if}}`, each on a line of its own. A picture's address can be a placeholder too: `{{ logo }}`.

```ts
import { createDoc, generateDocument, pageBackground, paragraph, textBox } from "@pli.dev/docs";

const template = createDoc("Report for {{ client.name }}", [
  pageBackground(artworkDataUri, { width: 816, height: 1056 }),
  textBox(["PREPARED FOR", "{{ client.name }}"], {
    x: { from: "page", align: "center" },
    y: { from: "page", offset: 360 },
    width: 560,
    height: 300,
    fill: "#ffffff",
    line: { color: "#000000", width: 8, style: "double" },
  }),
  paragraph(""),
]);

const { doc } = generateDocument(template, { client: { name: "Harlow Foods" } });
```

The *Cover pages* demo in the playground builds a cover this way, and fills it in from a form.

## In code

A floating picture is an ordinary image block with a `float`, and a text box is a one-cell table with a `float`, so both are saved, copied and sent between people like the rest.

```ts
import { floatingImage, textBox, isFloating } from "@pli.dev/docs";

session.insertFloat(textBox("Hello", { x: { from: "column" }, y: { from: "paragraph" }, width: 300, height: 120 }));
session.insertFloat(floatingImage(src, { width: 96, height: 40 }, { x: { from: "margin", align: "right" }, y: { from: "page", offset: 24 } }));

session.setFloat({ behind: true });                // the selected one (or the one the caret is in)
session.setFloat({ x: { from: "page", offset: 40 } }, id);
session.setFloat(null, id);                        // back in the text
session.floats;                                    // every one, in document order
```

A position is `{ from, offset?, align? }`. Across the page, `from` is `page`, `margin` or `column`, and `align` is `left`, `center` or `right`. Down the page, `from` is `page`, `margin` or `paragraph`, and `align` is `top`, `center` or `bottom`. With `align`, `offset` is the gap left from that side. Distances are in CSS pixels (96 to the inch) and can be negative. `behind: true` puts it under the text, and `z` orders the ones that overlap.

## Word, PDF and the web

| Format | Result |
|--------|--------|
| DOCX | Written as pictures and text boxes anchored to the paragraph after them, with the text going straight through (`wrapNone`), behind the text when they are. Read the same way: a picture or text box anchored in the body with no wrapping comes in as one placed on the page, with its position, size, fill, outline, shape, insets and text |
| PDF | Drawn where they sit: behind the text of their page, or over it, with a fill and outline (a double line is drawn as two) |
| HTML | Placed against the text column at their paragraph, as absolutely positioned boxes. A web page has no pages, so positions measured from the page's edge are measured from the column |
| Markdown | A text box becomes its text. A picture on the page is left out |

## Not done yet

- A text box can't hold a table, and pictures in one don't float.
- Text doesn't wrap around a box or picture; it goes through. A picture that a Word file wraps text around still wraps, as a picture beside the text.
- They can only go in the body, not a header or footer. A header or footer in a Word file that has text boxes or shapes in it loses them, with a warning. To put a picture behind every page, today you add one to each.
- Shapes other than a rectangle, rounded rectangle and oval, lines and arrows, rotation, groups and picture or gradient fills aren't read or drawn. A gradient is read as its first colour.
- Only the bottom-right corner of a text box resizes it by dragging.
