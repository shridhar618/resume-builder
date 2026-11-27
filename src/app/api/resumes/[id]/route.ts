import { NextResponse } from "next/server";
import { apiSession, json, readJson } from "@/lib/api";
import { getOwnedResume, saveResume } from "@/lib/resumes";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const s = await apiSession(req);
  if (s instanceof NextResponse) return s;
  const resume = await getOwnedResume(s.user.id, Number((await params).id));
  return resume ? json(resume) : json({ error: "Not found" }, 404);
}

export async function PUT(req: Request, { params }: Ctx) {
  const s = await apiSession(req);
  if (s instanceof NextResponse) return s;
  const body = await readJson(req);
  if (body.tooLarge) return json({ error: "That request was too large." }, 413);
  const r = await saveResume(s.user.id, Number((await params).id), body.value);
  return json(r.body, r.status);
}
