import "server-only";
/**
 * AI content suggestions.
 *
 * Providers are called over plain REST with fetch, so no vendor SDK is needed:
 *   - gemini    (GEMINI_API_KEY)     — has a free tier, easiest for students
 *   - openai    (OPENAI_API_KEY)
 *   - anthropic (ANTHROPIC_API_KEY)
 *   - offline   rule-based fallback, used automatically when no key is configured
 *               or when the remote call fails, so the app always works in a demo.
 *
 * Every suggestion kind returns {suggestions: string[], provider: string}.
 */
import { config, type Config } from "./config";
import { limiter } from "./rateLimit";

export const KINDS = ["bullets", "keywords", "skills", "summary"] as const;
export type Kind = (typeof KINDS)[number];

const SYSTEM_PROMPT =
  "You are an expert resume writer and technical recruiter. You write concise, specific, " +
  "ATS-friendly resume content. Never invent employers, degrees, dates or numbers that were not " +
  "given; where a metric would help but is unknown, use a clear placeholder like [X%]. " +
  'Always reply with ONLY a JSON object of the form {"suggestions": ["...", ...]} and no other text.';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ctx = Record<string, any>;
const obj = (v: unknown): Ctx => (v && typeof v === "object" && !Array.isArray(v) ? (v as Ctx) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

// =========================================================================== prompts
function resumeDigest(d: Ctx): string {
  const parts: string[] = [];
  const p = obj(d.personal);
  if (p.headline) parts.push(`Headline: ${p.headline}`);
  if (d.target_role) parts.push(`Target role: ${d.target_role}`);
  if (d.summary) parts.push(`Current summary: ${d.summary}`);
  for (const e of arr(d.experience).slice(0, 6).map(obj))
    parts.push(`Experience: ${e.role} at ${e.company} (${e.start}–${e.end}): ` + arr(e.bullets).join("; "));
  for (const pr of arr(d.projects).slice(0, 6).map(obj))
    parts.push(`Project: ${pr.name} [${pr.tech}]: ` + arr(pr.bullets).join("; "));
  for (const ed of arr(d.education).slice(0, 3).map(obj)) parts.push(`Education: ${ed.degree}, ${ed.school} ${ed.end}`);
  const skills = arr(d.skills).flatMap((g) => arr(obj(g).items));
  if (skills.length) parts.push("Skills: " + skills.slice(0, 60).join(", "));
  return parts.join("\n").slice(0, 6000);
}

export function buildPrompt(kind: Kind, ctx: Ctx): string {
  const resume = obj(ctx.resume);
  const role = str(ctx.target_role || resume.target_role).trim();
  const digest = resumeDigest(resume);
  switch (kind) {
    case "summary":
      return (
        `Write 3 alternative professional summaries (2–3 sentences, under 60 words each) for this ` +
        `candidate${role ? " targeting a " + role + " role" : ""}. Lead with the strongest evidence. ` +
        `No first-person pronouns, no clichés like 'hard-working' or 'team player'.\n\n${digest}`
      );
    case "bullets": {
      const item = obj(ctx.item);
      const bullets =
        arr(item.bullets)
          .filter(Boolean)
          .map((b) => `- ${b}`)
          .join("\n") || "(no bullets yet)";
      const heading = item.role || item.name || "this entry";
      const org = item.company || item.tech || "";
      return (
        `Rewrite these resume bullet points for '${heading}' ${org ? "(" + org + ")" : ""}` +
        `${role ? " for a " + role + " application" : ""}. Return one improved bullet per original ` +
        `(or 3 new ones if none were given). Each bullet: start with a strong past-tense action verb, ` +
        `show impact, under 25 words, no trailing period.\n\nOriginal bullets:\n${bullets}\n\n` +
        `Context from the rest of the resume:\n${digest}`
      );
    }
    case "skills":
      return (
        `Suggest 12 specific skills (tools, languages, frameworks, concepts) that a ` +
        `${role || "software engineering"} candidate should list and that fit this background. ` +
        `Exclude skills already listed. Each suggestion is a short skill name only.\n\n${digest}`
      );
    case "keywords": {
      const jd = str(ctx.job_description).slice(0, 6000);
      return (
        `Compare this resume to the job description. Return up to 10 short, concrete, actionable ` +
        `suggestions to tailor the resume (missing keywords to add where truthful, bullets to ` +
        `reframe, sections to reorder).\n\nJOB DESCRIPTION:\n${jd}\n\nRESUME:\n${digest}`
      );
    }
  }
}

// =========================================================================== providers
export class AIError extends Error {}

async function post(url: string, headers: Record<string, string>, body: unknown, cfg: Config): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.aiTimeoutSeconds * 1000),
    });
  } catch (err) {
    throw new AIError(`Network error contacting AI provider: ${(err as Error).name}`);
  }
  if (res.status >= 400) throw new AIError(`AI provider returned HTTP ${res.status}`);
  return res.json();
}

