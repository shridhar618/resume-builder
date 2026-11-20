import { NextResponse } from "next/server";
import { suggest } from "@/lib/ai";
import { apiSession, json, readJson } from "@/lib/api";

export async function POST(req: Request) {
  const s = await apiSession(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (body.tooLarge) return json({ error: "That request was too large." }, 413);
  const r = await suggest(s.user.id, body.value ?? {});
  return json(r.body, r.status);
}
