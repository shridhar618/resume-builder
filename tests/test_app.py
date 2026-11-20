import json
import re

import pytest

from app import create_app
from app.security import limiter


@pytest.fixture
def app(tmp_path):
    limiter.clear()
    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "test.db"), "SECRET_KEY": "test",
                      "AI_PROVIDER": "offline", "GEMINI_API_KEY": "", "OPENAI_API_KEY": "", "ANTHROPIC_API_KEY": ""})
    yield app


@pytest.fixture
def client(app):
    return app.test_client()


def csrf(client, url="/login"):
    html = client.get(url).get_data(as_text=True)
    return re.search(r'name="csrf-token" content="([^"]+)"', html).group(1)


def register(client, email="a@example.com", pw="secret123", name="Asha"):
    token = csrf(client, "/register")
    return client.post("/register", data={"csrf_token": token, "name": name, "email": email,
                                          "password": pw, "confirm": pw})


def login(client, email="a@example.com", pw="secret123"):
    token = csrf(client, "/login")
    return client.post("/login", data={"csrf_token": token, "email": email, "password": pw})


def logout(client):
    token = csrf(client, "/dashboard")
    client.post("/logout", data={"csrf_token": token})


def new_resume(client, start="sample", template="modern"):
    token = csrf(client, "/dashboard")
    r = client.post("/resumes/new", data={"csrf_token": token, "title": "Test", "template": template, "start_from": start})
    return int(r.headers["Location"].rstrip("/").split("/")[-2])


# ------------------------------------------------------------------ auth
def test_register_login_logout(client):
    r = register(client)
    assert r.status_code == 302 and "/profile" in r.headers["Location"]
    assert client.get("/dashboard").status_code == 200
    logout(client)
    assert client.get("/dashboard").status_code == 302
    assert login(client).status_code == 302
    assert client.get("/dashboard").status_code == 200


def test_password_is_hashed(app, client):
    register(client)
    with app.app_context():
        from app.db import get_db
        h = get_db().execute("SELECT password_hash FROM users").fetchone()[0]
    assert "secret123" not in h and h.startswith(("scrypt:", "pbkdf2:"))


def test_weak_password_and_duplicate_email(client):
    assert b"at least 8" in register(client, pw="short1").data
    register(client)
    logout(client)
    assert b"already exists" in register(client).data


def test_wrong_password_and_lockout(client):
    register(client)
    logout(client)
    for _ in range(5):
        assert b"Incorrect email or password" in login(client, pw="wrongpass1").data
    assert login(client).status_code == 429  # locked even with the right password


def test_csrf_required(client):
    register(client)
    assert client.post("/resumes/new", data={"title": "x"}).status_code == 400
    rid = new_resume(client)
    r = client.put(f"/api/resumes/{rid}", json={"title": "x"})
    assert r.status_code == 400


def test_open_redirect_blocked(client):
    register(client)
    logout(client)
    token = csrf(client)
    r = client.post("/login?next=//evil.com", data={"csrf_token": token, "email": "a@example.com", "password": "secret123"})
    assert r.headers["Location"].endswith("/dashboard")


def test_protected_routes_require_login(client):
    for url in ["/dashboard", "/profile/", "/resumes/1/edit", "/resumes/1/pdf"]:
        assert client.get(url).status_code == 302
    assert client.get("/api/resumes/1").status_code == 401


# ------------------------------------------------------------------ resumes
def test_users_cannot_access_each_others_resumes(client):
    register(client, "a@example.com")
    rid = new_resume(client)
    logout(client)
    register(client, "b@example.com")
    for url in [f"/resumes/{rid}/edit", f"/resumes/{rid}/pdf", f"/resumes/{rid}/preview", f"/api/resumes/{rid}"]:
        assert client.get(url).status_code == 404
    token = csrf(client, "/dashboard")
    assert client.put(f"/api/resumes/{rid}", json={"title": "pwned"}, headers={"X-CSRF-Token": token}).status_code == 404
    assert client.post(f"/resumes/{rid}/delete", data={"csrf_token": token}).status_code == 404


def test_new_resume_prefilled_from_profile(client):
    register(client, name="Asha Rao")
    rid = new_resume(client, start="profile")
    data = client.get(f"/api/resumes/{rid}").get_json()["data"]
    assert data["personal"]["full_name"] == "Asha Rao"


def test_save_normalises_and_escapes(client):
    register(client)
    rid = new_resume(client)
    token = csrf(client, "/dashboard")
    payload = {"title": "T", "template": "classic", "data": {
        "personal": {"full_name": "<script>alert(1)</script>", "evil": "x"},
        "experience": [{"role": "Dev", "bullets": ["a" * 5000, ""]}, "junk"],
        "skills": [{"category": "Lang", "items": ["Python", ""]}],
        "unknown_key": 1}}
    r = client.put(f"/api/resumes/{rid}", json=payload, headers={"X-CSRF-Token": token})
    assert r.status_code == 200
    d = r.get_json()["data"]
    assert "evil" not in d["personal"] and "unknown_key" not in d
    assert len(d["experience"]) == 1 and len(d["experience"][0]["bullets"][0]) == 300
    assert d["skills"][0]["items"] == ["Python"]
    html = client.get(f"/resumes/{rid}/preview").get_data(as_text=True)
    assert "<script>alert(1)</script>" not in html and "&lt;script&gt;" in html


