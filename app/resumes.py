import json
import re

from flask import Blueprint, abort, flash, g, jsonify, make_response, redirect, render_template, request, url_for

from . import resume_model as rm
from .db import get_db
from .pdf_export import render_pdf
from .profile import get_profile
from .security import login_required

bp = Blueprint("resumes", __name__)


def _get_owned(resume_id: int):
    """Fetch a resume only if it belongs to the signed-in user. 404 otherwise (don't leak existence)."""
    row = get_db().execute(
        "SELECT * FROM resumes WHERE id = ? AND user_id = ?", (resume_id, g.user["id"])
    ).fetchone()
    if row is None:
        abort(404)
    return row


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "template": row["template"],
        "data": rm.normalize(json.loads(row["data"])),
        "updated_at": row["updated_at"],
    }


@bp.route("/")
def index():
    if g.user:
        return redirect(url_for("resumes.dashboard"))
    return render_template("landing.html", templates=rm.TEMPLATES)


@bp.route("/dashboard")
@login_required
def dashboard():
    rows = get_db().execute(
        "SELECT id, title, template, updated_at FROM resumes WHERE user_id = ? ORDER BY updated_at DESC",
        (g.user["id"],),
    ).fetchall()
    return render_template("dashboard.html", resumes=rows, templates=rm.TEMPLATES)


@bp.route("/resumes/new", methods=["POST"])
@login_required
def create():
    title = request.form.get("title", "").strip()[:100] or "Untitled resume"
    template = request.form.get("template", rm.DEFAULT_TEMPLATE)
    if template not in rm.TEMPLATES:
        template = rm.DEFAULT_TEMPLATE
    if request.form.get("start_from") == "sample":
        data = rm.sample_resume()
    else:
        data = rm.from_profile(get_profile(g.user["id"]))
    db = get_db()
    cur = db.execute(
        "INSERT INTO resumes (user_id, title, template, data) VALUES (?, ?, ?, ?)",
        (g.user["id"], title, template, json.dumps(rm.normalize(data))),
    )
    db.commit()
    return redirect(url_for("resumes.editor", resume_id=cur.lastrowid))


@bp.route("/resumes/<int:resume_id>/edit")
@login_required
def editor(resume_id):
    resume = _row_to_dict(_get_owned(resume_id))
    return render_template("editor.html", resume=resume, templates=rm.TEMPLATES)


@bp.route("/resumes/<int:resume_id>/duplicate", methods=["POST"])
@login_required
def duplicate(resume_id):
    row = _get_owned(resume_id)
    db = get_db()
    cur = db.execute(
        "INSERT INTO resumes (user_id, title, template, data) VALUES (?, ?, ?, ?)",
        (g.user["id"], (row["title"] + " (copy)")[:100], row["template"], row["data"]),
    )
    db.commit()
    flash("Resume duplicated.", "success")
    return redirect(url_for("resumes.editor", resume_id=cur.lastrowid))


@bp.route("/resumes/<int:resume_id>/delete", methods=["POST"])
@login_required
def delete(resume_id):
    _get_owned(resume_id)
    db = get_db()
    db.execute("DELETE FROM resumes WHERE id = ? AND user_id = ?", (resume_id, g.user["id"]))
    db.commit()
    flash("Resume deleted.", "success")
    return redirect(url_for("resumes.dashboard"))


@bp.route("/resumes/<int:resume_id>/preview")
@login_required
def preview(resume_id):
    resume = _row_to_dict(_get_owned(resume_id))
    template = request.args.get("template", resume["template"])
    if template not in rm.TEMPLATES:
        template = resume["template"]
    return render_template(f"resume_templates/{template}.html", r=resume["data"], standalone=True)


@bp.route("/resumes/<int:resume_id>/pdf")
@login_required
def pdf(resume_id):
    resume = _row_to_dict(_get_owned(resume_id))
    pdf_bytes = render_pdf(resume["data"], resume["template"], title=resume["title"])
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", resume["data"]["personal"]["full_name"] or resume["title"]).strip("_")
    resp = make_response(pdf_bytes)
    resp.headers["Content-Type"] = "application/pdf"
    disposition = "inline" if request.args.get("inline") else "attachment"
    resp.headers["Content-Disposition"] = f'{disposition}; filename="{name or "resume"}_Resume.pdf"'
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ------------------------------------------------------------------ JSON API used by the editor
@bp.route("/api/resumes/<int:resume_id>", methods=["GET"])
@login_required
def api_get(resume_id):
    return jsonify(_row_to_dict(_get_owned(resume_id)))


@bp.route("/api/resumes/<int:resume_id>", methods=["PUT"])
@login_required
def api_save(resume_id):
    row = _get_owned(resume_id)
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(error="Expected a JSON object"), 400
    title = str(payload.get("title") or row["title"]).strip()[:100] or "Untitled resume"
    template = payload.get("template", row["template"])
    if template not in rm.TEMPLATES:
        return jsonify(error="Unknown template"), 400
    data = rm.normalize(payload.get("data", json.loads(row["data"])))
    db = get_db()
    db.execute(
        "UPDATE resumes SET title = ?, template = ?, data = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        (title, template, json.dumps(data), resume_id, g.user["id"]),
    )
    db.commit()
    return jsonify(ok=True, data=data)
