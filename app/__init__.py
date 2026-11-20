from flask import Flask, render_template

from .config import Config


def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=False)
    app.config.from_object(Config)
    if overrides:
        app.config.update(overrides)

    from . import ai, auth, profile, resumes
    from .db import init_db
    from .security import csrf_protect, get_csrf_token, load_current_user, set_security_headers

    init_db(app)
    app.before_request(load_current_user)
    app.before_request(csrf_protect)
    app.after_request(set_security_headers)
    app.jinja_env.globals["csrf_token"] = get_csrf_token

    app.register_blueprint(auth.bp)
    app.register_blueprint(profile.bp)
    app.register_blueprint(resumes.bp)
    app.register_blueprint(ai.bp)

    @app.context_processor
    def inject_ai_provider():
        return {"ai_provider": ai.active_provider}

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404, message="That page doesn't exist (or isn't yours)."), 404

    @app.errorhandler(400)
    def bad_request(e):
        return render_template("error.html", code=400, message=e.description), 400

    @app.errorhandler(413)
    def too_large(_e):
        return render_template("error.html", code=413, message="That request was too large."), 413

    return app
