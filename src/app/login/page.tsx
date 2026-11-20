import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <h1>Welcome back</h1>
        <p className="muted">Sign in to edit your resumes.</p>
        <LoginForm next={typeof next === "string" ? next : ""} />
        <hr className="divider" />
        <p className="small muted">
          New here? <Link href="/register">Create an account</Link>
        </p>
      </div>
    </main>
  );
}
