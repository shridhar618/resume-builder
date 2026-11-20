import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Copy, Download, FileText, Pencil, Sparkles, Trash2 } from "lucide-react";
import { createResumeAction, deleteResumeAction, duplicateResumeAction } from "../actions";
import { ConfirmForm, NewResumeButton, SubmitButton } from "@/components/client";
import { ResumeView } from "@/components/ResumeView";
import { activeProvider } from "@/lib/ai";
import { TEMPLATES } from "@/lib/resumeModel";
import { listResumes } from "@/lib/resumes";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My resumes" };

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) → "5 min ago". Rendered on the server only. */
function ago(sqliteUtc: string): string {
  const t = Date.parse(sqliteUtc.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return sqliteUtc;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const units: [number, string][] = [
    [60, "min"],
    [3600, "hour"],
    [86400, "day"],
    [604800, "week"],
  ];
  if (s >= 2592000) return new Date(t).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
  let [div, name] = units[0];
  for (const u of units) if (s >= u[0]) [div, name] = u;
  const n = Math.floor(s / div);
  return `${n} ${name}${n === 1 || name === "min" ? "" : "s"} ago`;
}

export default async function Dashboard() {
  const { user } = await requireUser("/dashboard");
  const resumes = listResumes(user.id);
  const provider = activeProvider();
  const firstName = user.name.split(/\s+/)[0];

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>{resumes.length ? `Welcome back, ${firstName}` : `Welcome, ${firstName}`}</h1>
          <p className="ai-status">
            <span className="badge badge-ai">
              <Sparkles size={12} /> AI: {provider}
            </span>
            {provider === "offline" ? (
              <span>
                Built-in suggestions — add an API key in <code>.env</code> for full AI.
              </span>
            ) : (
              <span>Connected and ready.</span>
            )}
          </p>
        </div>
        <span className="spacer" />
        {resumes.length > 0 && <NewResumeButton action={createResumeAction} label="New resume" />}
      </div>

      {resumes.length ? (
        <div className="resume-grid">
          {resumes.map((r) => (
            <article className="card resume-card" key={r.id}>
              <Link className="thumb" href={`/resumes/${r.id}/edit`} aria-label={`Edit ${r.title}`}>
                <ResumeView data={r.data} template={r.template} links={false} />
                <span className="open-hint">
                  <span>
                    <Pencil size={14} /> Open editor
                  </span>
                </span>
              </Link>
              <div className="body">
                <Link className="title" href={`/resumes/${r.id}/edit`} title={r.title}>
                  {r.title}
                </Link>
                <div className="meta">
                  <span className="badge">{TEMPLATES[r.template].name}</span>
                  <span className="row" style={{ gap: 4 }}>
                    <Clock size={12} /> {ago(r.updated_at)}
                  </span>
                </div>
                <div className="card-actions">
                  <Link className="btn btn-sm" href={`/resumes/${r.id}/edit`}>
                    <Pencil size={14} /> Edit
                  </Link>
                  <a className="icon-btn" href={`/resumes/${r.id}/pdf`} title="Download PDF" aria-label="Download PDF">
                    <Download size={16} />
                  </a>
                  <span className="spacer" />
                  <form action={duplicateResumeAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="icon-btn" title="Copy">
                      <Copy size={16} />
                    </SubmitButton>
                  </form>
                  <ConfirmForm action={deleteResumeAction} confirm={`Delete “${r.title}”? This can't be undone.`}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="icon-btn danger" title="Delete">
                      <Trash2 size={16} />
                    </SubmitButton>
                  </ConfirmForm>
                </div>
              </div>
            </article>
          ))}
          <NewResumeButton action={createResumeAction} label="New resume" variant="card" />
        </div>
      ) : (
        <div className="card empty">
          <div className="empty-icon">
            <FileText size={30} />
          </div>
          <h2>No resumes yet</h2>
          <p className="muted">Start from your profile, or from a filled-in sample to see how everything works.</p>
          <NewResumeButton action={createResumeAction} label="Create your first resume" />
        </div>
      )}
    </main>
  );
}
