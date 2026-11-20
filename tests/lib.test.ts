import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test gets a fresh SQLite file and offline AI.
let tmp: string;
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rb-"));
  Object.assign(process.env, {
    DATABASE_PATH: path.join(tmp, "test.db"),
    AI_PROVIDER: "offline",
    GEMINI_API_KEY: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    AI_REQUESTS_PER_HOUR: "60",
  });
  (await import("@/lib/rateLimit")).limiter.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const { getDb } = await import("@/lib/db");
const { hashPassword, verifyPassword, validatePassword } = await import("@/lib/password");
const { createSessionRecord, lookupSession, destroySessionRecord, safeNext } = await import("@/lib/session");
const rm = await import("@/lib/resumeModel");
const resumes = await import("@/lib/resumes");
const ai = await import("@/lib/ai");
const { renderPdf, pdfText } = await import("@/lib/pdf");
const { limiter } = await import("@/lib/rateLimit");

async function makeUser(email = "a@example.com", name = "Asha") {
  const db = getDb();
  const id = Number(
    db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)").run(email, name, await hashPassword("secret123"))
      .lastInsertRowid,
  );
  db.prepare("INSERT INTO profiles (user_id, full_name, email) VALUES (?, ?, ?)").run(id, name, email);
  return id;
}

// ------------------------------------------------------------------ auth
describe("passwords", () => {
  it("hashes with salted scrypt and verifies", async () => {
    const h = await hashPassword("secret123");
    expect(h).toMatch(/^scrypt:32768:8:1\$[A-Za-z0-9]{16}\$[0-9a-f]{128}$/);
    expect(h).not.toContain("secret123");
    expect(await verifyPassword(h, "secret123")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await hashPassword("secret123")).not.toBe(h);
  });

  it("verifies a hash produced by the original Flask/Werkzeug app", async () => {
    // generate_password_hash("secret123") from Werkzeug 3
    const werkzeug = "scrypt:32768:8:1$3dfnLFOT6lU2cxcj$a3ad2ac8f99d5e2b7e5a0d92360fac10af278a14ce7d41f2a9962c48ffc02669fbf3150cb582ea0a5f4aba0e2b3e42b929a6fbca0bf657de50d6c068048a877d";
    expect(await verifyPassword(werkzeug, "secret123")).toBe(true);
    expect(await verifyPassword(werkzeug, "secret124")).toBe(false);
    expect(await verifyPassword("pbkdf2:sha256$x$y", "x")).toBe(false);
    expect(await verifyPassword("garbage", "x")).toBe(false);
  });

  it("enforces password rules", () => {
    expect(validatePassword("short1")).toMatch(/at least 8/);
    expect(validatePassword("longpassword")).toMatch(/letter and one number/);
    expect(validatePassword("secret123")).toBeNull();
  });
});

describe("sessions", () => {
  it("creates, looks up and destroys sessions; stores only a hash", async () => {
    const uid = await makeUser();
    const token = createSessionRecord(uid);
    const s = lookupSession(token);
    expect(s?.user.id).toBe(uid);
    expect(s?.csrf.length).toBeGreaterThan(20);
    const stored = getDb().prepare("SELECT token_hash FROM sessions").get() as { token_hash: string };
    expect(stored.token_hash).not.toBe(token);
    destroySessionRecord(token);
    expect(lookupSession(token)).toBeNull();
    expect(lookupSession("forged")).toBeNull();
  });

  it("drops sessions when the account is deleted", async () => {
    const uid = await makeUser();
    const token = createSessionRecord(uid);
    resumes.createResume(uid, { startFrom: "sample" });
    getDb().prepare("DELETE FROM users WHERE id = ?").run(uid);
    expect(lookupSession(token)).toBeNull();
    expect((getDb().prepare("SELECT COUNT(*) n FROM resumes").get() as { n: number }).n).toBe(0);
  });

  it("blocks open redirects", () => {
    expect(safeNext("//evil.com")).toBe("/dashboard");
    expect(safeNext("https://evil.com")).toBe("/dashboard");
    expect(safeNext("/\\evil.com")).toBe("/dashboard");
    expect(safeNext(null)).toBe("/dashboard");
    expect(safeNext("/resumes/3/edit")).toBe("/resumes/3/edit");
  });

  it("rate limiter locks after the limit", () => {
    for (let i = 0; i < 5; i++) expect(limiter.hit("k", 5, 60)).toBe(true);
    expect(limiter.isBlocked("k", 5, 60)).toBe(true);
    expect(limiter.hit("k", 5, 60)).toBe(false);
    limiter.reset("k");
    expect(limiter.isBlocked("k", 5, 60)).toBe(false);
  });
});

