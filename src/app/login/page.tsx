import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { getSession } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/dashboard");
  const { next } = await searchParams;
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to keep editing your resumes."
      footer={
        <>
          New to ResumeAI? <Link href="/register">Create an account</Link>
        </>
      }
    >
      <LoginForm next={typeof next === "string" ? next : ""} />
    </AuthShell>
  );
}
