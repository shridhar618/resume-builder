"""Development entry point:  python run.py   →  http://127.0.0.1:5000

For production use a WSGI server, e.g.:  waitress-serve --call app:create_app   (Windows)
                                       or  gunicorn "app:create_app()"            (Linux/macOS)
"""
import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=os.environ.get("FLASK_DEBUG") == "1", port=int(os.environ.get("PORT", 5000)))