// ------------------------------------------------------------------ resumes
describe("resumes", () => {
  it("users cannot access each other's resumes", async () => {
    const a = await makeUser("a@example.com");
    const b = await makeUser("b@example.com");
    const rid = resumes.createResume(a, { startFrom: "sample" });
    expect(resumes.getOwnedResume(b, rid)).toBeNull();
    expect(resumes.saveResume(b, rid, { title: "pwned" }).status).toBe(404);
    expect(resumes.duplicateResume(b, rid)).toBeNull();
    expect(resumes.deleteResume(b, rid)).toBe(false);
    expect(resumes.getOwnedResume(a, rid)?.title).toBe("Untitled resume");
  });

  it("new resume is pre-filled from the profile", async () => {
    const uid = await makeUser("a@example.com", "Asha Rao");
    const rid = resumes.createResume(uid, { title: "T", startFrom: "profile" });
    expect(resumes.getOwnedResume(uid, rid)?.data.personal.full_name).toBe("Asha Rao");
  });

  it("save normalises untrusted input", async () => {
    const uid = await makeUser();
    const rid = resumes.createResume(uid, { startFrom: "sample" });
    const r = resumes.saveResume(uid, rid, {
      title: "T",
      template: "classic",
      data: {
        personal: { full_name: "<script>alert(1)</script>", evil: "x" },
        experience: [{ role: "Dev", bullets: ["a".repeat(5000), ""] }, "junk"],
        skills: [{ category: "Lang", items: ["Python", ""] }],
        unknown_key: 1,
      },
    });
    expect(r.status).toBe(200);
    const d = r.body.data as import("@/lib/resumeModel").ResumeData & Record<string, unknown>;
    expect(d.personal).not.toHaveProperty("evil");
    expect(d).not.toHaveProperty("unknown_key");
    expect(d.experience).toHaveLength(1);
    expect(d.experience[0].bullets[0]).toHaveLength(300);
    expect(d.skills[0].items).toEqual(["Python"]);
  });

  it("rejects unknown templates and non-object bodies", async () => {
    const uid = await makeUser();
    const rid = resumes.createResume(uid, {});
    expect(resumes.saveResume(uid, rid, { template: "../../etc" }).status).toBe(400);
    expect(resumes.saveResume(uid, rid, { template: "constructor" }).status).toBe(400);
    expect(resumes.saveResume(uid, rid, [1, 2]).status).toBe(400);
  });

  it("duplicates and deletes", async () => {
    const uid = await makeUser();
    const rid = resumes.createResume(uid, { title: "Mine", startFrom: "sample" });
    const copy = resumes.duplicateResume(uid, rid)!;
    expect(resumes.getOwnedResume(uid, copy)?.title).toBe("Mine (copy)");
    expect(resumes.deleteResume(uid, rid)).toBe(true);
    expect(resumes.getOwnedResume(uid, rid)).toBeNull();
    expect(resumes.listResumes(uid).map((r) => r.id)).toEqual([copy]);
  });

  it("builds the PDF filename from the person's name", async () => {
    const uid = await makeUser();
    const r = resumes.getOwnedResume(uid, resumes.createResume(uid, { startFrom: "sample" }))!;
    expect(resumes.pdfFilename(r)).toBe("Aarav_Sharma_Resume.pdf");
  });
});

