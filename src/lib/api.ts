import "server-only";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getSession, type Session } from "./session";

const MAX_BODY = 512 * 1024;

export const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Auth + CSRF for JSON endpoints. Mutating requests must echo the session's CSRF token in
 * the X-CSRF-Token header (a cross-site form can't set custom headers).
 */
export async function apiSession(req: Request): Promise<Session | NextResponse> {
  const session = await getSession();
  if (!session) return json({ error: "Authentication required" }, 401);
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const sent = req.headers.get("x-csrf-token") ?? "";
    const a = Buffer.from(sent);
    const b = Buffer.from(session.csrf);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return json({ error: "Invalid or missing CSRF token" }, 400);
  }
  return session;
}

/** Parse a JSON body, enforcing the request size cap. Returns undefined on bad JSON. */
export async function readJson(req: Request): Promise<{ value?: unknown; tooLarge?: boolean }> {
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY) return { tooLarge: true };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return {};
  }
}
