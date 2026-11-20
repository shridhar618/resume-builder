import Link from "next/link";
import { redirect } from "next/navigation";
import { TEMPLATES } from "@/lib/resumeModel";
import { getSession } from "@/lib/session";

export default async function Landing() {
  if (await getSession()) redirect("/dashboard");
  const names = Object.values(TEMPLATES).map((t) => t.name);
  return (
    <main className="container">
      <section className="hero">
        <h1>Build a resume recruiters actually read</h1>
        <p>
          Pick a template, let AI tighten your summary and bullet points, check it against a job description, and download a
          clean, ATS-friendly PDF.
        </p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link className="btn btn-primary" href="/register">
            Get started — it&apos;s free
          </Link>
          <Link className="btn" href="/login">
            Sign in
          </Link>
        </div>
      </section>
      <section className="grid-3">
        <div className="card feature">
          <div className="icon">✨</div>
          <h3>AI writing help</h3>
          <p className="muted">
            Generate summaries, rewrite weak bullets with strong verbs and metrics, and get skill suggestions for your target role.
          </p>
        </div>
        <div className="card feature">
          <div className="icon">🎯</div>
          <h3>Job-description match</h3>
          <p className="muted">Paste a JD to see a keyword match score, what&apos;s missing, and concrete tailoring tips.</p>
        </div>
        <div className="card feature">
          <div className="icon">📄</div>
          <h3>{names.length} templates, real PDFs</h3>
          <p className="muted">
            {names.join(", ")} — switch anytime with a live preview. PDFs contain real, selectable text.
          </p>
        </div>
      </section>
    </main>
  );
}
