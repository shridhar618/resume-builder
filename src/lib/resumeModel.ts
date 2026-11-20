/**
 * Resume data shape, validation/normalisation, and the template registry.
 *
 * Resume data is stored as one JSON document per resume. Everything coming from the
 * client goes through `normalize()` so the DB only ever holds known keys, strings of
 * bounded length, and bounded list sizes. Shared by server and client code.
 */

export const TEMPLATES = {
  modern: { name: "Modern", description: "Two-tone header with an accent colour. Good for tech roles." },
  classic: { name: "Classic", description: "Serif, centred header, traditional single column." },
  minimal: { name: "Minimal", description: "Clean sans-serif with a left date rail. ATS friendly." },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;
export const DEFAULT_TEMPLATE: TemplateKey = "modern";
export const isTemplate = (t: unknown): t is TemplateKey => typeof t === "string" && Object.hasOwn(TEMPLATES, t);

export const PERSONAL_FIELDS = ["full_name", "headline", "email", "phone", "location", "website", "linkedin", "github"] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];

export type Experience = { role: string; company: string; location: string; start: string; end: string; bullets: string[] };
export type Education = { degree: string; school: string; location: string; start: string; end: string; score: string };
export type Project = { name: string; tech: string; link: string; bullets: string[] };
export type Certification = { name: string; issuer: string; date: string };
export type SkillGroup = { category: string; items: string[] };

export type ResumeData = {
  personal: Record<PersonalField, string>;
  target_role: string;
  summary: string;
  experience: Experience[];
  education: Education[];
  projects: Project[];
  skills: SkillGroup[];
  certifications: Certification[];
  achievements: string[];
};

export const SECTION_SCHEMAS = {
  experience: ["role", "company", "location", "start", "end"],
  education: ["degree", "school", "location", "start", "end", "score"],
  projects: ["name", "tech", "link"],
  certifications: ["name", "issuer", "date"],
} as const;
export type ListSection = keyof typeof SECTION_SCHEMAS;
const SECTIONS_WITH_BULLETS = new Set<ListSection>(["experience", "projects"]);

const MAX_STR = 300;
const MAX_TEXT = 2000;
const MAX_ITEMS = 20;
const MAX_BULLETS = 10;

export function emptyResume(): ResumeData {
  return {
    personal: Object.fromEntries(PERSONAL_FIELDS.map((f) => [f, ""])) as Record<PersonalField, string>,
    target_role: "",
    summary: "",
    experience: [],
    education: [],
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
  };
}

type ProfileLike = Partial<Record<PersonalField | "summary" | "target_role", string | null>>;

export function fromProfile(profile: ProfileLike | null | undefined): ResumeData {
  const data = emptyResume();
  if (profile) {
    for (const f of PERSONAL_FIELDS) data.personal[f] = profile[f] || "";
    data.summary = profile.summary || "";
    data.target_role = profile.target_role || "";
  }
  return data;
}

// Python's str.strip() + slice, counting code points like Python does.
function s(v: unknown, limit = MAX_STR): string {
  if (v === null || v === undefined) return "";
  return Array.from(String(v).trim()).slice(0, limit).join("");
}

