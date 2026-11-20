import type { Metadata } from "next";
import { changePasswordAction, deleteAccountAction, saveProfileAction } from "../actions";
import { ConfirmForm, SubmitButton } from "@/components/client";
import { getProfile } from "@/lib/resumes";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Profile" };

const FIELDS: [name: string, label: string, type: string, placeholder?: string][] = [
  ["full_name", "Full name", "text"],
  ["headline", "Headline", "text", "Backend Engineer | Python, PostgreSQL"],
  ["email", "Contact email", "email"],
  ["phone", "Phone", "text"],
  ["location", "Location", "text", "Bengaluru, India"],
  ["target_role", "Target role", "text", "Data Engineer"],
  ["linkedin", "LinkedIn", "text", "linkedin.com/in/you"],
  ["github", "GitHub", "text", "github.com/you"],
  ["website", "Website / portfolio", "text"],
];

export default async function ProfilePage() {
  const { user } = await requireUser("/profile");
  const profile = (getProfile(user.id) ?? {}) as Record<string, string | null>;

  return (
    <main className="container" style={{ maxWidth: 820 }}>
      <h1>Your profile</h1>
      <p className="muted">These details pre-fill every new resume. Editing a resume never changes your profile.</p>

      <form action={saveProfileAction} className="card stack" key={JSON.stringify(profile)}>
        <div className="grid-2">
          {FIELDS.map(([name, label, type, placeholder]) => (
            <div key={name}>
              <label htmlFor={name}>{label}</label>
              <input id={name} name={name} type={type} defaultValue={profile[name] ?? ""} placeholder={placeholder} />
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="summary">Default summary</label>
          <textarea id="summary" name="summary" rows={4} defaultValue={profile.summary ?? ""} />
        </div>
        <div className="row">
          <span className="spacer" />
          <SubmitButton className="btn btn-primary">Save profile</SubmitButton>
        </div>
      </form>

      <h2 style={{ marginTop: 36 }}>Account</h2>
      <div className="grid-2">
        <form action={changePasswordAction} className="card stack">
          <h3>Change password</h3>
          <div>
            <label htmlFor="current">Current password</label>
            <input id="current" name="current" type="password" required autoComplete="current-password" />
          </div>
          <div>
            <label htmlFor="new">New password</label>
            <input id="new" name="new" type="password" required minLength={8} autoComplete="new-password" />
          </div>
          <SubmitButton>Update password</SubmitButton>
        </form>
        <ConfirmForm action={deleteAccountAction} className="card stack" confirm="Permanently delete your account and every resume?">
          <h3>Delete account</h3>
          <p className="small muted" style={{ margin: 0 }}>
            Removes your profile and all resumes permanently.
          </p>
          <div>
            <label htmlFor="del_pw">Confirm with password</label>
            <input id="del_pw" name="password" type="password" required autoComplete="current-password" />
          </div>
          <SubmitButton className="btn btn-danger">Delete my account</SubmitButton>
        </ConfirmForm>
      </div>
    </main>
  );
}
