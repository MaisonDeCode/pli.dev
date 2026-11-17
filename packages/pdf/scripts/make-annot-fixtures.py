"""
Makes the small test PDFs `test/fixtures/annots-*.pdf` with PyMuPDF and pikepdf, so other tools' annotations can be read and rewritten
by the tests. Usage: python make-annot-fixtures.py out_dir. (pymupdf is AGPL: used only to make test files, never shipped.)
"""
import pymupdf, pikepdf, sys, os
from pikepdf import Name, Dictionary, Array, String

out = sys.argv[1]

# 1. markup, shapes, notes, stamps, links made by PyMuPDF
doc = pymupdf.open()
doc.new_page(width=300, height=400)
doc.new_page(width=300, height=400)
page = doc[0]
page.insert_text((20, 50), "Hello highlighted world", fontsize=14)
page.insert_text((20, 80), "Underlined text here", fontsize=14)
page.insert_text((20, 110), "Struck out text", fontsize=14)
page.insert_text((20, 140), "Squiggly text", fontsize=14)
for word, fn, color in (("highlighted", page.add_highlight_annot, (1, 1, 0)), ("Underlined", page.add_underline_annot, (0, 0.5, 0)), ("Struck", page.add_strikeout_annot, (1, 0, 0)), ("Squiggly", page.add_squiggly_annot, (0, 0, 1))):
    rects = page.search_for(word)
    a = fn(quads=rects)
    a.set_colors(stroke=color)
    a.set_info(content=f"about {word}", title="Reviewer A")
    a.update(opacity=1.0)
page.add_ink_annot([[(20, 200), (40, 220), (60, 200), (80, 220)], [(20, 240), (80, 240)]]).set_colors(stroke=(1, 0, 0))
ink = [a for a in page.annots() if a.type[1] == "Ink"][0]
ink.set_border(width=3)
ink.update()
r = page.add_rect_annot(pymupdf.Rect(100, 190, 160, 230))
r.set_colors(stroke=(0, 0, 1), fill=(0.8, 0.9, 1)); r.set_border(width=2); r.set_opacity(0.8); r.update()
c = page.add_circle_annot(pymupdf.Rect(170, 190, 230, 230))
c.set_colors(stroke=(0, 0.5, 0), fill=(1, 1, 0.6)); c.set_border(width=2, dashes=[3, 2]); c.update()
l = page.add_line_annot((20, 270), (120, 300))
l.set_colors(stroke=(0.5, 0, 0.5)); l.set_border(width=2); l.set_line_ends(pymupdf.PDF_ANNOT_LE_OPEN_ARROW, pymupdf.PDF_ANNOT_LE_CIRCLE); l.update()
pg = page.add_polygon_annot([(150, 260), (200, 260), (225, 300), (175, 320), (140, 300)])
pg.set_colors(stroke=(0, 0, 0), fill=(1, 0.8, 0.8)); pg.set_border(width=1.5); pg.update()
pl = page.add_polyline_annot([(240, 260), (270, 280), (240, 300), (270, 320)])
pl.set_colors(stroke=(0.2, 0.2, 0.2)); pl.set_border(width=2); pl.update()
ft = page.add_freetext_annot(pymupdf.Rect(20, 330, 150, 380), "Free text box\nsecond line", fontsize=11, fontname="helv", text_color=(0, 0, 0.8), fill_color=(1, 1, 0.8), align=0)
n = page.add_text_annot((250, 20), "A sticky note", icon="Note")
n.set_info(title="Reviewer B"); n.update()
page.add_stamp_annot(pymupdf.Rect(170, 335, 290, 385), stamp=0)
page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(20, 36, 120, 56), "uri": "https://example.com/a"})
page2 = doc[1]
page2.insert_text((20, 50), "Second page")
page.insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(130, 36, 220, 56), "page": 1, "to": pymupdf.Point(0, 100)})
doc.save(os.path.join(out, "annots-mupdf.pdf"), garbage=3, deflate=True)

# 2. A cropped, rotated page with a highlight
doc = pymupdf.open()
page = doc.new_page(width=300, height=400)
page.insert_text((70, 100), "Cropped page text", fontsize=14)
page.set_cropbox(pymupdf.Rect(50, 60, 250, 360))
page.set_rotation(90)
h = page.add_highlight_annot(page.search_for("Cropped"))
h.set_colors(stroke=(1, 0.5, 0))
h.update()
doc.save(os.path.join(out, "annots-crop.pdf"), garbage=3, deflate=True)

# 3. Replies, review state, popups and unknown things made with pikepdf
pdf = pikepdf.new()
page = pdf.add_blank_page(page_size=(300, 400))
def annot(d):
    a = pdf.make_indirect(Dictionary(**d)); return a
note = annot(dict(Type=Name.Annot, Subtype=Name.Text, Rect=[40, 340, 64, 364], Contents=String("First comment"), T=String("Ana Example"), Name=Name.Comment, Open=True, C=[1, 0.8, 0], CreationDate=String("D:20260102030405Z"), M=String("D:20260102030405+01'00'"), F=4))
popup = annot(dict(Type=Name.Annot, Subtype=Name.Popup, Rect=[100, 300, 250, 360], Parent=note, Open=True))
note.Popup = popup
reply1 = annot(dict(Type=Name.Annot, Subtype=Name.Text, Rect=[40, 340, 64, 364], Contents=String("Reply one"), T=String("Ben Example"), IRT=note, RT=Name.R, Name=Name.Comment, CreationDate=String("D:20260103000000Z"), F=28))
reply2 = annot(dict(Type=Name.Annot, Subtype=Name.Text, Rect=[40, 340, 64, 364], Contents=String("Reply two"), T=String("Ana Example"), IRT=reply1, RT=Name.R, Name=Name.Comment, CreationDate=String("D:20260104000000Z"), F=28))
state = annot(dict(Type=Name.Annot, Subtype=Name.Text, Rect=[40, 340, 64, 364], T=String("Ben Example"), IRT=note, RT=Name.R, StateModel=String("Review"), State=String("Completed"), Name=Name.Comment, F=28))
hl = annot(dict(Type=Name.Annot, Subtype=Name.Highlight, Rect=[20, 100, 120, 120], QuadPoints=[20, 120, 120, 120, 20, 100, 120, 100], C=[1, 1, 0], Contents=String("On a highlight"), T=String("Ana Example"), F=4, StructParent=5, Custom=String("keep me")))
caret = annot(dict(Type=Name.Annot, Subtype=Name.Caret, Rect=[200, 200, 220, 220], Contents=String("unknown kind")))
broken = annot(dict(Type=Name.Annot, Subtype=Name.Square))  # no Rect
broken2 = annot(dict(Type=Name.Annot, Subtype=Name.Ink, Rect=[0, 0, 10, 10], InkList=String("nope")))
widget = annot(dict(Type=Name.Annot, Subtype=Name.Widget, Rect=[10, 10, 80, 30], FT=Name.Tx, T=String("field")))
link = annot(dict(Type=Name.Annot, Subtype=Name.Link, Rect=[10, 50, 90, 70], Border=[0, 0, 0], A=Dictionary(S=Name.URI, URI=String("https://example.com/b"))))
page.Annots = Array([note, popup, reply1, reply2, state, hl, caret, broken, broken2, widget, link])
pdf.save(os.path.join(out, "annots-reply.pdf"))
print("ok")
