import { NextResponse } from "next/server";
import { activeProvider } from "@/lib/ai";
import { apiSession, json } from "@/lib/api";

export async function GET(req: Request) {
  const s = await apiSession(req);
  if (s instanceof NextResponse) return s;
  return json({ provider: activeProvider() });
}
