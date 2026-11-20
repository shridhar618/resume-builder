"""AI content suggestions.

Providers are called over plain REST with `requests`, so no vendor SDK is needed:
  - gemini    (GEMINI_API_KEY)     — has a free tier, easiest for students
  - openai    (OPENAI_API_KEY)
  - anthropic (ANTHROPIC_API_KEY)
  - offline   rule-based fallback, used automatically when no key is configured
                or when the remote call fails, so the app always works in a demo.

Every suggestion kind returns {"suggestions": [str, ...], "provider": str}.
"""
import json
import re
from collections import Counter

import requests
from flask import Blueprint, current_app, g, jsonify, request

from .security import limiter, login_required

bp = Blueprint("ai", __name__, url_prefix="/api/ai")

KINDS = {"summary", "bullets", "skills", "keywords"}

SYSTEM_PROMPT = (
    "You are an expert resume writer and technical recruiter. You write concise, specific, "
    "ATS-friendly resume content. Never invent employers, degrees, dates or numbers that were not "
    "given; where a metric would help but is unknown, use a clear placeholder like [X%]. "
    "Always reply with ONLY a JSON object of the form {\"suggestions\": [\"...\", ...]} and no other text."
)


# =========================================================================== prompts
def _resume_digest(d: dict) -> str:
    """Compact plain-text view of the resume for prompts."""
    parts = []
    p = d.get("personal", {})
    if p.get("headline"):
        parts.append(f"Headline: {p['headline']}")
    if d.get("target_role"):
        parts.append(f"Target role: {d['target_role']}")
    if d.get("summary"):
        parts.append(f"Current summary: {d['summary']}")
    for e in d.get("experience", [])[:6]:
        parts.append(f"Experience: {e.get('role')} at {e.get('company')} ({e.get('start')}–{e.get('end')}): "
                     + "; ".join(e.get("bullets", [])))
    for pr in d.get("projects", [])[:6]:
        parts.append(f"Project: {pr.get('name')} [{pr.get('tech')}]: " + "; ".join(pr.get("bullets", [])))
    for ed in d.get("education", [])[:3]:
        parts.append(f"Education: {ed.get('degree')}, {ed.get('school')} {ed.get('end')}")
    skills = [s for grp in d.get("skills", []) for s in grp.get("items", [])]
    if skills:
        parts.append("Skills: " + ", ".join(skills[:60]))
    return "\n".join(parts)[:6000]


def build_prompt(kind: str, ctx: dict) -> str:
    resume = ctx.get("resume", {})
    role = (ctx.get("target_role") or resume.get("target_role") or "").strip()
    digest = _resume_digest(resume)
    if kind == "summary":
        return (f"Write 3 alternative professional summaries (2–3 sentences, under 60 words each) for this "
                f"candidate{' targeting a ' + role + ' role' if role else ''}. Lead with the strongest evidence. "
                f"No first-person pronouns, no clichés like 'hard-working' or 'team player'.\n\n{digest}")
    if kind == "bullets":
        item = ctx.get("item", {})
        bullets = "\n".join(f"- {b}" for b in item.get("bullets", []) if b) or "(no bullets yet)"
        heading = item.get("role") or item.get("name") or "this entry"
        org = item.get("company") or item.get("tech") or ""
        return (f"Rewrite these resume bullet points for '{heading}' {('(' + org + ')') if org else ''}"
                f"{' for a ' + role + ' application' if role else ''}. Return one improved bullet per original "
                f"(or 3 new ones if none were given). Each bullet: start with a strong past-tense action verb, "
                f"show impact, under 25 words, no trailing period.\n\nOriginal bullets:\n{bullets}\n\n"
                f"Context from the rest of the resume:\n{digest}")
    if kind == "skills":
        return (f"Suggest 12 specific skills (tools, languages, frameworks, concepts) that a "
                f"{role or 'software engineering'} candidate should list and that fit this background. "
                f"Exclude skills already listed. Each suggestion is a short skill name only.\n\n{digest}")
    if kind == "keywords":
        jd = (ctx.get("job_description") or "")[:6000]
        return (f"Compare this resume to the job description. Return up to 10 short, concrete, actionable "
                f"suggestions to tailor the resume (missing keywords to add where truthful, bullets to "
                f"reframe, sections to reorder).\n\nJOB DESCRIPTION:\n{jd}\n\nRESUME:\n{digest}")
    raise ValueError(kind)


# =========================================================================== providers
class AIError(Exception):
    pass