async function callGemini(prompt: string, cfg: Config): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}:generateContent`;
  const data = await post(
    url,
    { "x-goog-api-key": cfg.geminiApiKey, "Content-Type": "application/json" },
    {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
    },
    cfg,
  );
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new AIError("Unexpected Gemini response");
  return text;
}

async function callOpenAI(prompt: string, cfg: Config): Promise<string> {
  const data = await post(
    "https://api.openai.com/v1/chat/completions",
    { Authorization: `Bearer ${cfg.openaiApiKey}`, "Content-Type": "application/json" },
    {
      model: cfg.openaiModel, // no temperature: newer reasoning models reject it
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    },
    cfg,
  );
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new AIError("Unexpected OpenAI response");
  return text;
}

async function callAnthropic(prompt: string, cfg: Config): Promise<string> {
  const data = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": cfg.anthropicApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    { model: cfg.anthropicModel, max_tokens: 1024, system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] },
    cfg,
  );
  if (!Array.isArray(data?.content)) throw new AIError("Unexpected Anthropic response");
  return data.content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text ?? "")
    .join("");
}

type ProviderName = "gemini" | "openai" | "anthropic";
type Provider = { call: (prompt: string, cfg: Config) => Promise<string>; key: keyof Config };

/** Mutable on purpose: tests swap entries to simulate provider failures. */
export const PROVIDERS: Record<ProviderName, Provider> = {
  gemini: { call: callGemini, key: "geminiApiKey" },
  openai: { call: callOpenAI, key: "openaiApiKey" },
  anthropic: { call: callAnthropic, key: "anthropicApiKey" },
};

export function activeProvider(cfg: Config = config()): ProviderName | "offline" {
  const chosen = cfg.aiProvider;
  if (chosen === "offline") return "offline";
  if (chosen in PROVIDERS && cfg[PROVIDERS[chosen as ProviderName].key]) return chosen as ProviderName;
  for (const [name, p] of Object.entries(PROVIDERS)) if (cfg[p.key]) return name as ProviderName; // auto-detect
  return "offline";
}

/** Models occasionally wrap JSON in prose or code fences; be forgiving. */
export function parseSuggestions(text: string): string[] {
  const t = text.trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const items = JSON.parse(m[0])?.suggestions;
      if (Array.isArray(items)) {
        const out = items.map((x) => String(x).trim()).filter(Boolean);
        if (out.length) return out.slice(0, 12);
      }
    } catch {
      /* fall through to line parsing */
    }
  }
  return t
    .split(/\r?\n/)
    .map((ln) => ln.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
}

// =========================================================================== offline engine
const WEAK_OPENERS: [RegExp, string][] = [
  [/^(was )?responsible for (managing )?/, "Led "],
  [/^worked on /, "Developed "],
  [/^worked with /, "Collaborated with "],
  [/^helped (to )?/, "Contributed to "],
  [/^assisted (in|with) /, "Supported "],
  [/^did /, "Delivered "],
  [/^made /, "Built "],
  [/^involved in /, "Contributed to "],
  [/^participated in /, "Took part in "],
  [/^handled /, "Managed "],
  [/^used /, "Applied "],
  [/^tasked with /, "Owned "],
  [/^i /, ""],
];

const ROLE_SKILLS: [string, string[]][] = [
  ["backend", ["REST API design", "PostgreSQL", "Redis", "Docker", "Kubernetes", "FastAPI", "Spring Boot",
    "Message queues (Kafka/RabbitMQ)", "Unit & integration testing", "CI/CD", "System design", "AWS"]],
  ["frontend", ["React", "TypeScript", "Next.js", "CSS/Tailwind", "Accessibility (WCAG)", "State management",
    "Jest / React Testing Library", "Web performance", "REST/GraphQL", "Figma handoff", "Vite", "Git"]],
  ["data engineer", ["SQL", "Apache Spark", "Airflow", "dbt", "Kafka", "Data modelling", "PostgreSQL",
    "Snowflake / BigQuery", "ETL/ELT pipelines", "Python", "Docker", "Data quality testing"]],
  ["data scien", ["Python", "Pandas", "scikit-learn", "Statistics", "A/B testing", "SQL", "Feature engineering",
    "XGBoost", "Data visualisation", "Jupyter", "Model evaluation", "PyTorch"]],
  ["machine learning", ["PyTorch", "TensorFlow", "scikit-learn", "Transformers / Hugging Face", "MLOps",
    "Model deployment (FastAPI/Docker)", "Experiment tracking (MLflow)", "Feature engineering",
    "LLM fine-tuning", "RAG", "Vector databases", "CUDA basics"]],
  ["ai", ["LLM APIs", "Prompt engineering", "RAG", "LangChain / LlamaIndex", "Vector databases", "PyTorch",
    "Hugging Face", "Evaluation of LLM outputs", "Python", "FastAPI", "Docker", "Embeddings"]],
  ["devops", ["Linux", "Docker", "Kubernetes", "Terraform", "AWS", "CI/CD (GitHub Actions)", "Prometheus",
    "Grafana", "Bash", "Networking basics", "Helm", "Incident response"]],
  ["full stack", ["React", "Node.js", "TypeScript", "PostgreSQL", "REST APIs", "Docker", "Authentication (JWT/OAuth)",
    "Next.js", "Testing", "CI/CD", "Redis", "Cloud deployment"]],
];
const DEFAULT_SKILLS = ["Git", "Python", "SQL", "Data structures & algorithms", "REST APIs", "Linux", "Docker",
  "Unit testing", "Agile / Scrum", "Cloud basics (AWS/GCP)", "Problem solving", "Technical writing"];

const words = (s: string) => new Set(s.split(/\s+/).filter(Boolean));
const STOPWORDS = words(`a an the and or of to in for with on at by from as is are be will you your we our this that
these those it its into over under about across able experience years year work working team teams strong
skills skill knowledge understanding ability including include such using use plus etc must should would
preferred required requirements responsibilities role job candidate candidates ideal looking join us who
what how have has good great excellent new other more least well within per can may also all any both
degree bachelor master related field equivalent opportunity company environment based`);
const EXTRA_STOP = words(`hiring hire we're you'll you're we'll own ownership looking build building develop developing
work help ensure drive deliver write writing make plus bonus nice day days fast paced passionate`);
const TECH_TERMS = new Set([
  ...ROLE_SKILLS.flatMap(([, list]) =>
    list.flatMap((item) => (item.match(/[A-Za-z][A-Za-z0-9+#./-]*/g) ?? []).filter((w) => w.length > 1).map((w) => w.toLowerCase())),
  ),
  ...words(`python java javascript typescript go golang rust c++ c# kotlin swift scala ruby php sql nosql postgresql postgres mysql
