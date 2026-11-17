"""
Checks a PDF with three independent readers and prints what they see as JSON. A developer tool for the Pli.PDF tests:
nothing in the repo depends on it. Needs `pip install pikepdf pypdf pymupdf` (pymupdf is AGPL: used here only to look at
files, never shipped). Usage: python pdfcheck.py file.pdf [--render out_dir] [--password pw]
"""
import json, sys, warnings

warnings.filterwarnings("ignore")


def main():
    path = sys.argv[1]
    render = sys.argv[sys.argv.index("--render") + 1] if "--render" in sys.argv else None
    password = sys.argv[sys.argv.index("--password") + 1] if "--password" in sys.argv else ""
    out = {"file": path}
    try:
        import pikepdf

        with pikepdf.open(path, password=password) as pdf:
            problems = [str(p) for p in (pdf.check() if hasattr(pdf, "check") else pdf.check_pdf_syntax())]
            out["qpdf"] = {"problems": problems, "pages": len(pdf.pages), "encrypted": pdf.is_encrypted, "version": str(pdf.pdf_version)}
    except Exception as e:  # noqa
        out["qpdf"] = {"error": str(e)}
    try:
        import pypdf

        r = pypdf.PdfReader(path, strict=False)
        if r.is_encrypted:
            r.decrypt(password)
        pages = []
        for p in r.pages:
            annots = []
            for a in p.get("/Annots", []) or []:
                a = a.get_object()
                annots.append({"subtype": str(a.get("/Subtype")), "contents": str(a.get("/Contents", "")), "rect": [float(x) for x in a.get("/Rect", [])], "has_ap": "/AP" in a})
            pages.append({"rotate": int(p.get("/Rotate", 0) or 0), "box": [float(x) for x in p.mediabox], "text": p.extract_text(), "annots": annots})
        fields = {k: (str(v.get("/V")) if v.get("/V") is not None else None) for k, v in (r.get_fields() or {}).items()}
        out["pypdf"] = {"pages": pages, "fields": fields, "outline": _outline(r, r.outline)}
    except Exception as e:  # noqa
        out["pypdf"] = {"error": str(e)}
    try:
        import pymupdf

        doc = pymupdf.open(path)
        if doc.needs_pass:
            doc.authenticate(password)
        info = {"pages": doc.page_count, "annots": [], "widgets": [], "text": []}
        for i, page in enumerate(doc):
            for a in page.annots() or []:
                info["annots"].append({"page": i, "type": a.type[1], "rect": list(a.rect), "content": a.info.get("content", "")})
            for w in page.widgets() or []:
                info["widgets"].append({"page": i, "name": w.field_name, "type": w.field_type_string, "value": w.field_value})
            info["text"].append(page.get_text())
            if render:
                import os

                os.makedirs(render, exist_ok=True)
                page.get_pixmap(dpi=72).save(os.path.join(render, f"page-{i + 1}.png"))
        out["mupdf"] = info
    except Exception as e:  # noqa
        out["mupdf"] = {"error": str(e)}
    print(json.dumps(out, indent=1, default=str))


def _outline(reader, items):
    res = []
    for it in items:
        if isinstance(it, list):
            res.append(_outline(reader, it))
        else:
            try:
                res.append({"title": it.title, "page": reader.get_destination_page_number(it)})
            except Exception:  # noqa
                res.append({"title": getattr(it, "title", "?")})
    return res


main()