def test_bad_template_rejected(client):
    register(client)
    rid = new_resume(client)
    token = csrf(client, "/dashboard")
    assert client.put(f"/api/resumes/{rid}", json={"template": "../../etc"}, headers={"X-CSRF-Token": token}).status_code == 400


@pytest.mark.parametrize("template", ["modern", "classic", "minimal"])
def test_pdf_export_each_template(client, template):
    register(client)
    rid = new_resume(client, template=template)
    r = client.get(f"/resumes/{rid}/pdf")
    assert r.status_code == 200 and r.mimetype == "application/pdf"
    assert r.data.startswith(b"%PDF") and len(r.data) > 2000
    assert "Aarav_Sharma_Resume.pdf" in r.headers["Content-Disposition"]
    assert client.get(f"/resumes/{rid}/preview?template={template}").status_code == 200


def test_pdf_handles_hostile_text(client):
    register(client)
    rid = new_resume(client, start="profile")
    token = csrf(client, "/dashboard")
    data = {"personal": {"full_name": "A & B <i>x</i> ₹ → ☃"}, "summary": "<para>broken & markup",
            "projects": [{"name": "P", "link": 'x" onclick="y', "bullets": ["<b>unclosed"]}]}
    client.put(f"/api/resumes/{rid}", json={"data": data}, headers={"X-CSRF-Token": token})
    r = client.get(f"/resumes/{rid}/pdf")
    assert r.status_code == 200 and r.data.startswith(b"%PDF")


def test_duplicate_and_delete(client):
    register(client)
    rid = new_resume(client)
    token = csrf(client, "/dashboard")
    r = client.post(f"/resumes/{rid}/duplicate", data={"csrf_token": token})
    assert r.status_code == 302
    client.post(f"/resumes/{rid}/delete", data={"csrf_token": token})
    assert client.get(f"/api/resumes/{rid}").status_code == 404


def test_delete_account_cascades(app, client):
    register(client)
    new_resume(client)
    token = csrf(client, "/dashboard")
    client.post("/account/delete", data={"csrf_token": token, "password": "secret123"})
    with app.app_context():
        from app.db import get_db
        assert get_db().execute("SELECT COUNT(*) FROM resumes").fetchone()[0] == 0


# ------------------------------------------------------------------ AI
def ai(client, kind, context):
    token = csrf(client, "/dashboard")
    return client.post("/api/ai/suggest", json={"kind": kind, "context": context}, headers={"X-CSRF-Token": token})


@pytest.mark.parametrize("kind", ["summary", "bullets", "skills"])
def test_ai_offline_suggestions(client, kind):
    register(client)
    from app.resume_model import sample_resume
    resume = sample_resume()
    ctx = {"resume": resume, "item": {"role": "Intern", "bullets": ["worked on the API", "responsible for testing"]}}
    r = ai(client, kind, ctx)
    body = r.get_json()
    assert r.status_code == 200 and body["provider"] == "offline" and body["suggestions"]
    if kind == "bullets":
        assert body["suggestions"][0].startswith("Developed the API")
        assert body["suggestions"][1].startswith("Led testing")


def test_ai_keywords_report(client):
    register(client)
    from app.resume_model import sample_resume
    jd = ("We are hiring a Backend Engineer with strong Python, PostgreSQL and Kubernetes skills. "
          "Experience with Kafka and Kubernetes in production is a plus. Python and Kafka are key.")
    body = ai(client, "keywords", {"resume": sample_resume(), "job_description": jd}).get_json()
    rep = body["report"]
    assert "python" in rep["matched"] and "kubernetes" in rep["missing"] and 0 < rep["score"] < 100


def test_ai_validation_and_rate_limit(app, client):
    register(client)
    assert ai(client, "poem", {}).status_code == 400
    assert ai(client, "keywords", {"job_description": "short"}).status_code == 400
    app.config["AI_REQUESTS_PER_HOUR"] = 2
    ai(client, "skills", {})
    ai(client, "skills", {})
    assert ai(client, "skills", {}).status_code == 429


def test_ai_provider_failure_falls_back(app, client, monkeypatch):
    import app.ai as ai_mod
    app.config.update(AI_PROVIDER="gemini", GEMINI_API_KEY="fake")

    def boom(_prompt):
        raise ai_mod.AIError("HTTP 500")
    monkeypatch.setitem(ai_mod.PROVIDERS, "gemini", (boom, "GEMINI_API_KEY"))
    register(client)
    body = ai(client, "skills", {"target_role": "devops"}).get_json()
    assert body["provider"] == "offline" and "notice" in body and "Terraform" in body["suggestions"]


def test_ai_remote_provider_parsing(app, client, monkeypatch):
    import app.ai as ai_mod
    app.config.update(AI_PROVIDER="openai", OPENAI_API_KEY="fake")
    monkeypatch.setitem(ai_mod.PROVIDERS, "openai",
                        (lambda p: '```json\n{"suggestions": ["One", "Two"]}\n```', "OPENAI_API_KEY"))
    register(client)
    body = ai(client, "summary", {"resume": {}}).get_json()
    assert body == {"suggestions": ["One", "Two"], "provider": "openai"}


def test_parse_suggestions_plain_list():
    from app.ai import parse_suggestions
    assert parse_suggestions("1. First\n- Second\n\n• Third") == ["First", "Second", "Third"]
