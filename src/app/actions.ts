"use server";
/*
 * Server actions replace the Flask POST routes. Next.js rejects cross-origin action calls
 * (Origin vs Host check), which is the CSRF protection for every form in the app.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { config } from "@/lib/config";
import { batch, one, run } from "@/lib/db";
import { flash } from "@/lib/flash";
import { dummyHash, hashPassword, validatePassword, verifyPassword } from "@/lib/password";
import { limiter } from "@/lib/rateLimit";
import { createResume, deleteResume, duplicateResume } from "@/lib/resumes";
import { clientIp, getSession, login, logout, requireUser, safeNext } from "@/lib/session";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export type FormState = { error?: string; values?: Record<string, string> };

// ------------------------------------------------------------------ auth
export async function registerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (await getSession()) redirect("/dashboard");
  const name = field(fd, "name").trim().slice(0, 100);
  const email = field(fd, "email").trim().toLowerCase().slice(0, 254);
  const password = field(fd, "password");
  const confirm = field(fd, "confirm");
  const values = { name, email };

  let error: string | null = null;
  if (!name) error = "Name is required.";
  else if (!EMAIL_RE.test(email)) error = "Enter a valid email address.";
  else if (password !== confirm) error = "Passwords do not match.";
  else error = validatePassword(password);
  if (error) return { error, values };

  if (await one("SELECT 1 FROM users WHERE email = ?", [email]))
    return { error: "An account with that email already exists.", values };

  const hash = await hashPassword(password);
  let uid: number;
  try {
    // One transaction: the profile row uses the id the users INSERT just created.
    const [res] = await batch([
      { sql: "INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)", args: [email, name, hash] },
      { sql: "INSERT INTO profiles (user_id, full_name, email) VALUES (last_insert_rowid(), ?, ?)", args: [name, email] },
    ]);
    uid = Number(res.lastInsertRowid);
  } catch {
    // Lost a race with another sign-up for the same email (UNIQUE constraint).
    return { error: "An account with that email already exists.", values };
  }
  await login(uid);
  await flash("success", "Welcome! Fill in your profile — it pre-fills every new resume.");
  redirect("/profile");
}

export async function loginAction(_prev: FormState, fd: FormData): Promise<FormState> {
  if (await getSession()) redirect("/dashboard");
  const email = field(fd, "email").trim().toLowerCase();
  const password = field(fd, "password");
  const cfg = config();
  const key = `login:${await clientIp()}:${email}`;

  if (limiter.isBlocked(key, cfg.loginMaxAttempts, cfg.loginWindowSeconds))
    return { error: "Too many failed attempts. Try again in 15 minutes.", values: { email } };

  const user = await one<{ id: number; password_hash: string }>("SELECT id, password_hash FROM users WHERE email = ?", [email]);
  // Always run a hash comparison so response time doesn't reveal whether the email exists.
  const ok = await verifyPassword(user ? user.password_hash : await dummyHash(), password);
  if (user && ok) {
    limiter.reset(key);
    await login(Number(user.id));
    redirect(safeNext(field(fd, "next")));
  }
  limiter.hit(key, 10_000, cfg.loginWindowSeconds); // record the failure
  return { error: "Incorrect email or password.", values: { email } };
}

export async function logoutAction() {
  await logout();
  await flash("success", "You have been signed out.");
  redirect("/login");
}

export async function changePasswordAction(fd: FormData) {
  const { user } = await requireUser("/profile");
  const row = (await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [user.id]))!;
  const next = field(fd, "new");
  let err: string | null;
  if (!(await verifyPassword(row.password_hash, field(fd, "current")))) err = "Current password is incorrect.";
  else err = validatePassword(next);
  if (err) {
    await flash("error", err);
  } else {
    await run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(next), user.id]);
    await flash("success", "Password updated.");
  }
  redirect("/profile");
}

export async function deleteAccountAction(fd: FormData) {
  const { user } = await requireUser("/profile");
  const row = (await one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [user.id]))!;
  if (!(await verifyPassword(row.password_hash, field(fd, "password")))) {
    await flash("error", "Password is incorrect — account not deleted.");
    redirect("/profile");
  }
  // Delete child rows explicitly: a hosted database connection may not have foreign_keys
  // switched on, so ON DELETE CASCADE can't be relied on.
  await batch(
    ["sessions", "resumes", "profiles"]
      .map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [user.id] }))
      .concat({ sql: "DELETE FROM users WHERE id = ?", args: [user.id] }),
  );
  await logout();
  await flash("success", "Your account and all resumes were deleted.");
  redirect("/register");
}

// ------------------------------------------------------------------ profile
const PROFILE_FIELDS = ["full_name", "headline", "email", "phone", "location", "website", "linkedin", "github", "target_role", "summary"] as const;

export async function saveProfileAction(fd: FormData) {
  const { user } = await requireUser("/profile");
  const values = PROFILE_FIELDS.map((f) => field(fd, f).trim().slice(0, f === "summary" ? 2000 : 300));
  await run(
    `UPDATE profiles SET ${PROFILE_FIELDS.map((f) => `${f} = ?`).join(", ")}, updated_at = datetime('now') WHERE user_id = ?`,
    [...values, user.id],
  );
  const fullName = values[0];
  if (fullName) await run("UPDATE users SET name = ? WHERE id = ?", [fullName.slice(0, 100), user.id]);
  await flash("success", "Profile saved.");
  revalidatePath("/", "layout");
  redirect("/profile");
}

// ------------------------------------------------------------------ resumes
export async function createResumeAction(fd: FormData) {
  const { user } = await requireUser("/dashboard");
  const id = await createResume(user.id, {
    title: field(fd, "title"),
    template: field(fd, "template"),
    startFrom: field(fd, "start_from"),
  });
  redirect(`/resumes/${id}/edit`);
}

export async function duplicateResumeAction(fd: FormData) {
  const { user } = await requireUser("/dashboard");
  const id = await duplicateResume(user.id, Number(field(fd, "id")));
  if (id === null) {
    await flash("error", "That resume doesn't exist (or isn't yours).");
    redirect("/dashboard");
  }
  await flash("success", "Resume duplicated.");
  redirect(`/resumes/${id}/edit`);
}

export async function deleteResumeAction(fd: FormData) {
  const { user } = await requireUser("/dashboard");
  const ok = await deleteResume(user.id, Number(field(fd, "id")));
  await flash(ok ? "success" : "error", ok ? "Resume deleted." : "That resume doesn't exist (or isn't yours).");
  revalidatePath("/dashboard");
  redirect("/dashboard");
}
