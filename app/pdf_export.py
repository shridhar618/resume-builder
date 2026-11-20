"""Server-side PDF rendering with ReportLab (pure Python — no browser or wkhtmltopdf needed).

Each template is a small function that turns normalised resume data into Platypus
flowables. Output is real text (selectable, ATS-parsable), not an image.
"""
import io
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

PAGE_W, PAGE_H = A4

# Characters outside the standard PDF fonts' WinAnsi set would render as boxes.
_REPLACE = {"→": "->", "←": "<-", "₹": "Rs.", "✓": "-", "•": "•"}


def esc(text: str) -> str:
    text = "".join(_REPLACE.get(ch, ch) for ch in (text or ""))
    return escape(text)


def _href(url: str) -> str:
    url = url.strip()
    if url.startswith(("http://", "https://", "mailto:")):
        return url
    if "@" in url and " " not in url:
        return "mailto:" + url
    return "https://" + url


def _link(text: str, color: str | None = None) -> str:
    c = f' color="{color}"' if color else ""
    return f'<a href="{escape(_href(text), {chr(34): "&quot;"})}"{c}>{esc(text)}</a>'


def _dates(item) -> str:
    s, e = item.get("start", ""), item.get("end", "")
    if s and e:
        return f"{esc(s)} – {esc(e)}"
    return esc(s or e)


def _contact_bits(p: dict, link_color=None) -> list[str]:
    bits = []
    for f in ("email", "phone", "location", "website", "linkedin", "github"):
        v = p.get(f, "")
        if not v:
            continue
        bits.append(_link(v, link_color) if f in ("email", "website", "linkedin", "github") else esc(v))
    return bits


def _bullets(items, style) -> list:
    return [Paragraph(esc(b), style, bulletText="•") for b in items]


SECTION_TITLES = {
    "summary": "Summary", "experience": "Experience", "projects": "Projects", "education": "Education",
    "skills": "Skills", "certifications": "Certifications", "achievements": "Achievements",
}
SECTION_ORDER = ["summary", "experience", "projects", "education", "skills", "certifications", "achievements"]


# ============================================================================ shared body builder
def _build_body(d: dict, S: dict, heading, entry_header, avail_w) -> list:
    """Generic section loop; templates differ via styles + heading/entry_header callbacks."""
    story = []
    for sec in SECTION_ORDER:
        if sec == "summary":
            if not d.get("summary"):
                continue
            story += heading(SECTION_TITLES[sec])
            story.append(Paragraph(esc(d["summary"]), S["body"]))
            continue
        items = d.get(sec) or []
        if not items:
            continue
        block = heading(SECTION_TITLES[sec])
        first = True
        for it in items:
            parts = []
            if sec == "experience":
                parts += entry_header(it.get("role", ""), ", ".join(x for x in (it.get("company"), it.get("location")) if x), _dates(it))
                parts += _bullets(it.get("bullets", []), S["bullet"])
            elif sec == "projects":
                title = esc(it.get("name", ""))
                sub = esc(it.get("tech", ""))
                if it.get("link"):
                    sub = (sub + " · " if sub else "") + _link(it["link"], S.get("link_color"))
                parts += entry_header(title, sub, "", raw=True)
                parts += _bullets(it.get("bullets", []), S["bullet"])
            elif sec == "education":
                sub = ", ".join(x for x in (it.get("school"), it.get("location")) if x)
                if it.get("score"):
                    sub = (sub + " · " if sub else "") + it["score"]
                parts += entry_header(it.get("degree", ""), sub, _dates(it))
            elif sec == "skills":
                cat = esc(it.get("category", ""))
                txt = esc(", ".join(it.get("items", [])))
                parts.append(Paragraph(f"<b>{cat}:</b> {txt}" if cat else txt, S["body"]))
            elif sec == "certifications":
                line = f"<b>{esc(it.get('name', ''))}</b>"
                extra = " · ".join(esc(x) for x in (it.get("issuer"), it.get("date")) if x)
                parts.append(Paragraph(line + (f" — {extra}" if extra else ""), S["body"]))
            elif sec == "achievements":
                parts += _bullets([it], S["bullet"])
            parts.append(Spacer(1, S.get("entry_gap", 4)))
            if first:  # keep heading with first entry so headings never orphan at a page bottom
                block += parts
                story.append(KeepTogether(block))
                first = False
            else:
                story.append(KeepTogether(parts))
    return story


