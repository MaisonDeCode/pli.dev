"""
Checks the annotations of a PDF with three independent readers, for the Pli.PDF annotation tests (a developer tool, not
shipped). Prints JSON: qpdf's problems, what pypdf and MuPDF list as annotations, and the colours MuPDF paints at some
points. Usage: python annotcheck.py file.pdf '[[x, y], ...]' (points in PDF points from the top left of page 1).
Needs pikepdf, pypdf and pymupdf (pymupdf is AGPL: used only to look at files).
"""
import json, sys, warnings

warnings.filterwarnings("ignore")
path = sys.argv[1]
probes = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
out = {}
try:
    import pikepdf

    with pikepdf.open(path) as pdf:
        out["qpdf"] = [str(p) for p in (pdf.check() if hasattr(pdf, "check") else pdf.check_pdf_syntax())]
        out["pages"] = len(pdf.pages)
except Exception as e:  # noqa
    out["qpdf"] = ["error: " + str(e)]
try:
    import pypdf

    r = pypdf.PdfReader(path, strict=False)
    out["pypdf"] = [
        {"subtype": str(a.get_object().get("/Subtype")), "contents": str(a.get_object().get("/Contents", "")), "rect": [float(x) for x in a.get_object().get("/Rect", [])]}
        for a in (r.pages[0].get("/Annots", []) or [])
    ]
except Exception as e:  # noqa
    out["pypdf"] = {"error": str(e)}
try:
    import pymupdf

    doc = pymupdf.open(path)
    page = doc[0]
    out["mupdf"] = [
        {"type": a.type[1], "rect": list(a.rect), "content": a.info.get("content", ""), "title": a.info.get("title", ""), "vertices": [list(v) for v in (a.vertices or [])]}
        for a in (page.annots() or [])
    ]
    out["mupdf_links"] = [{"uri": l.get("uri"), "page": l.get("page"), "kind": l.get("kind"), "from": list(l["from"])} for l in page.get_links()]
    pix = page.get_pixmap(dpi=72)
    out["pixels"] = [list(pix.pixel(int(x), int(y)))[:3] for x, y in probes]
except Exception as e:  # noqa
    out["mupdf"] = {"error": str(e)}
print(json.dumps(out))
