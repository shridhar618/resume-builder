import type { Metadata } from "next";
import Link from "next/link";
import { createResumeAction, deleteResumeAction, duplicateResumeAction } from "../actions";
import { ConfirmForm, NewResumeButton, SubmitButton } from "@/components/client";
import { ResumeView } from "@/components/ResumeView";
import { activeProvider } from "@/lib/ai";
import { TEMPLATES } from "@/lib/resumeModel";
import { listResumes } from "@/lib/resumes";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "My resumes" };

export default async function Dashboard() {
  const { user } = await requireUser("/dashboard");
  const resumes = listResumes(user.id);
  const provider = activeProvider();

  return (
    <main className="container">
      <div className="row" style={{ marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0 }}>My resumes</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            AI: <span className="badge badge-ai">{provider}</span>
            {provider === "offline" && (
              <span className="small">
                {" "}
                — built-in suggestions; add an API key in <code>.env</code> for full AI.
              </span>
            )}
          </p>
        </div>
        <span className="spacer" />
        <NewResumeButton action={createResumeAction} label="+ New resume" />
      </div>

      {resumes.length ? (
        <div className="resume-grid">
          {resumes.map((r) => (
            <div className="card resume-card" key={r.id}>
              <Link className="thumb" href={`/resumes/${r.id}/edit`} aria-label={`Edit ${r.title}`} tabIndex={-1}>
                <ResumeView data={r.data} template={r.template} />
              </Link>
              <div className="body">
                <Link className="title" href={`/resumes/${r.id}/edit`}>
                  {r.title}
                </Link>
                <div className="small muted">
                  <span className="badge">{TEMPLATES[r.template].name}</span> · edited {r.updated_at.slice(0, 16)} UTC
                </div>
                <div className="row" style={{ gap: 6, marginTop: "auto" }}>
                  <Link className="btn btn-sm" href={`/resumes/${r.id}/edit`}>
                    Edit
                  </Link>
                  <a className="btn btn-sm" href={`/resumes/${r.id}/pdf`}>
                    PDF
                  </a>
                  <form className="inline" action={duplicateResumeAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="btn btn-sm btn-ghost" title="Duplicate">
                      Copy
                    </SubmitButton>
                  </form>
                  <ConfirmForm className="inline" action={deleteResumeAction} confirm={`Delete “${r.title}”? This can't be undone.`}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="btn btn-sm btn-ghost" title="Delete">
                      Delete
                    </SubmitButton>
                  </ConfirmForm>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card empty">
          <h2>No resumes yet</h2>
          <p className="muted">Start from your profile, or from a filled-in sample to see how it works.</p>
          <NewResumeButton action={createResumeAction} label="Create your first resume" />
        </div>
      )}
    </main>
  );
}