def _two_col(left, right, avail_w, right_w=38 * mm):
    t = Table([[left, right]], colWidths=[avail_w - right_w, right_w])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


# ============================================================================ templates
def _modern(d: dict, doc) -> list:
    accent = colors.HexColor("#1f4e79")
    accent_hex = "#1f4e79"
    W = doc.width
    S = {
        "name": ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=colors.white),
        "headline": ParagraphStyle("hl", fontName="Helvetica", fontSize=11.5, leading=15, textColor=colors.HexColor("#d6e4f0")),
        "contact": ParagraphStyle("ct", fontName="Helvetica", fontSize=8.8, leading=12, textColor=colors.white),
        "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=accent, spaceBefore=8),
        "title": ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=10, leading=13),
        "sub": ParagraphStyle("s", fontName="Helvetica-Oblique", fontSize=9.2, leading=12, textColor=colors.HexColor("#444444")),
        "date": ParagraphStyle("d", fontName="Helvetica", fontSize=9, leading=13, alignment=TA_RIGHT, textColor=colors.HexColor("#555555")),
        "body": ParagraphStyle("b", fontName="Helvetica", fontSize=9.4, leading=12.6, spaceAfter=2),
        "bullet": ParagraphStyle("bl", fontName="Helvetica", fontSize=9.4, leading=12.4, leftIndent=11, bulletIndent=2),
        "link_color": accent_hex,
    }
    p = d["personal"]
    header_rows = [[Paragraph(esc(p.get("full_name") or "Your Name"), S["name"])]]
    if p.get("headline"):
        header_rows.append([Paragraph(esc(p["headline"]), S["headline"])])
    bits = _contact_bits(p, "#ffffff")
    if bits:
        header_rows.append([Paragraph("  |  ".join(bits), S["contact"])])
    header = Table(header_rows, colWidths=[W])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, 0), 12), ("BOTTOMPADDING", (0, -1), (-1, -1), 11),
        ("TOPPADDING", (0, 1), (-1, -1), 2),
    ]))

    def heading(t):
        return [Paragraph(t.upper(), S["h"]), HRFlowable(width="100%", thickness=1.2, color=accent, spaceBefore=1, spaceAfter=4)]

    def entry(title, sub, dates, raw=False):
        left = [Paragraph(title if raw else esc(title), S["title"])]
        if sub:
            left.append(Paragraph(sub if raw else esc(sub), S["sub"]))
        return [_two_col(left, Paragraph(dates, S["date"]), W), Spacer(1, 2)]

    return [header, Spacer(1, 4)] + _build_body(d, S, heading, entry, W)


def _classic(d: dict, doc) -> list:
    W = doc.width
    S = {
        "name": ParagraphStyle("name", fontName="Times-Bold", fontSize=22, leading=26, alignment=TA_CENTER),
        "headline": ParagraphStyle("hl", fontName="Times-Italic", fontSize=12, leading=15, alignment=TA_CENTER),
        "contact": ParagraphStyle("ct", fontName="Times-Roman", fontSize=10, leading=13, alignment=TA_CENTER),
        "h": ParagraphStyle("h", fontName="Times-Bold", fontSize=12, leading=15, spaceBefore=9),
        "title": ParagraphStyle("t", fontName="Times-Bold", fontSize=11, leading=13.5),
        "sub": ParagraphStyle("s", fontName="Times-Italic", fontSize=10.5, leading=13),
        "date": ParagraphStyle("d", fontName="Times-Roman", fontSize=10.5, leading=13.5, alignment=TA_RIGHT),
        "body": ParagraphStyle("b", fontName="Times-Roman", fontSize=10.6, leading=13.6, spaceAfter=2),
        "bullet": ParagraphStyle("bl", fontName="Times-Roman", fontSize=10.6, leading=13.4, leftIndent=12, bulletIndent=2),
        "link_color": None,
    }
    p = d["personal"]
    story = [Paragraph(esc(p.get("full_name") or "Your Name"), S["name"])]
    if p.get("headline"):
        story.append(Paragraph(esc(p["headline"]), S["headline"]))
    bits = _contact_bits(p)
    if bits:
        story.append(Paragraph(" · ".join(bits), S["contact"]))
    story.append(HRFlowable(width="100%", thickness=1.4, color=colors.black, spaceBefore=6, spaceAfter=0))

    def heading(t):
        return [Paragraph(t.upper(), S["h"]), HRFlowable(width="100%", thickness=0.5, color=colors.black, spaceBefore=1, spaceAfter=4)]

    def entry(title, sub, dates, raw=False):
        left = [Paragraph(title if raw else esc(title), S["title"])]
        if sub:
            left.append(Paragraph(sub if raw else esc(sub), S["sub"]))
        return [_two_col(left, Paragraph(dates, S["date"]), W), Spacer(1, 2)]

    return story + _build_body(d, S, heading, entry, W)


