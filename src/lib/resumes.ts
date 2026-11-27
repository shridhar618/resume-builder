import "server-only";
import { all, one, run, type ProfileRow, type ResumeRow } from "./db";
import { DEFAULT_TEMPLATE, fromProfile, isTemplate, normalize, sampleResume, type ResumeData, type TemplateKey } from "./resumeModel";

/*
 * Every query filters on user_id. A resume that exists but belongs to someone else is
 * indistinguishable from one that doesn't exist (callers turn `null` into a 404).
 */

export type Resume = { id: number; title: string; template: TemplateKey; data: ResumeData; updated_at: string };

function toResume(row: ResumeRow): Resume {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.data);
  } catch {
    /* corrupt row → empty resume */
  }
  return {
    id: Number(row.id),
    title: row.title,
    template: isTemplate(row.template) ? row.template : DEFAULT_TEMPLATE,
    data: normalize(parsed),
    updated_at: row.updated_at,
  };
}

async function getOwnedRow(userId: number, resumeId: number): Promise<ResumeRow | null> {
  if (!Number.isSafeInteger(resumeId) || resumeId <= 0) return null;
  return one<ResumeRow>("SELECT * FROM resumes WHERE id = ? AND user_id = ?", [resumeId, userId]);
}

export async function getOwnedResume(userId: number, resumeId: number): Promise<Resume | null> {
  const row = await getOwnedRow(userId, resumeId);
  return row ? toResume(row) : null;
}

export async function listResumes(userId: number): Promise<Resume[]> {
  const rows = await all<ResumeRow>("SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC, id DESC", [userId]);
  return rows.map(toResume);
}

export async function getProfile(userId: number): Promise<ProfileRow | null> {
  return one<ProfileRow>("SELECT * FROM profiles WHERE user_id = ?", [userId]);
}

export async function createResume(
  userId: number,
  opts: { title?: string; template?: string; startFrom?: string },
): Promise<number> {
  const title = (opts.title ?? "").trim().slice(0, 100) || "Untitled resume";
  const template = isTemplate(opts.template) ? opts.template : DEFAULT_TEMPLATE;
  const data = opts.startFrom === "sample" ? sampleResume() : fromProfile(await getProfile(userId));
  const res = await run("INSERT INTO resumes (user_id, title, template, data) VALUES (?, ?, ?, ?)", [
    userId,
    title,
    template,
    JSON.stringify(normalize(data)),
  ]);
  return res.lastId;
}

export async function duplicateResume(userId: number, resumeId: number): Promise<number | null> {
  const row = await getOwnedRow(userId, resumeId);
  if (!row) return null;
  const res = await run("INSERT INTO resumes (user_id, title, template, data) VALUES (?, ?, ?, ?)", [
    userId,
    (row.title + " (copy)").slice(0, 100),
    row.template,
    row.data,
  ]);
  return res.lastId;
}

export async function deleteResume(userId: number, resumeId: number): Promise<boolean> {
  return (await run("DELETE FROM resumes WHERE id = ? AND user_id = ?", [resumeId, userId])).changes > 0;
}

export type SaveResult = { status: number; body: Record<string, unknown> };

/** PUT /api/resumes/:id — partial update of title / template / data. */
export async function saveResume(userId: number, resumeId: number, payload: unknown): Promise<SaveResult> {
  const row = await getOwnedRow(userId, resumeId);
  if (!row) return { status: 404, body: { error: "Not found" } };
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return { status: 400, body: { error: "Expected a JSON object" } };
  const p = payload as Record<string, unknown>;
  const title = String(p.title || row.title).trim().slice(0, 100) || "Untitled resume";
  const template = p.template === undefined ? row.template : p.template;
  if (!isTemplate(template)) return { status: 400, body: { error: "Unknown template" } };
  const data = normalize(p.data === undefined ? JSON.parse(row.data) : p.data);
  await run("UPDATE resumes SET title = ?, template = ?, data = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?", [
    title,
    template,
    JSON.stringify(data),
    resumeId,
    userId,
  ]);
  return { status: 200, body: { ok: true, data } };
}

/** "Aarav Sharma" → "Aarav_Sharma_Resume.pdf" */
export function pdfFilename(resume: Resume): string {
  const base = (resume.data.personal.full_name || resume.title).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${base || "resume"}_Resume.pdf`;
}