def _post(url, headers, body):
    timeout = current_app.config["AI_TIMEOUT"]
    try:
        r = requests.post(url, headers=headers, json=body, timeout=timeout)
    except requests.RequestException as exc:
        raise AIError(f"Network error contacting AI provider: {exc.__class__.__name__}") from exc
    if r.status_code >= 400:
        raise AIError(f"AI provider returned HTTP {r.status_code}")
    return r.json()


def call_gemini(prompt: str) -> str:
    cfg = current_app.config
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['GEMINI_MODEL']}:generateContent"
    data = _post(url, {"x-goog-api-key": cfg["GEMINI_API_KEY"], "Content-Type": "application/json"}, {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.7, "responseMimeType": "application/json"},
    })
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as exc:
        raise AIError("Unexpected Gemini response") from exc


def call_openai(prompt: str) -> str:
    cfg = current_app.config
    data = _post("https://api.openai.com/v1/chat/completions",
                 {"Authorization": f"Bearer {cfg['OPENAI_API_KEY']}", "Content-Type": "application/json"}, {
                     "model": cfg["OPENAI_MODEL"],  # no temperature: newer reasoning models reject it
                     "response_format": {"type": "json_object"},
                     "messages": [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": prompt}],
                 })
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as exc:
        raise AIError("Unexpected OpenAI response") from exc


def call_anthropic(prompt: str) -> str:
    cfg = current_app.config
    data = _post("https://api.anthropic.com/v1/messages", {
        "x-api-key": cfg["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01", "content-type": "application/json",
    }, {
        "model": cfg["ANTHROPIC_MODEL"],
        "max_tokens": 1024,
        "system": SYSTEM_PROMPT,
        "messages": [{"role": "user", "content": prompt}],
    })
    try:
        return "".join(b.get("text", "") for b in data["content"] if b.get("type") == "text")
    except (KeyError, TypeError) as exc:
        raise AIError("Unexpected Anthropic response") from exc


PROVIDERS = {"gemini": (call_gemini, "GEMINI_API_KEY"),
             "openai": (call_openai, "OPENAI_API_KEY"),
             "anthropic": (call_anthropic, "ANTHROPIC_API_KEY")}


def active_provider() -> str:
    cfg = current_app.config
    chosen = cfg.get("AI_PROVIDER")
    if chosen == "offline":
        return "offline"
    if chosen in PROVIDERS and cfg.get(PROVIDERS[chosen][1]):
        return chosen
    for name, (_, key) in PROVIDERS.items():  # auto-detect the first configured key
        if cfg.get(key):
            return name
    return "offline"


def parse_suggestions(text: str) -> list[str]:
    """Models occasionally wrap JSON in prose or code fences; be forgiving."""
    text = text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            obj = json.loads(m.group(0))
            items = obj.get("suggestions", [])
            if isinstance(items, list):
                out = [str(x).strip() for x in items if str(x).strip()]
                if out:
                    return out[:12]
        except json.JSONDecodeError:
            pass
    lines = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", ln).strip() for ln in text.splitlines()]
    return [ln for ln in lines if ln][:12]


# =========================================================================== offline engine
WEAK_OPENERS = {
    r"^(was )?responsible for (managing )?": "Led ",
    r"^worked on ": "Developed ",
    r"^worked with ": "Collaborated with ",
    r"^helped (to )?": "Contributed to ",
    r"^assisted (in|with) ": "Supported ",
    r"^did ": "Delivered ",
    r"^made ": "Built ",
    r"^involved in ": "Contributed to ",
    r"^participated in ": "Took part in ",
    r"^handled ": "Managed ",
    r"^used ": "Applied ",
    r"^tasked with ": "Owned ",
    r"^i ": "",
}
ROLE_SKILLS = {
    "backend": ["REST API design", "PostgreSQL", "Redis", "Docker", "Kubernetes", "FastAPI", "Spring Boot",
                "Message queues (Kafka/RabbitMQ)", "Unit & integration testing", "CI/CD", "System design", "AWS"],
    "frontend": ["React", "TypeScript", "Next.js", "CSS/Tailwind", "Accessibility (WCAG)", "State management",
                 "Jest / React Testing Library", "Web performance", "REST/GraphQL", "Figma handoff", "Vite", "Git"],
    "data engineer": ["SQL", "Apache Spark", "Airflow", "dbt", "Kafka", "Data modelling", "PostgreSQL",
                      "Snowflake / BigQuery", "ETL/ELT pipelines", "Python", "Docker", "Data quality testing"],
    "data scien": ["Python", "Pandas", "scikit-learn", "Statistics", "A/B testing", "SQL", "Feature engineering",
                   "XGBoost", "Data visualisation", "Jupyter", "Model evaluation", "PyTorch"],
    "machine learning": ["PyTorch", "TensorFlow", "scikit-learn", "Transformers / Hugging Face", "MLOps",
                         "Model deployment (FastAPI/Docker)", "Experiment tracking (MLflow)", "Feature engineering",
                         "LLM fine-tuning", "RAG", "Vector databases", "CUDA basics"],
    "ai": ["LLM APIs", "Prompt engineering", "RAG", "LangChain / LlamaIndex", "Vector databases", "PyTorch",
           "Hugging Face", "Evaluation of LLM outputs", "Python", "FastAPI", "Docker", "Embeddings"],
    "devops": ["Linux", "Docker", "Kubernetes", "Terraform", "AWS", "CI/CD (GitHub Actions)", "Prometheus",
               "Grafana", "Bash", "Networking basics", "Helm", "Incident response"],
    "full stack": ["React", "Node.js", "TypeScript", "PostgreSQL", "REST APIs", "Docker", "Authentication (JWT/OAuth)",
                   "Next.js", "Testing", "CI/CD", "Redis", "Cloud deployment"],
}
DEFAULT_SKILLS = ["Git", "Python", "SQL", "Data structures & algorithms", "REST APIs", "Linux", "Docker",
                  "Unit testing", "Agile / Scrum", "Cloud basics (AWS/GCP)", "Problem solving", "Technical writing"]
STOPWORDS = set("""a an the and or of to in for with on at by from as is are be will you your we our this that
these those it its into over under about across able experience years year work working team teams strong
skills skill knowledge understanding ability including include such using use plus etc must should would
preferred required requirements responsibilities role job candidate candidates ideal looking join us who
what how have has good great excellent new other more least well within per can may also all any both
degree bachelor master related field equivalent opportunity company environment based""".split())


def _improve_bullet(b: str) -> str:
    s = b.strip().rstrip(".")
    low = s.lower()
    for pat, rep in WEAK_OPENERS.items():
        if re.match(pat, low):
            s = rep + s[re.match(pat, low).end():]
            break
    s = s[:1].upper() + s[1:]
    if not re.search(r"\d", s):
        s += ", improving [metric] by [X%]"
    return s


TECH_TERMS = {w.lower() for lst in ROLE_SKILLS.values() for item in lst
              for w in re.findall(r"[A-Za-z][A-Za-z0-9+#./-]*", item) if len(w) > 1} | set("""
python java javascript typescript go golang rust c++ c# kotlin swift scala ruby php sql nosql postgresql postgres mysql
mongodb redis kafka rabbitmq spark hadoop airflow dbt snowflake bigquery aws gcp azure docker kubernetes k8s terraform
ansible jenkins git github gitlab ci/cd linux bash react angular vue next.js node.js express django flask fastapi spring
graphql rest grpc microservices api apis etl elt pandas numpy pytorch tensorflow keras scikit-learn llm llms rag nlp
mlops tableau powerbi excel agile scrum jira testing pytest junit selenium security oauth jwt html css tailwind figma
""".split())
EXTRA_STOP = set("""hiring hire we're you'll you're we'll own ownership looking build building develop developing
work help ensure drive deliver write writing make plus bonus nice day days fast paced passionate""".split())


def _tokens(text: str) -> list[str]:
    text = re.sub(r"[’']\w+", " ", text.lower())   # drop contraction tails: we're -> we
    return [t for t in re.findall(r"[a-z][a-z0-9+#./-]*[a-z0-9+#]|[a-z]", text)
            if t not in STOPWORDS and t not in EXTRA_STOP and len(t) > 1]


def keyword_report(resume: dict, jd: str) -> dict:
    """Local keyword-match score — used by every provider, not only offline.
    Keywords = known tech terms in the JD, plus any other word the JD repeats."""
    counts = Counter(_tokens(jd))
    keywords = [w for w, c in counts.most_common() if w in TECH_TERMS or c >= 2][:25]
    resume_text = json.dumps(resume).lower()
    present = [k for k in keywords if re.search(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", resume_text)]
    missing = [k for k in keywords if k not in present]
    score = round(100 * len(present) / len(keywords)) if keywords else 0
    return {"score": score, "matched": present, "missing": missing}


def offline_suggest(kind: str, ctx: dict) -> list[str]:
    resume = ctx.get("resume", {})
    role = (ctx.get("target_role") or resume.get("target_role") or "").strip()
    skills = [s for grp in resume.get("skills", []) for s in grp.get("items", [])]

    if kind == "bullets":
        bullets = [b for b in ctx.get("item", {}).get("bullets", []) if b.strip()]
        if not bullets:
            what = ctx.get("item", {}).get("role") or ctx.get("item", {}).get("name") or "this work"
            return [f"Built [feature/system] for {what} using [tech], serving [N] users",
                    "Improved [metric] by [N%] by [specific change you made]",
                    "Collaborated with [team] to deliver [outcome] [N weeks] ahead of schedule"]
        return [_improve_bullet(b) for b in bullets]

    if kind == "skills":
        pool = DEFAULT_SKILLS
        for key, lst in ROLE_SKILLS.items():
            if key in role.lower():
                pool = lst
                break
        have = {s.lower() for s in skills}
        return [s for s in pool if s.lower() not in have][:12]

    if kind == "summary":
        headline = role or resume.get("personal", {}).get("headline") or "Software engineer"
        top = ", ".join(skills[:4]) or "modern tooling"
        exp = resume.get("experience", [])
        proj = resume.get("projects", [])
        evidence = next((b for e in exp + proj for b in e.get("bullets", []) if re.search(r"\d", b)), "")
        evidence = evidence.rstrip(".")
        ev_sentence = f" Recent work: {evidence[:1].lower() + evidence[1:]}." if evidence else ""
        edu = resume.get("education", [{}])[0] if resume.get("education") else {}
        edu_part = f" {edu.get('degree')} candidate" if edu.get("degree") else ""
        return [
            f"{headline} skilled in {top}.{ev_sentence} Focused on building reliable, well-tested software.",
            f"{edu_part.strip() or headline} with hands-on experience in {top}, seeking a {role or 'software'} role."
            f"{ev_sentence}",
            f"Results-driven {headline.lower()} who turns requirements into shipped features using {top}."
            f"{ev_sentence or ' Comfortable owning work end to end, from design to deployment.'}",
        ]

    if kind == "keywords":
        rep = keyword_report(resume, ctx.get("job_description", ""))
        if not rep["missing"]:
            return ["Your resume already mentions the main keywords from this job description."]
        tips = [f"Add '{k}' where it's truthful (skills list, or a bullet showing you used it)" for k in rep["missing"][:8]]
        tips.append("Mirror the job title in your headline and summary")
        return tips
    return []


# =========================================================================== route
@bp.route("/status")
@login_required
def status():
    return jsonify(provider=active_provider())


@bp.route("/suggest", methods=["POST"])
@login_required
def suggest():
    payload = request.get_json(silent=True) or {}
    kind = payload.get("kind")
    if kind not in KINDS:
        return jsonify(error=f"kind must be one of {sorted(KINDS)}"), 400
    ctx = payload.get("context") or {}
    if not isinstance(ctx, dict):
        return jsonify(error="context must be an object"), 400
    if kind == "keywords" and len((ctx.get("job_description") or "").strip()) < 30:
        return jsonify(error="Paste a job description (at least a few lines) first."), 400

    cfg = current_app.config
    if not limiter.hit(f"ai:{g.user['id']}", cfg["AI_REQUESTS_PER_HOUR"], 3600):
        return jsonify(error="AI request limit reached for this hour. Try again later."), 429

    provider = active_provider()
    notice = None
    suggestions: list[str] = []
    if provider != "offline":
        try:
            raw = PROVIDERS[provider][0](build_prompt(kind, ctx))
            suggestions = parse_suggestions(raw)
        except AIError as exc:
            current_app.logger.warning("AI provider %s failed: %s", provider, exc)
            notice = f"{provider} was unavailable ({exc}); showing built-in suggestions instead."
    if not suggestions:
        suggestions = offline_suggest(kind, ctx)
        if provider != "offline" and not notice:
            notice = "The AI returned nothing usable; showing built-in suggestions instead."
        provider = "offline"

    body = {"suggestions": suggestions, "provider": provider}
    if notice:
        body["notice"] = notice
    if kind == "keywords":
        body["report"] = keyword_report(ctx.get("resume", {}), ctx.get("job_description", ""))
    return jsonify(body)
