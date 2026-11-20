---
title: Images
description: Insert, resize and align images, and how they are stored and exported.
---

## Adding an image

- **Insert > Image** or the image button in the toolbar: upload a file or enter a URL.
- **Paste** an image from the clipboard, such as a screenshot.
- **Drag and drop** an image file onto the page, where you want it.

Images go on their own line. Click one to select it, then:

- Drag a **corner handle** to resize it. The proportions are kept.
- Use the **alignment** buttons to place it left, center or right.
- Use **Picture options** in the toolbar (or **Format > Picture**) to make the text flow beside it. This works inside a table cell too. In a header, footer or footnote a picture stays on its own line.
- Press **Delete** or **Backspace** to remove it.

## Wrapping text around a picture

A picture is **in line with text** by default: it sits on its own line, and the text goes above and below it. Choose **Wrap text, picture on the left** or **picture on the right** and the picture floats to that side, with the paragraphs after it running down the other side. The text that follows lines up next to the picture until it is taller than the picture, and then continues underneath.

```ts
session.setImageWrap("right"); // the selected picture floats right
session.setImageWrap("left");
session.setImageWrap(null);    // back in line with text
```

In a document the picture is an ordinary image block with `wrap: "left"` or `wrap: "right"`, and it stays where it is in the block order. A few things to know:

- A wrapped picture moves to the next page as a whole when it would cross a page bottom.
- Wrapping is not available inside headers, footers and footnotes. A picture pasted or imported there stays in line.
- A page break or section break clears the float, so the next page starts with full-width text.
- Pictures that are wrapped in a pasted web page (`float: left` or `float: right`), in a pasted Google Docs page, or in a DOCX file ("square" wrapping) come in wrapped.

A picture can also be set at a place on the page instead of in a line of text, behind the text or over it, as a page background or a logo in a corner. See [Text boxes, shapes and page backgrounds](/documents/features/text-boxes-and-backgrounds/).

## How they are stored

An uploaded or pasted image is embedded in the document as a `data:` URI, so a document is a single self-contained file. To keep files in your own storage instead, see [Storing files](/documents/guides/storing-files/). To keep documents small, an image whose longer side is more than 1,600 pixels is scaled down first. GIFs are left alone so they keep their animation. An image added from a URL stays a link.

```ts
import { image } from "@pli.dev/docs";

session.insertBlockAtCaret(
  image(dataUri, { width: 480, height: 270 }, { alt: "A bar chart", align: "center" }),
);

session.updateBlock(imageId, { width: 240, height: 135 }); // resize in code
```

`imageBlockFromFile(file)` and `imageBlockFromUrl(url)` in `@pli.dev/react` read a file or URL into an image block, picking a sensible size.

Always give images a description (`alt`) so screen readers can read them. The upload dialog uses the file name by default.

## In exports

| Format | Result |
|--------|--------|
| DOCX | Embedded for PNG, JPEG and GIF `data:` URIs, scaled down to fit the text area. A wrapped picture is written as an anchored picture with square wrapping, attached to the paragraph after it, so Word and LibreOffice wrap the text the same way |
| HTML | An `<img>` tag, with `float` when wrapped. Only `http`, `https` and `data:image` sources are written, so a document can't smuggle in a `javascript:` address |
| Markdown | `![alt](source)` |

An image that is only a URL can't be embedded in a DOCX file without downloading it, so the file gets a "[Image: description]" placeholder instead. Embed the image if it needs to travel with a DOCX file.

## Cropping

Select a picture and open **Picture options** in the toolbar (or **Format > Picture**):

- **Crop** shows all of the picture with what is cut away dimmed, and a grip on each edge. Drag a grip to cut that edge, and click elsewhere to finish. As in Word, cutting an edge makes the picture smaller on the page.
- **Crop to a shape** cuts to a square, 4 : 3, 16 : 9 or 3 : 4 from the middle of the picture.
- **Show all of the picture** takes the crop off. The file keeps the whole picture, so a crop can always be changed.

A crop is kept when you export to DOCX (as Word's own crop), HTML and PDF, and when you copy and paste the picture. In code, `session.cropImage(id, { top, right, bottom, left }, { rescale: true })` crops a picture by the share of it to cut from each edge, and `null` shows all of it.
