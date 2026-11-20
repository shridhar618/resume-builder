"""CSRF protection, login enforcement and simple in-memory rate limiting."""
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from functools import wraps

from flask import abort, current_app, g, jsonify, redirect, request, session, url_for

from .db import get_db

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


# ---------------------------------------------------------------- CSRF
def get_csrf_token() -> str:
    token = session.get("_csrf")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf"] = token
    return token


def csrf_protect():
    """Runs before every request. Forms send `csrf_token`, fetch() sends `X-CSRF-Token`."""
    if request.method in SAFE_METHODS or current_app.config.get("WTF_CSRF_DISABLED"):
        return
    expected = session.get("_csrf")
    sent = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token")
    if not expected or not sent or not hmac.compare_digest(expected, sent):
        if request.path.startswith("/api/"):
            return jsonify(error="Invalid or missing CSRF token"), 400
        abort(400, description="Invalid or missing CSRF token. Reload the page and try again.")


# ---------------------------------------------------------------- auth
def load_current_user():
    g.user = None
    uid = session.get("user_id")
    if uid is not None:
        g.user = get_db().execute("SELECT id, email, name FROM users WHERE id = ?", (uid,)).fetchone()
        if g.user is None:
            session.clear()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.get("user") is None:
            if request.path.startswith("/api/"):
                return jsonify(error="Authentication required"), 401
            return redirect(url_for("auth.login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# ---------------------------------------------------------------- rate limiting
class RateLimiter:
    """Sliding-window limiter. In-memory, so per-process; swap for Redis when scaling out."""

    def __init__(self):
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window: int) -> bool:
        """Record a hit. Returns False when the key is over its limit."""
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True

    def is_blocked(self, key: str, limit: int, window: int) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            return len(q) >= limit

    def reset(self, key: str):
        with self._lock:
            self._hits.pop(key, None)

    def clear(self):
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def set_security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; font-src 'self' data:; frame-ancestors 'self'",
    )
    return resp
