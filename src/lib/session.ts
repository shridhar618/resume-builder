import "server-only";
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "./config";
import { batch, one, run, type UserRow } from "./db";

/*
 * Server-side sessions. The cookie holds a random token; the DB stores only its SHA-256,
 * so a leaked database can't be used to hijack sessions. Each session carries its own
 * CSRF token for the JSON API (server actions are protected by Next's Origin check).
 */
export const SESSION_COOKIE = "rb_session";

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");

export type Session = { user: UserRow; csrf: string };

// ------------------------------------------------------------------ DB layer (no request context)
export async function createSessionRecord(userId: number): Promise<string> {
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await batch([
    { sql: "DELETE FROM sessions WHERE expires_at < ?", args: [now] },
    {
      sql: "INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)",
      args: [sha256(token), userId, randomToken(), now + config().sessionMaxAgeSeconds],
    },
  ]);
  return token;
}

export async function lookupSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const row = await one<UserRow & { csrf: string }>(
    `SELECT u.id, u.email, u.name, s.csrf FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [sha256(token), Math.floor(Date.now() / 1000)],
  );
  if (!row) return null;
  return { user: { id: Number(row.id), email: row.email, name: row.name }, csrf: row.csrf };
}

export async function destroySessionRecord(token: string | undefined) {
  if (token) await run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
}

// ------------------------------------------------------------------ request helpers
export async function getSession(): Promise<Session | null> {
  return lookupSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For pages and server actions: redirect to /login when signed out. */
export async function requireUser(nextPath?: string): Promise<Session> {
  const s = await getSession();
  if (!s) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return s;
}

/** Start a fresh session (new token on every login prevents session fixation). */
export async function login(userId: number) {
  const jar = await cookies();
  await destroySessionRecord(jar.get(SESSION_COOKIE)?.value);
  jar.set(SESSION_COOKIE, await createSessionRecord(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: config().cookieSecure,
    path: "/",
    maxAge: config().sessionMaxAgeSeconds,
  });
}

export async function logout() {
  const jar = await cookies();
  await destroySessionRecord(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

/** Only allow same-site relative redirects (prevents open-redirect attacks). */
export function safeNext(target: string | null | undefined): string {
  if (target && target.startsWith("/") && !target.startsWith("//") && !target.startsWith("/\\")) {
    try {
      const u = new URL(target, "http://x");
      if (u.host === "x") return u.pathname + u.search;
    } catch {
      /* fall through */
    }
  }
  return "/dashboard";
}
