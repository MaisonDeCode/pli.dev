# Fixtures

Small PDFs the tests open. None has real names, addresses or licensed content: the text is generic. Each line says how the file was made, so it can be made again.

- `forms-basic.pdf`: one page with a text field, a multi-line text field, a check box, a two-button radio group, a drop-down, a list box, an empty signature field and a push button. Made with PyMuPDF (`pymupdf.Widget`, one per field type) by `scripts/make-form-fixtures.py`.
- `forms-acro.pdf`: an Acrobat-style form made by hand with pikepdf (same script): a `person` group whose `/FT` and `/DA` the two text fields inherit, a check box that is its own widget, a radio group with two `/Kids`, a drop-down with `[value label]` options, `/NeedAppearances true`, and one text field that is on the page but not in `/Fields`.
- `annots-mupdf.pdf`: two pages; the first has text, a highlight, underline, strikeout and squiggly (each with a comment and an author), ink, a rectangle, a circle, a line with ends, a polygon, a polyline, a free text box, a sticky note with its popup, a stamp and two links (a web address and a place in the document). Made with PyMuPDF by `scripts/make-annot-fixtures.py`.
- `annots-crop.pdf`: one page with a crop box that does not start at the origin and a rotation of 90 degrees, with a highlight. PyMuPDF, same script.
- `annots-reply.pdf`: a sticky note with a popup, two replies (one to a reply), a review state annotation (`/StateModel /Review /State /Completed`), a highlight with entries Pli does not know (`/StructParent`, `/Custom`), and things the reader must skip or leave alone: a caret annotation, a square without `/Rect`, an ink annotation with a broken `/InkList`, a form widget. Made by hand with pikepdf (same script).