// ------------------------------------------------------------------ PDF
describe("pdf", () => {
  it.each(["modern", "classic", "minimal"] as const)("renders the %s template", async (template) => {
    const buf = await renderPdf(rm.sampleResume(), template);
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(2000);
  });

  it("handles hostile and non-Latin text", async () => {
    const data = rm.normalize({
      personal: { full_name: "A & B <i>x</i> ₹ → ☃" },
      summary: "<para>broken & markup",
      projects: [{ name: "P", link: 'x" onclick="y', bullets: ["<b>unclosed"] }],
    });
    const buf = await renderPdf(data, "modern");
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdfText("₹ → ☃ é")).toBe("Rs. -> ? é");
  });

  it("renders an empty resume", async () => {
    const buf = await renderPdf(rm.emptyResume(), "minimal");
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
  });
});

// ------------------------------------------------------------------ AI
describe("ai", () => {
  it.each(["summary", "bullets", "skills"] as const)("offline %s suggestions", async (kind) => {
    const uid = await makeUser();
    const ctx = { resume: rm.sampleResume(), item: { role: "Intern", bullets: ["worked on the API", "responsible for testing"] } };
    const r = await ai.suggest(uid, { kind, context: ctx });
    expect(r.status).toBe(200);
    expect(r.body.provider).toBe("offline");
    const s = r.body.suggestions as string[];
    expect(s.length).toBeGreaterThan(0);
    if (kind === "bullets") {
      expect(s[0].startsWith("Developed the API")).toBe(true);
      expect(s[1].startsWith("Led testing")).toBe(true);
    }
  });

  it("keyword report", async () => {
    const uid = await makeUser();
    const jd =
      "We are hiring a Backend Engineer with strong Python, PostgreSQL and Kubernetes skills. " +
      "Experience with Kafka and Kubernetes in production is a plus. Python and Kafka are key.";
    const r = await ai.suggest(uid, { kind: "keywords", context: { resume: rm.sampleResume(), job_description: jd } });
    const rep = r.body.report as { score: number; matched: string[]; missing: string[] };
    expect(rep.matched).toContain("python");
    expect(rep.missing).toContain("kubernetes");
    expect(rep.score).toBeGreaterThan(0);
    expect(rep.score).toBeLessThan(100);
  });

  it("validates input and rate-limits", async () => {
    const uid = await makeUser();
    expect((await ai.suggest(uid, { kind: "poem", context: {} })).status).toBe(400);
    expect((await ai.suggest(uid, { kind: "keywords", context: { job_description: "short" } })).status).toBe(400);
    process.env.AI_REQUESTS_PER_HOUR = "2";
    await ai.suggest(uid, { kind: "skills", context: {} });
    await ai.suggest(uid, { kind: "skills", context: {} });
    expect((await ai.suggest(uid, { kind: "skills", context: {} })).status).toBe(429);
  });

  it("falls back to offline when the provider fails", async () => {
    const uid = await makeUser();
    Object.assign(process.env, { AI_PROVIDER: "gemini", GEMINI_API_KEY: "fake" });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(ai.PROVIDERS.gemini, "call").mockRejectedValue(new ai.AIError("HTTP 500"));
    const r = await ai.suggest(uid, { kind: "skills", context: { target_role: "devops" } });
    expect(r.body.provider).toBe("offline");
    expect(r.body.notice).toBeTruthy();
    expect(r.body.suggestions).toContain("Terraform");
  });

  it("parses a remote provider's fenced JSON", async () => {
    const uid = await makeUser();
    Object.assign(process.env, { AI_PROVIDER: "openai", OPENAI_API_KEY: "fake" });
    vi.spyOn(ai.PROVIDERS.openai, "call").mockResolvedValue('```json\n{"suggestions": ["One", "Two"]}\n```');
    const r = await ai.suggest(uid, { kind: "summary", context: { resume: {} } });
    expect(r.body).toEqual({ suggestions: ["One", "Two"], provider: "openai" });
  });

  it("auto-detects the first configured key", () => {
    Object.assign(process.env, { AI_PROVIDER: "", ANTHROPIC_API_KEY: "k" });
    expect(ai.activeProvider()).toBe("anthropic");
  });

  it("parses plain-list suggestions", () => {
    expect(ai.parseSuggestions("1. First\n- Second\n\n• Third")).toEqual(["First", "Second", "Third"]);
  });
});
