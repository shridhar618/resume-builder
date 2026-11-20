import "server-only";
import { getDb, type ProfileRow, type ResumeRow } from "./db";
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
    id: row.id,
    title: row.title,
    template: isTemplate(row.template) ? row.template : DEFAULT_TEMPLATE,
    data: normalize(parsed),
    updated_at: row.updated_at,
  };
}

function getOwnedRow(userId: number, resumeId: number): ResumeRow | null {
  if (!Number.isSafeInteger(resumeId) || resumeId <= 0) return null;
  return (getDb().prepare("SELECT * FROM resumes WHERE id = ? AND user_id = ?").get(resumeId, userId) as ResumeRow) ?? null;
}

export function getOwnedResume(userId: number, resumeId: number): Resume | null {
  const row = getOwnedRow(userId, resumeId);
  return row ? toResume(row) : null;
}

export function listResumes(userId: number): Resume[] {
  const rows = getDb()
    .prepare("SELECT * FROM resumes WHERE user_id = ? ORDER BY updated_at DESC, id DESC")
    .all(userId) as ResumeRow[];
  return rows.map(toResume);
}

export function getProfile(userId: number): ProfileRow | null {
  return (getDb().prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as ProfileRow) ?? null;
}

export function createResume(
  userId: number,
  opts: { title?: string; template?: string; startFrom?: string },
): number {
  const title = (opts.title ?? "").trim().slice(0, 100) || "Untitled resume";
  const template = isTemplate(opts.template) ? opts.template : DEFAULT_TEMPLATE;
  const data = opts.startFrom === "sample" ? sampleResume() : fromProfile(getProfile(userId));
  const res = getDb()
    .prepare("INSERT INTO resumes (user_id, title, template, data) VALUES (?, ?, ?, ?)")
    .run(userId, title, template, JSON.stringify(normalize(data)));
  return Number(res.lastInsertRowid);
}

export function duplicateResume(userId: number, resumeId: number): number | null {
  const row = getOwnedRow(userId, resumeId);
  if (!row) return null;
  const res = getDb()
    .prepare("INSERT INTO resumes (user_id, title, template, data) VALUES (?, ?, ?, ?)")
    .run(userId, (row.title + " (copy)").slice(0, 100), row.template, row.data);
  return Number(res.lastInsertRowid);
}

export function deleteResume(userId: number, resumeId: number): boolean {
  return getDb().prepare("DELETE FROM resumes WHERE id = ? AND user_id = ?").run(resumeId, userId).changes > 0;
}

export type SaveResult = { status: number; body: Record<string, unknown> };

/** PUT /api/resumes/:id — partial update of title / template / data. */
export function saveResume(userId: number, resumeId: number, payload: unknown): SaveResult {
  const row = getOwnedRow(userId, resumeId);
  if (!row) return { status: 404, body: { error: "Not found" } };
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return { status: 400, body: { error: "Expected a JSON object" } };
  const p = payload as Record<string, unknown>;
  const title = String(p.title || row.title).trim().slice(0, 100) || "Untitled resume";
  const template = p.template === undefined ? row.template : p.template;
  if (!isTemplate(template)) return { status: 400, body: { error: "Unknown template" } };
  const data = normalize(p.data === undefined ? JSON.parse(row.data) : p.data);
  getDb()
    .prepare(
      "UPDATE resumes SET title = ?, template = ?, data = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    )
    .run(title, template, JSON.stringify(data), resumeId, userId);
  return { status: 200, body: { ok: true, data } };
}

/** "Aarav Sharma" → "Aarav_Sharma_Resume.pdf" */
export function pdfFilename(resume: Resume): string {
  const base = (resume.data.personal.full_name || resume.title).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return `${base || "resume"}_Resume.pdf`;
}