mongodb redis kafka rabbitmq spark hadoop airflow dbt snowflake bigquery aws gcp azure docker kubernetes k8s terraform
ansible jenkins git github gitlab ci/cd linux bash react angular vue next.js node.js express django flask fastapi spring
graphql rest grpc microservices api apis etl elt pandas numpy pytorch tensorflow keras scikit-learn llm llms rag nlp
mlops tableau powerbi excel agile scrum jira testing pytest junit selenium security oauth jwt html css tailwind figma`),
]);

function improveBullet(b: string): string {
  let s = b.trim().replace(/\.+$/, "");
  const low = s.toLowerCase();
  for (const [pat, rep] of WEAK_OPENERS) {
    const m = low.match(pat);
    if (m) {
      s = rep + s.slice(m[0].length);
      break;
    }
  }
  s = s.slice(0, 1).toUpperCase() + s.slice(1);
  if (!/\d/.test(s)) s += ", improving [metric] by [X%]";
  return s;
}

function tokens(text: string): string[] {
  const t = text.toLowerCase().replace(/[’'][\p{L}\p{N}_]+/gu, " "); // drop contraction tails: we're -> we
  return (t.match(/[a-z][a-z0-9+#./-]*[a-z0-9+#]|[a-z]/g) ?? []).filter(
    (w) => !STOPWORDS.has(w) && !EXTRA_STOP.has(w) && w.length > 1,
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type KeywordReport = { score: number; matched: string[]; missing: string[] };

/** Local keyword-match score — used by every provider, not only offline.
 *  Keywords = known tech terms in the JD, plus any other word the JD repeats. */
export function keywordReport(resume: unknown, jd: string): KeywordReport {
  const counts = new Map<string, number>();
  for (const t of tokens(jd)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]); // stable: ties keep first-seen order
  const keywords = ranked.filter(([w, c]) => TECH_TERMS.has(w) || c >= 2).map(([w]) => w).slice(0, 25);
  const resumeText = JSON.stringify(resume ?? {}).toLowerCase();
  const matched = keywords.filter((k) => new RegExp(`(?<![a-z0-9])${escapeRe(k)}(?![a-z0-9])`).test(resumeText));
  const missing = keywords.filter((k) => !matched.includes(k));
  const score = keywords.length ? Math.round((100 * matched.length) / keywords.length) : 0;
  return { score, matched, missing };
}

export function offlineSuggest(kind: Kind, ctx: Ctx): string[] {
  const resume = obj(ctx.resume);
  const role = str(ctx.target_role || resume.target_role).trim();
  const skills: string[] = arr(resume.skills).flatMap((g) => arr(obj(g).items).map(str));

  if (kind === "bullets") {
    const item = obj(ctx.item);
    const bullets = arr(item.bullets).map(str).filter((b) => b.trim());
    if (!bullets.length) {
      const what = item.role || item.name || "this work";
      return [
        `Built [feature/system] for ${what} using [tech], serving [N] users`,
        "Improved [metric] by [N%] by [specific change you made]",
        "Collaborated with [team] to deliver [outcome] [N weeks] ahead of schedule",
      ];
    }
    return bullets.map(improveBullet);
  }

  if (kind === "skills") {
    const pool = ROLE_SKILLS.find(([key]) => role.toLowerCase().includes(key))?.[1] ?? DEFAULT_SKILLS;
    const have = new Set(skills.map((x) => x.toLowerCase()));
    return pool.filter((x) => !have.has(x.toLowerCase())).slice(0, 12);
  }

  if (kind === "summary") {
    const headline = role || str(obj(resume.personal).headline) || "Software engineer";
    const top = skills.slice(0, 4).join(", ") || "modern tooling";
    const entries = [...arr(resume.experience), ...arr(resume.projects)].map(obj);
    let evidence = entries.flatMap((e) => arr(e.bullets).map(str)).find((b) => /\d/.test(b)) ?? "";
    evidence = evidence.replace(/\.+$/, "");
    const ev = evidence ? ` Recent work: ${evidence.slice(0, 1).toLowerCase() + evidence.slice(1)}.` : "";
    const edu = obj(arr(resume.education)[0]);
    const eduPart = edu.degree ? `${edu.degree} candidate` : "";
    return [
      `${headline} skilled in ${top}.${ev} Focused on building reliable, well-tested software.`,
      `${eduPart || headline} with hands-on experience in ${top}, seeking a ${role || "software"} role.${ev}`,
      `Results-driven ${headline.toLowerCase()} who turns requirements into shipped features using ${top}.` +
        (ev || " Comfortable owning work end to end, from design to deployment."),
    ];
  }

  // keywords
  const rep = keywordReport(resume, str(ctx.job_description));
  if (!rep.missing.length) return ["Your resume already mentions the main keywords from this job description."];
  return [
    ...rep.missing.slice(0, 8).map((k) => `Add '${k}' where it's truthful (skills list, or a bullet showing you used it)`),
    "Mirror the job title in your headline and summary",
  ];
}