function strList(v: unknown, limit = MAX_BULLETS, size = MAX_STR): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, limit)
    .map((x) => s(x, size))
    .filter(Boolean);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function normalize(raw: unknown): ResumeData {
  const r = isObj(raw) ? raw : {};
  const data = emptyResume();
  const personal = isObj(r.personal) ? r.personal : {};
  for (const f of PERSONAL_FIELDS) data.personal[f] = s(personal[f]);
  data.target_role = s(r.target_role, 120);
  data.summary = s(r.summary, MAX_TEXT);

  for (const section of Object.keys(SECTION_SCHEMAS) as ListSection[]) {
    const items = Array.isArray(r[section]) ? (r[section] as unknown[]) : [];
    const clean: Record<string, unknown>[] = [];
    for (const item of items.slice(0, MAX_ITEMS)) {
      if (!isObj(item)) continue;
      const entry: Record<string, unknown> = {};
      for (const f of SECTION_SCHEMAS[section]) entry[f] = s(item[f]);
      if (SECTIONS_WITH_BULLETS.has(section)) entry.bullets = strList(item.bullets);
      const hasAny = Object.values(entry).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
      if (hasAny) clean.push(entry);
    }
    (data as unknown as Record<string, unknown>)[section] = clean;
  }

  const skills = Array.isArray(r.skills) ? r.skills : [];
  for (const grp of skills.slice(0, MAX_ITEMS)) {
    if (!isObj(grp)) continue;
    const entry = { category: s(grp.category, 60), items: strList(grp.items, 40, 60) };
    if (entry.category || entry.items.length) data.skills.push(entry);
  }

  data.achievements = strList(r.achievements, MAX_ITEMS);
  return data;
}

const SAMPLE: ResumeData = {
  personal: {
    full_name: "Aarav Sharma",
    headline: "Backend & Data Engineer",
    email: "aarav.sharma@example.com",
    phone: "+91 98765 43210",
    location: "Bengaluru, India",
    website: "aarav.dev",
    linkedin: "linkedin.com/in/aaravsharma",
    github: "github.com/aaravsharma",
  },
  target_role: "Backend Engineer",
  summary:
    "Backend engineer who builds reliable data services in Python and PostgreSQL. " +
    "Shipped APIs serving 50k daily users and cut report latency by 70% through query and caching work.",
  experience: [
    {
      role: "Software Engineering Intern",
      company: "FinEdge Labs",
      location: "Bengaluru",
      start: "Jan 2026",
      end: "Jun 2026",
      bullets: [
        "Built a FastAPI service for transaction reconciliation handling 2M records/day",
        "Reduced p95 API latency from 820 ms to 240 ms with Redis caching and query tuning",
        "Wrote CI pipelines in GitHub Actions, raising test coverage from 41% to 78%",
      ],
    },
  ],
  education: [
    {
      degree: "Master of Computer Applications",
      school: "PES University",
      location: "Bengaluru",
      start: "2025",
      end: "2027",
      score: "CGPA 8.9",
    },
  ],
  projects: [
    {
      name: "Multi-tenant Sales Analytics",
      tech: "PostgreSQL, Python, React",
      link: "github.com/aaravsharma/analytics",
      bullets: [
        "Designed row-level-security schema isolating 30+ tenants",
        "Incremental materialised views refresh dashboards in under 2 s",
      ],
    },
  ],
  skills: [
    { category: "Languages", items: ["Python", "SQL", "Java", "TypeScript"] },
    { category: "Backend", items: ["FastAPI", "Flask", "PostgreSQL", "Redis", "Docker"] },
    { category: "Data / ML", items: ["Pandas", "PyTorch", "scikit-learn"] },
  ],
  certifications: [{ name: "AWS Cloud Practitioner", issuer: "Amazon Web Services", date: "2026" }],
  achievements: ["Finalist, national fintech hackathon (top 10 of 600 teams)"],
};

export function sampleResume(): ResumeData {
  return structuredClone(SAMPLE);
}

// ------------------------------------------------------------------ helpers shared by HTML + PDF renderers
export const CONTACT_FIELDS: PersonalField[] = ["email", "phone", "location", "website", "linkedin", "github"];
export const LINK_FIELDS = new Set<PersonalField>(["email", "website", "linkedin", "github"]);

export function href(url: string): string {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (u.includes("@") && !u.includes(" ")) return "mailto:" + u;
  return "https://" + u;
}

export function dates(item: { start?: string; end?: string }): string {
  const { start = "", end = "" } = item;
  return start && end ? `${start} – ${end}` : start || end;
}

export const joinTruthy = (parts: (string | undefined)[], sep: string) => parts.filter(Boolean).join(sep);
