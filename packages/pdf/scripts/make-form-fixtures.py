"""Makes test/fixtures/forms-basic.pdf (PyMuPDF) and forms-acro.pdf (pikepdf). Needs `pip install pymupdf pikepdf`. Run from anywhere."""
import os
import pymupdf, pikepdf
from pikepdf import Name, Dictionary, Array, String, Pdf
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures") + os.sep

# --- 1. every widget type, made with pymupdf
doc = pymupdf.open()
page = doc.new_page(width=300, height=400)
page.insert_text((20, 30), "Sample form", fontsize=14)
def W(t, name, rect, **kw):
    w = pymupdf.Widget()
    w.field_type = t
    w.field_name = name
    w.rect = pymupdf.Rect(*rect)
    for k, v in kw.items():
        setattr(w, k, v)
    page.add_widget(w)
page.insert_text((20, 62), "Name", fontsize=9)
W(pymupdf.PDF_WIDGET_TYPE_TEXT, "name", (80, 50, 280, 70), field_value="Sample Name", fontsize=11, text_fontsize=11, border_color=(0,0,0), border_width=1)
page.insert_text((20, 92), "Notes", fontsize=9)
W(pymupdf.PDF_WIDGET_TYPE_TEXT, "notes", (80, 80, 280, 130), field_flags=pymupdf.PDF_TX_FIELD_IS_MULTILINE, field_value="", text_fontsize=10, border_color=(0,0,0), border_width=1)
page.insert_text((20, 152), "Agree", fontsize=9)
W(pymupdf.PDF_WIDGET_TYPE_CHECKBOX, "agree", (80, 142, 94, 156), field_value="Off", border_color=(0,0,0), border_width=1)
page.insert_text((20, 182), "Size", fontsize=9)
W(pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON, "size", (80, 172, 94, 186), field_value="Off", border_color=(0,0,0), border_width=1)
W(pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON, "size", (110, 172, 124, 186), field_value="Off", border_color=(0,0,0), border_width=1)
page.insert_text((20, 212), "Colour", fontsize=9)
W(pymupdf.PDF_WIDGET_TYPE_COMBOBOX, "colour", (80, 200, 200, 220), field_value="Red", choice_values=["Red","Green","Blue"], text_fontsize=11, border_color=(0,0,0), border_width=1)
page.insert_text((20, 252), "Fruit", fontsize=9)
W(pymupdf.PDF_WIDGET_TYPE_LISTBOX, "fruit", (80, 235, 200, 285), field_value="Plum", choice_values=["Apple","Plum","Pear","Fig"], text_fontsize=11, border_color=(0,0,0), border_width=1)
page.insert_text((20, 312), "Signature", fontsize=9)
W(pymupdf.PDF_WIDGET_TYPE_SIGNATURE, "sig", (80, 300, 200, 330), border_color=(0,0,0), border_width=1)
W(pymupdf.PDF_WIDGET_TYPE_BUTTON, "send", (80, 350, 160, 372), field_label="Send", button_caption="Send", fill_color=(0.85,0.85,0.85), border_color=(0,0,0), border_width=1, text_fontsize=11)
doc.save(OUT + "forms-basic.pdf", garbage=0, deflate=False)

# --- 2. a hand built, Acrobat-style form: hierarchy, inherited keys, NeedAppearances, widgets outside /Fields
pdf = Pdf.new()
pdf.add_blank_page(page_size=(300, 300))
page = pdf.pages[0]
helv = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name.WinAnsiEncoding))
zadb = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.ZapfDingbats))
def widget(rect, **kw):
    d = Dictionary(Type=Name.Annot, Subtype=Name.Widget, Rect=Array(rect), P=page.obj, F=4)
    for k, v in kw.items():
        d["/" + k] = v
    return pdf.make_indirect(d)
def stream(content, bbox):
    s = pikepdf.Stream(pdf, content.encode("latin-1"))
    s["/Type"] = Name.XObject; s["/Subtype"] = Name.Form; s["/BBox"] = Array(bbox)
    return pdf.make_indirect(s)
person = pdf.make_indirect(Dictionary(T=String("person"), FT=Name.Tx, DA=String("/Helv 11 Tf 0 g"), Kids=Array()))
n1 = widget([20, 250, 200, 270], T=String("first"), Parent=person, V=String("Ada"), MK=Dictionary(BC=Array([0,0,0]), BG=Array([1,1,0.9])), TU=String("First name"))
n2 = widget([20, 220, 200, 240], T=String("last"), Parent=person, MaxLen=8, Q=1)
person.Kids = Array([n1, n2])
chk = widget([20, 190, 34, 204], T=String("newsletter"), FT=Name.Btn, V=Name.Yes, AS=Name.Yes,
             AP=Dictionary(N=Dictionary(Yes=stream("0 0 1 rg 2 2 10 10 re f", [0,0,14,14]), Off=stream("", [0,0,14,14]))))
grp = pdf.make_indirect(Dictionary(T=String("level"), FT=Name.Btn, Ff=32768, V=Name.B, Kids=Array()))
ra = widget([20, 160, 34, 174], Parent=grp, AS=Name.Off, AP=Dictionary(N=Dictionary(A=stream("", [0,0,14,14]), Off=stream("", [0,0,14,14]))))
rb = widget([60, 160, 74, 174], Parent=grp, AS=Name.B, AP=Dictionary(N=Dictionary(B=stream("0 g 3 3 8 8 re f", [0,0,14,14]), Off=stream("", [0,0,14,14]))))
grp.Kids = Array([ra, rb])
combo = widget([20, 120, 140, 140], T=String("country"), FT=Name.Ch, Ff=131072, V=String("fr"), Opt=Array([Array([String("de"), String("Germany")]), Array([String("fr"), String("France")])]), DA=String("/Helv 0 Tf 0 g"))
# a text field that is only on the page (not in /Fields)
stray = widget([20, 80, 140, 100], T=String("stray"), FT=Name.Tx, V=String("not listed"), DA=String("/Helv 10 Tf 0 g"))
page.Annots = Array([n1, n2, chk, ra, rb, combo, stray])
pdf.Root.AcroForm = Dictionary(Fields=Array([person, chk, grp, combo]), DA=String("/Helv 0 Tf 0 g"), NeedAppearances=True,
    DR=Dictionary(Font=Dictionary(Helv=helv, ZaDb=zadb)))
pdf.save(OUT + "forms-acro.pdf", static_id=True)
print("ok")