def _minimal(d: dict, doc) -> list:
    W = doc.width
    grey = colors.HexColor("#6b7280")
    rail = 38 * mm
    S = {
        "name": ParagraphStyle("name", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=colors.HexColor("#111827")),
        "headline": ParagraphStyle("hl", fontName="Helvetica", fontSize=11, leading=14, textColor=grey),
        "contact": ParagraphStyle("ct", fontName="Helvetica", fontSize=8.8, leading=12, textColor=colors.HexColor("#374151")),
        "h": ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=grey, spaceBefore=10, spaceAfter=4),
        "title": ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=9.8, leading=12.5, textColor=colors.HexColor("#111827")),
        "sub": ParagraphStyle("s", fontName="Helvetica", fontSize=9.2, leading=12, textColor=grey),
        "date": ParagraphStyle("d", fontName="Helvetica", fontSize=8.6, leading=12.5, textColor=grey),
        "body": ParagraphStyle("b", fontName="Helvetica", fontSize=9.3, leading=12.6, spaceAfter=2, textColor=colors.HexColor("#1f2937")),
        "bullet": ParagraphStyle("bl", fontName="Helvetica", fontSize=9.3, leading=12.4, leftIndent=10, bulletIndent=1, textColor=colors.HexColor("#1f2937")),
        "link_color": "#2563eb",
        "entry_gap": 5,
    }
    p = d["personal"]
    story = [Paragraph(esc(p.get("full_name") or "Your Name"), S["name"])]
    if p.get("headline"):
        story.append(Paragraph(esc(p["headline"]), S["headline"]))
    bits = _contact_bits(p, "#374151")
    if bits:
        story += [Spacer(1, 3), Paragraph("  \u00b7  ".join(bits), S["contact"])]
    story.append(Spacer(1, 2))

    def heading(t):
        return [Paragraph(t.upper(), S["h"])]

    def entry(title, sub, dates, raw=False):
        right = [Paragraph(title if raw else esc(title), S["title"])]
        if sub:
            right.append(Paragraph(sub if raw else esc(sub), S["sub"]))
        t = Table([[Paragraph(dates, S["date"]), right]], colWidths=[rail, W - rail])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
        return [t]

    # Indent bullets/body under the rail so text lines up with entry titles.
    S["bullet"].leftIndent += rail
    S["bullet"].bulletIndent += rail
    S["body"].leftIndent += rail
    return story + _build_body(d, S, heading, entry, W)


RENDERERS = {"modern": _modern, "classic": _classic, "minimal": _minimal}
MARGINS = {"modern": 14 * mm, "classic": 18 * mm, "minimal": 16 * mm}


def render_pdf(data: dict, template: str = "modern", title: str = "Resume") -> bytes:
    template = template if template in RENDERERS else "modern"
    buf = io.BytesIO()
    m = MARGINS[template]
    name = data.get("personal", {}).get("full_name") or ""
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=m, rightMargin=m, topMargin=m, bottomMargin=m,
        title=f"{name} – Resume" if name else title, author=name or "Resume Builder",
        subject=data.get("target_role") or "Resume", creator="AI Resume Builder",
    )
    doc.build(RENDERERS[template](data, doc))
    return buf.getvalue()
