import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { FileText, LogOut, UserRound } from "lucide-react";
import { logoutAction } from "./actions";
import { NavLink, Toasts, UserMenu } from "@/components/client";
import { getFlashes } from "@/lib/flash";
import { getSession } from "@/lib/session";
import "./globals.css";

// Self-hosted at build time by next/font, so it works under the strict CSP.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ResumeAI — AI resume builder", template: "%s · ResumeAI" },
  description: "Build an ATS-friendly resume with AI writing help, job-description matching and PDF export.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111522" },
  ],
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const flashes = await getFlashes();
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <header className="topbar">
          <Link className="logo" href={session ? "/dashboard" : "/"} aria-label="ResumeAI home">
            <span className="logo-mark">CV</span>
            <span className="logo-text">ResumeAI</span>
          </Link>
          {session ? (
            <>
              <nav className="topnav" aria-label="Main">
                <NavLink href="/dashboard">
                  <FileText size={17} />
                  <span>My resumes</span>
                </NavLink>
                <NavLink href="/profile">
                  <UserRound size={17} />
                  <span>Profile</span>
                </NavLink>
              </nav>
              <div className="topbar-right">
                <UserMenu initials={initials(session.user.name)} name={session.user.name} email={session.user.email}>
                  <Link href="/profile">
                    <UserRound size={16} /> Profile & account
                  </Link>
                  <form action={logoutAction}>
                    <button type="submit">
                      <LogOut size={16} /> Sign out
                    </button>
                  </form>
                </UserMenu>
              </div>
            </>
          ) : (
            <div className="topbar-right">
              <Link className="link-muted" href="/login">
                Sign in
              </Link>
              <Link className="btn btn-primary btn-sm" href="/register">
                Get started
              </Link>
            </div>
          )}
        </header>
        {children}
        <Toasts key={JSON.stringify(flashes)} messages={flashes} />
      </body>
    </html>
  );
}