// =========================================================================== request handler
export type SuggestResult = { status: number; body: Record<string, unknown> };

export async function suggest(userId: number, payload: unknown): Promise<SuggestResult> {
  const p = obj(payload);
  const kind = p.kind as Kind;
  if (!KINDS.includes(kind)) return { status: 400, body: { error: `kind must be one of ${KINDS.join(", ")}` } };
  if (p.context !== undefined && p.context !== null && typeof p.context !== "object")
    return { status: 400, body: { error: "context must be an object" } };
  const ctx = obj(p.context);
  if (kind === "keywords" && str(ctx.job_description).trim().length < 30)
    return { status: 400, body: { error: "Paste a job description (at least a few lines) first." } };

  const cfg = config();
  if (!limiter.hit(`ai:${userId}`, cfg.aiRequestsPerHour, 3600))
    return { status: 429, body: { error: "AI request limit reached for this hour. Try again later." } };

  let provider: string = activeProvider(cfg);
  let notice: string | undefined;
  let suggestions: string[] = [];
  if (provider !== "offline") {
    try {
      suggestions = parseSuggestions(await PROVIDERS[provider as ProviderName].call(buildPrompt(kind, ctx), cfg));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`AI provider ${provider} failed: ${msg}`);
      notice = `${provider} was unavailable (${msg}); showing built-in suggestions instead.`;
    }
  }
  if (!suggestions.length) {
    suggestions = offlineSuggest(kind, ctx);
    if (provider !== "offline" && !notice) notice = "The AI returned nothing usable; showing built-in suggestions instead.";
    provider = "offline";
  }

  const body: Record<string, unknown> = { suggestions, provider };
  if (notice) body.notice = notice;
  if (kind === "keywords") body.report = keywordReport(ctx.resume ?? {}, str(ctx.job_description));
  return { status: 200, body };
}
