"""
Prints the words MuPDF finds on each page, as JSON. MuPDF reports text boxes in unrotated page space (y down, origin at
the top left of the crop box), which is the page space Pli.PDF uses. A developer tool for the content tests: `python pdftext.py file.pdf`. Needs pymupdf.
"""
import json, sys, warnings

warnings.filterwarnings("ignore")
import pymupdf

doc = pymupdf.open(sys.argv[1])
pages = []
for page in doc:
    words = []
    for w in page.get_text("words"):
        r = pymupdf.Rect(w[:4])
        words.append({"text": w[4], "x0": r.x0, "y0": r.y0, "x1": r.x1, "y1": r.y1})
    pages.append({"rotation": page.rotation, "text": page.get_text(), "words": words, "images": len(page.get_images())})
print(json.dumps({"pages": pages}))
