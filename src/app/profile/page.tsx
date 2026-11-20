import type { Metadata } from "next";
import { AlignLeft, KeyRound, Link2, Save, Trash2, TriangleAlert, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { changePasswordAction, deleteAccountAction, saveProfileAction } from "../actions";
import { ConfirmForm, SubmitButton } from "@/components/client";
import { getProfile } from "@/lib/resumes";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Profile" };

type F = [name: string, label: string, type: string, placeholder?: string];
const PERSONAL: F[] = [
  ["full_name", "Full name", "text"],
  ["headline", "Headline", "text", "Backend Engineer | Python, PostgreSQL"],
  ["email", "Contact email", "email"],
  ["phone", "Phone", "text", "+91 98765 43210"],
  ["location", "Location", "text", "Bengaluru, India"],
  ["target_role", "Target role", "text", "Data Engineer"],
];
const LINKS: F[] = [
  ["linkedin", "LinkedIn", "text", "linkedin.com/in/you"],
  ["github", "GitHub", "text", "github.com/you"],
  ["website", "Website / portfolio", "text", "you.dev"],
];

function Panel({ id, icon, title, desc, children, className = "" }: { id: string; icon: ReactNode; title: string; desc: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card panel ${className}`} id={id}>
      <div className="panel-head">
        <span className="ic">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default async function ProfilePage() {
  const { user } = await requireUser("/profile");
  const profile = (getProfile(user.id) ?? {}) as Record<string, string | null>;
  const field = ([name, label, type, placeholder]: F) => (
    <div key={name}>
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} defaultValue={profile[name] ?? ""} placeholder={placeholder} />
    </div>
  );

  return (
    <main className="container">
      <div className="page-head">
        <div>
          <h1>Profile & account</h1>
          <p className="muted">These details pre-fill every new resume. Editing a resume never changes your profile.</p>
        </div>
      </div>

      <div className="settings">
        <nav className="settings-nav" aria-label="Sections">
          <a href="#details">
            <UserRound size={16} /> Personal details
          </a>
          <a href="#password">
            <KeyRound size={16} /> Password
          </a>
          <a href="#danger">
            <TriangleAlert size={16} /> Delete account
          </a>
        </nav>

        <div>
          <form action={saveProfileAction} key={JSON.stringify(profile)}>
            <Panel id="details" icon={<UserRound size={19} />} title="Personal details" desc="Your name, headline and how recruiters can reach you.">
              <div className="panel-body">
                <div className="grid-2">{PERSONAL.map(field)}</div>
                <div className="sub-label" style={{ marginTop: 22 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <Link2 size={15} /> Links
                  </span>
                </div>
                <div className="grid-2">{LINKS.map(field)}</div>
                <div className="sub-label" style={{ marginTop: 22 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <AlignLeft size={15} /> Default summary
                  </span>
                </div>
                <textarea id="summary" name="summary" rows={4} aria-label="Default summary" defaultValue={profile.summary ?? ""} placeholder="2–3 sentences about who you are and what you're great at." />
              </div>
              <div className="panel-foot">
                <SubmitButton className="btn btn-primary">
                  <Save size={16} /> Save profile
                </SubmitButton>
              </div>
            </Panel>
          </form>

          <form action={changePasswordAction} style={{ marginTop: 22 }}>
            <Panel id="password" icon={<KeyRound size={19} />} title="Change password" desc="At least 8 characters, with a letter and a number.">
              <div className="panel-body">
                <div className="grid-2">
                  <div>
                    <label htmlFor="current">Current password</label>
                    <input id="current" name="current" type="password" required autoComplete="current-password" />
                  </div>
                  <div>
                    <label htmlFor="new">New password</label>
                    <input id="new" name="new" type="password" required minLength={8} autoComplete="new-password" />
                  </div>
                </div>
              </div>
              <div className="panel-foot">
                <SubmitButton>Update password</SubmitButton>
              </div>
            </Panel>
          </form>

          <ConfirmForm action={deleteAccountAction} confirm="Permanently delete your account and every resume?">
            <div style={{ marginTop: 22 }}>
              <Panel id="danger" className="danger" icon={<TriangleAlert size={19} />} title="Delete account" desc="Removes your profile and all resumes permanently. This can't be undone.">
                <div className="panel-body">
                  <label htmlFor="del_pw">Confirm with your password</label>
                  <input id="del_pw" name="password" type="password" required autoComplete="current-password" style={{ maxWidth: 360 }} />
                </div>
                <div className="panel-foot">
                  <SubmitButton className="btn btn-danger-solid">
                    <Trash2 size={16} /> Delete my account
                  </SubmitButton>
                </div>
              </Panel>
            </div>
          </ConfirmForm>
        </div>
      </div>
    </main>
  );
}
