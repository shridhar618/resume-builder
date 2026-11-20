import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { RegisterForm } from "./RegisterForm";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <h1>Create your account</h1>
        <p className="muted">Your resumes are private to your account.</p>
        <RegisterForm />
        <hr className="divider" />
        <p className="small muted">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </main>
  );
}
