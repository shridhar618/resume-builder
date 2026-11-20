from flask import Blueprint, flash, g, redirect, render_template, request, url_for

from .db import get_db
from .security import login_required

bp = Blueprint("profile", __name__, url_prefix="/profile")

FIELDS = ["full_name", "headline", "email", "phone", "location", "website", "linkedin", "github", "target_role", "summary"]


def get_profile(user_id: int):
    return get_db().execute("SELECT * FROM profiles WHERE user_id = ?", (user_id,)).fetchone()


@bp.route("/", methods=["GET", "POST"])
@login_required
def edit():
    db = get_db()
    if request.method == "POST":
        values = {f: request.form.get(f, "").strip()[: (2000 if f == "summary" else 300)] for f in FIELDS}
        db.execute(
            f"UPDATE profiles SET {', '.join(f + ' = ?' for f in FIELDS)}, updated_at = datetime('now') WHERE user_id = ?",
            (*values.values(), g.user["id"]),
        )
        if values["full_name"]:
            db.execute("UPDATE users SET name = ? WHERE id = ?", (values["full_name"][:100], g.user["id"]))
        db.commit()
        flash("Profile saved.", "success")
        return redirect(url_for("profile.edit"))
    return render_template("profile.html", profile=get_profile(g.user["id"]))
