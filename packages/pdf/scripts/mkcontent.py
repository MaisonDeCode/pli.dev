"""
Makes a PDF with MuPDF for the content tests: standard fonts, an embedded TrueType font (a path given as argv[2]), a turned
page, a crop box and a picture. `python mkcontent.py out.pdf font.ttf`. Text is made up; nothing in it is personal.
"""
import sys, warnings

warnings.filterwarnings("ignore")
import pymupdf

out, ttf = sys.argv[1], sys.argv[2]
doc = pymupdf.open()
page = doc.new_page(width=400, height=300)
page.insert_text((30, 50), "Invoice 20481 for ACME Widgets", fontname="helv", fontsize=14)
page.insert_text((30, 80), "Shipping to the warehouse at Dock 7", fontname="tiro", fontsize=11)
page.insert_text((30, 105), "Reference code: ZX-9917-QQ", fontname="cour", fontsize=10)
page.insert_font(fontname="lora", fontfile=ttf)
page.insert_text((30, 140), "Café sécurité and the SECRETWORD inside", fontname="lora", fontsize=13)
page.insert_font(fontname="loracid", fontfile=ttf, set_simple=False)
page.insert_text((30, 258), "Wide codes: CIDSECRET and r\u00e9sum\u00e9", fontname="loracid", fontsize=12)
page.insert_textbox(pymupdf.Rect(30, 160, 250, 230), "A paragraph of wrapped text that goes over several lines so that the reading order and the line breaks can be compared with other readers.", fontname="helv", fontsize=10)
pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 20, 20), False)
pix.set_rect(pix.irect, (200, 30, 30))
page.insert_image(pymupdf.Rect(280, 40, 360, 120), pixmap=pix)

page2 = doc.new_page(width=400, height=300)
page2.insert_text((40, 60), "Turned page text one", fontname="helv", fontsize=12)
page2.insert_text((40, 90), "Turned page text SECRETWORD two", fontname="tiro", fontsize=12)
page2.set_cropbox(pymupdf.Rect(20, 20, 380, 280))
page2.set_rotation(90)
doc.save(out)
