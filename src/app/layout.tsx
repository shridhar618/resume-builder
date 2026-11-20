import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "./actions";
import { Flashes, NavLink } from "@/components/client";
import { getFlashes } from "@/lib/flash";
import { getSession } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AI Resume Builder", template: "%s · ResumeAI" },
  description: "Build an ATS-friendly resume with AI writing help, job-description matching and PDF export.",
  icons: { icon: "/favicon.svg" },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const flashes = await getFlashes();
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="logo" href="/">
            <span className="logo-mark">CV</span> ResumeAI
          </Link>
          <nav>
            {session ? (
              <>
                <NavLink href="/dashboard">My resumes</NavLink>
                <NavLink href="/profile">Profile</NavLink>
                <span className="muted small">{session.user.name}</span>
                <form className="inline" action={logoutAction}>
                  <button className="btn btn-sm" type="submit">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login">Sign in</Link>
                <Link className="btn btn-primary btn-sm" href="/register">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </header>
        <Flashes key={JSON.stringify(flashes)} messages={flashes} />
        {children}
      </body>
    </html>
  );
}
