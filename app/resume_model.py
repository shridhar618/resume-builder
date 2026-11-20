"""Resume data shape, validation/normalisation, and the template registry.

Resume data is stored as one JSON document per resume. Everything coming from the
client goes through `normalize()` so the DB only ever holds known keys, strings of
bounded length, and bounded list sizes.
"""
import copy

TEMPLATES = {
    "modern": {"name": "Modern", "description": "Two-tone header with an accent colour. Good for tech roles."},
    "classic": {"name": "Classic", "description": "Serif, centred header, traditional single column."},
    "minimal": {"name": "Minimal", "description": "Clean sans-serif with a left date rail. ATS friendly."},
}
DEFAULT_TEMPLATE = "modern"

PERSONAL_FIELDS = ["full_name", "headline", "email", "phone", "location", "website", "linkedin", "github"]

SECTION_SCHEMAS = {
    "experience": ["role", "company", "location", "start", "end"],
    "education": ["degree", "school", "location", "start", "end", "score"],
    "projects": ["name", "tech", "link"],
    "certifications": ["name", "issuer", "date"],
}
SECTIONS_WITH_BULLETS = {"experience", "projects"}

MAX_STR = 300
MAX_TEXT = 2000
MAX_ITEMS = 20
MAX_BULLETS = 10


def empty_resume() -> dict:
    return {
        "personal": {f: "" for f in PERSONAL_FIELDS},
        "target_role": "",
        "summary": "",
        "experience": [],
        "education": [],
        "projects": [],
        "skills": [],
        "certifications": [],
        "achievements": [],
    }


def from_profile(profile) -> dict:
    data = empty_resume()
    if profile is not None:
        for f in PERSONAL_FIELDS:
            data["personal"][f] = profile[f] or ""
        data["summary"] = profile["summary"] or ""
        data["target_role"] = profile["target_role"] or ""
    return data


def _s(v, limit=MAX_STR) -> str:
    if v is None:
        return ""
    return str(v).strip()[:limit]


def _str_list(v, limit=MAX_BULLETS, size=MAX_STR) -> list[str]:
    if not isinstance(v, list):
        return []
    out = [_s(x, size) for x in v[:limit]]
    return [x for x in out if x]


def normalize(raw) -> dict:
    if not isinstance(raw, dict):
        raw = {}
    data = empty_resume()
    personal = raw.get("personal") if isinstance(raw.get("personal"), dict) else {}
    for f in PERSONAL_FIELDS:
        data["personal"][f] = _s(personal.get(f))
    data["target_role"] = _s(raw.get("target_role"), 120)
    data["summary"] = _s(raw.get("summary"), MAX_TEXT)

    for section, fields in SECTION_SCHEMAS.items():
        items = raw.get(section) if isinstance(raw.get(section), list) else []
        clean = []
        for item in items[:MAX_ITEMS]:
            if not isinstance(item, dict):
                continue
            entry = {f: _s(item.get(f)) for f in fields}
            if section in SECTIONS_WITH_BULLETS:
                entry["bullets"] = _str_list(item.get("bullets"))
            if any(entry.values()):
                clean.append(entry)
        data[section] = clean

    skills = raw.get("skills") if isinstance(raw.get("skills"), list) else []
    for grp in skills[:MAX_ITEMS]:
        if isinstance(grp, dict):
            entry = {"category": _s(grp.get("category"), 60), "items": _str_list(grp.get("items"), 40, 60)}
            if entry["category"] or entry["items"]:
                data["skills"].append(entry)

    data["achievements"] = _str_list(raw.get("achievements"), MAX_ITEMS)
    return data


def has_content(data: dict, section: str) -> bool:
    v = data.get(section)
    return bool(v)


SAMPLE = {
    "personal": {
        "full_name": "Aarav Sharma",
        "headline": "Backend & Data Engineer",
        "email": "aarav.sharma@example.com",
        "phone": "+91 98765 43210",
        "location": "Bengaluru, India",
        "website": "aarav.dev",
        "linkedin": "linkedin.com/in/aaravsharma",
        "github": "github.com/aaravsharma",
    },
    "target_role": "Backend Engineer",
    "summary": "Backend engineer who builds reliable data services in Python and PostgreSQL. "
    "Shipped APIs serving 50k daily users and cut report latency by 70% through query and caching work.",
    "experience": [
        {
            "role": "Software Engineering Intern",
            "company": "FinEdge Labs",
            "location": "Bengaluru",
            "start": "Jan 2026",
            "end": "Jun 2026",
            "bullets": [
                "Built a FastAPI service for transaction reconciliation handling 2M records/day",
                "Reduced p95 API latency from 820 ms to 240 ms with Redis caching and query tuning",
                "Wrote CI pipelines in GitHub Actions, raising test coverage from 41% to 78%",
            ],
        }
    ],
    "education": [
        {"degree": "Master of Computer Applications", "school": "PES University", "location": "Bengaluru",
         "start": "2025", "end": "2027", "score": "CGPA 8.9"},
    ],
    "projects": [
        {"name": "Multi-tenant Sales Analytics", "tech": "PostgreSQL, Python, React", "link": "github.com/aaravsharma/analytics",
         "bullets": ["Designed row-level-security schema isolating 30+ tenants", "Incremental materialised views refresh dashboards in under 2 s"]},
    ],
    "skills": [
        {"category": "Languages", "items": ["Python", "SQL", "Java", "TypeScript"]},
        {"category": "Backend", "items": ["FastAPI", "Flask", "PostgreSQL", "Redis", "Docker"]},
        {"category": "Data / ML", "items": ["Pandas", "PyTorch", "scikit-learn"]},
    ],
    "certifications": [{"name": "AWS Cloud Practitioner", "issuer": "Amazon Web Services", "date": "2026"}],
    "achievements": ["Finalist, national fintech hackathon (top 10 of 600 teams)"],
}


def sample_resume() -> dict:
    return copy.deepcopy(SAMPLE)
