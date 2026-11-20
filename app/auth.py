import re
from urllib.parse import urlparse

from flask import Blueprint, current_app, flash, g, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

from .db import get_db
from .security import limiter, login_required

bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# Constant hash used to equalise timing when the email doesn't exist.
_DUMMY_HASH = generate_password_hash("not-a-real-password")


def validate_password(pw: str) -> str | None:
    if len(pw) < 8:
        return "Password must be at least 8 characters."
    if len(pw) > 128:
        return "Password is too long."
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        return "Password must contain at least one letter and one number."
    return None


def _safe_next(target: str | None) -> str:
    # Only allow same-site relative redirects (prevents open-redirect attacks).
    if target and target.startswith("/") and not target.startswith("//") and not urlparse(target).netloc:
        return target
    return url_for("resumes.dashboard")


def _login(user_id: int):
    session.clear()  # new session on login (prevents session fixation)
    session.permanent = True
    session["user_id"] = user_id


@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("resumes.dashboard"))
    form = {"name": "", "email": ""}
    if request.method == "POST":
        name = request.form.get("name", "").strip()[:100]
        email = request.form.get("email", "").strip().lower()[:254]
        password = request.form.get("password", "")
        confirm = request.form.get("confirm", "")
        form = {"name": name, "email": email}

        error = None
        if not name:
            error = "Name is required."
        elif not EMAIL_RE.match(email):
            error = "Enter a valid email address."
        elif password != confirm:
            error = "Passwords do not match."
        else:
            error = validate_password(password)

        if error is None:
            db = get_db()
            if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
                error = "An account with that email already exists."
            else:
                cur = db.execute(
                    "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)",
                    (email, name, generate_password_hash(password)),
                )
                uid = cur.lastrowid
                db.execute(
                    "INSERT INTO profiles (user_id, full_name, email) VALUES (?, ?, ?)", (uid, name, email)
                )
                db.commit()
                _login(uid)
                flash("Welcome! Fill in your profile — it pre-fills every new resume.", "success")
                return redirect(url_for("profile.edit"))
        flash(error, "error")
    return render_template("auth/register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("resumes.dashboard"))
    email = ""
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        cfg = current_app.config
        key = f"login:{request.remote_addr}:{email}"

        if limiter.is_blocked(key, cfg["LOGIN_MAX_ATTEMPTS"], cfg["LOGIN_WINDOW_SECONDS"]):
            flash("Too many failed attempts. Try again in 15 minutes.", "error")
            return render_template("auth/login.html", email=email), 429

        user = get_db().execute("SELECT id, password_hash FROM users WHERE email = ?", (email,)).fetchone()
        ok = check_password_hash(user["password_hash"] if user else _DUMMY_HASH, password)
        if user and ok:
            limiter.reset(key)
            next_url = _safe_next(request.args.get("next"))
            _login(user["id"])
            return redirect(next_url)

        limiter.hit(key, 10_000, cfg["LOGIN_WINDOW_SECONDS"])  # record the failure
        flash("Incorrect email or password.", "error")
    return render_template("auth/login.html", email=email)


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("You have been signed out.", "success")
    return redirect(url_for("auth.login"))


@bp.route("/account/password", methods=["POST"])
@login_required
def change_password():
    current = request.form.get("current", "")
    new = request.form.get("new", "")
    row = get_db().execute("SELECT password_hash FROM users WHERE id = ?", (g.user["id"],)).fetchone()
    if not check_password_hash(row["password_hash"], current):
        flash("Current password is incorrect.", "error")
    elif (err := validate_password(new)) is not None:
        flash(err, "error")
    else:
        db = get_db()
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (generate_password_hash(new), g.user["id"]))
        db.commit()
        flash("Password updated.", "success")
    return redirect(url_for("profile.edit"))


@bp.route("/account/delete", methods=["POST"])
@login_required
def delete_account():
    row = get_db().execute("SELECT password_hash FROM users WHERE id = ?", (g.user["id"],)).fetchone()
    if not check_password_hash(row["password_hash"], request.form.get("password", "")):
        flash("Password is incorrect — account not deleted.", "error")
        return redirect(url_for("profile.edit"))
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ?", (g.user["id"],))  # cascades to profile + resumes
    db.commit()
    session.clear()
    flash("Your account and all resumes were deleted.", "success")
    return redirect(url_for("auth.register"))
