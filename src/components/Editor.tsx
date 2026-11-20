"use client";
/* Resume editor: form state, debounced autosave, live preview, and the AI suggestion panels. */
import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Award,
  Briefcase,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Download,
  Eye,
  FolderGit2,
  GraduationCap,
  Lightbulb,
  LoaderCircle,
  Maximize2,
  Minus,
  PenLine,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  UserRound,
  Wand2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { ResumeView } from "./ResumeView";
import { TEMPLATES, isTemplate, type ResumeData, type TemplateKey } from "@/lib/resumeModel";

type Resume = { id: number; title: string; template: TemplateKey; data: ResumeData };
type KeywordReport = { score: number; matched: string[]; missing: string[] };
type AIState = {
  loading: boolean;
  suggestions: string[];
  provider?: string;
  notice?: string;
  error?: string;
  report?: KeywordReport;
};
type ListSec = "experience" | "projects" | "education" | "certifications";
type AnyItem = Record<string, string | string[]>;

const SECTIONS: Record<
  ListSec,
  { label: string; icon: LucideIcon; nameField: string; fields: [string, string, string?][]; bullets?: boolean; blank: () => AnyItem }
> = {
  experience: {
    label: "Experience",
    icon: Briefcase,
    nameField: "role",
    fields: [["role", "Job title", "Software Engineer"], ["company", "Company", "Acme Corp"], ["location", "Location"], ["start", "Start", "Jan 2025"], ["end", "End", "Present"]],
    bullets: true,
    blank: () => ({ role: "", company: "", location: "", start: "", end: "", bullets: [""] }),
  },
  projects: {
    label: "Projects",
    icon: FolderGit2,
    nameField: "name",
    fields: [["name", "Project name"], ["tech", "Tech stack", "React, Node.js"], ["link", "Link", "github.com/you/project"]],
    bullets: true,
    blank: () => ({ name: "", tech: "", link: "", bullets: [""] }),
  },
  education: {
    label: "Education",
    icon: GraduationCap,
    nameField: "degree",
    fields: [["degree", "Degree", "B.Tech, Computer Science"], ["school", "College / university"], ["location", "Location"], ["score", "CGPA / %"], ["start", "Start year"], ["end", "End year"]],
    blank: () => ({ degree: "", school: "", location: "", start: "", end: "", score: "" }),
  },
  certifications: {
    label: "Certifications",
    icon: Award,
    nameField: "name",
    fields: [["name", "Certification"], ["issuer", "Issuer"], ["date", "Date"]],
    blank: () => ({ name: "", issuer: "", date: "" }),
  },
};

const PAGE_W = 794;

/** A rough 0–100 completeness score plus the most useful next step. */
function strength(d: ResumeData): { score: number; tip: string | null } {
  const bullets = [...d.experience, ...d.projects].flatMap((e) => e.bullets).filter((b) => b.trim());
  const skillCount = d.skills.reduce((n, g) => n + g.items.length, 0);
  const checks: [boolean, number, string][] = [
    [Boolean(d.personal.full_name && d.personal.headline), 10, "Add your name and a one-line headline."],
    [Boolean(d.personal.email || d.personal.phone), 10, "Add an email or phone number so recruiters can reach you."],
    [d.summary.trim().length >= 80, 15, "Write a 2–3 sentence summary (try ✨ Generate with AI)."],
    [d.experience.length > 0 || d.projects.length > 0, 20, "Add at least one experience or project."],
    [bullets.length >= 3, 15, "Describe your work with 3+ bullet points."],
    [bullets.length > 0 && bullets.filter((b) => /\d/.test(b)).length / bullets.length >= 0.5, 10, "Add numbers to your bullets — metrics stand out."],
    [d.education.length > 0, 10, "Add your education."],
    [skillCount >= 6, 10, "List at least 6 skills (try ✨ Suggest skills)."],
  ];
  const score = checks.reduce((s, [ok, w]) => s + (ok ? w : 0), 0);
  return { score, tip: checks.find(([ok]) => !ok)?.[2] ?? null };
}

export function Editor({ resume, csrf, provider }: { resume: Resume; csrf: string; provider: string }) {
  const [title, setTitle] = useState(resume.title);
  const [template, setTemplate] = useState<TemplateKey>(resume.template);
  const [data, setData] = useState<ResumeData>(resume.data);
  const [open, setOpen] = useState(() => new Set(["personal", "summary", "experience"]));
  const [ai, setAi] = useState<Record<string, AIState>>({});
  const [jobDescription, setJobDescription] = useState("");
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [view, setView] = useState<"edit" | "preview">("edit");

  // ------------------------------------------------------------------ autosave
  const latest = useRef({ title, template, data });
  latest.current = { title, template, data };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const dirty = useRef(false);
  const again = useRef(false);

  const save = useCallback(async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    dirty.current = false;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/resumes/${resume.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(latest.current),
      });
      if (res.status === 401) {
        window.location.href = "/login?next=" + encodeURIComponent(location.pathname);
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      if (!dirty.current) setSaveState("saved");
    } catch {
      dirty.current = true;
      setSaveState("error");
      timer.current = setTimeout(save, 4000);
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  }, [csrf, resume.id]);

  const scheduleSave = useCallback(
    (delay = 700) => {
      dirty.current = true;
      setSaveState("unsaved");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(save, delay);
    },
    [save],
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  /** Make sure the PDF reflects the latest edits before downloading. */
  async function downloadPdf(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!dirty.current && !saving.current) return;
    e.preventDefault();
    const href = e.currentTarget.href;
    const wait = async () => {
      while (saving.current) await new Promise((r) => setTimeout(r, 100));
    };
    await wait();
    if (dirty.current) await save();
    await wait();
    window.location.href = href;
  }

  // ------------------------------------------------------------------ state helpers
  /** Apply a mutation to a copy of the resume data, then autosave. */
  const update = useCallback(
    (fn: (d: ResumeData) => void, delay = 700) => {
      setData((prev) => {
        const next = structuredClone(prev);
        fn(next);
        latest.current = { ...latest.current, data: next };
        return next;
      });
      scheduleSave(delay);
    },
    [scheduleSave],
  );

  const items = (d: ResumeData, sec: ListSec) => d[sec] as unknown as AnyItem[];

  // ------------------------------------------------------------------ AI
  async function requestAI(kind: string, key: string) {
    const context: Record<string, unknown> = { resume: data, target_role: data.target_role };
    if (kind === "bullets") {
      const [sec, i] = key.split(".");
      context.item = items(data, sec as ListSec)[Number(i)];
    }
    if (kind === "keywords") context.job_description = jobDescription;
    setAi((a) => ({ ...a, [key]: { loading: true, suggestions: [] } }));
    let result: AIState;
    try {
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ kind, context }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
      result = { loading: false, suggestions: body.suggestions || [], provider: body.provider, notice: body.notice, report: body.report };
    } catch (err) {
      result = { loading: false, suggestions: [], error: (err as Error).message };
    }
    setAi((a) => ({ ...a, [key]: result }));
  }

  const closeAi = (key: string) =>
    setAi((a) => {
      const n = { ...a };
      delete n[key];
      return n;
    });

  // ------------------------------------------------------------------ list helpers
  function move(sec: ListSec, i: number, dir: number) {
    const to = i + dir;
    update((d) => {
      const l = items(d, sec);
      if (to < 0 || to >= l.length) return;
      [l[i], l[to]] = [l[to], l[i]];
    }, 300);
    // AI panels are keyed by position; drop the ones that would now point at the wrong entry.
    setAi((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== `${sec}.${i}` && k !== `${sec}.${to}`)));
  }

  function removeItem(sec: ListSec | "skills", i: number) {
    if (!window.confirm("Remove this entry?")) return;
    update((d) => (d[sec] as unknown[]).splice(i, 1), 300);
    setAi((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith(sec + "."))));
  }

  const sectionProps = { open, setOpen };

  function bulletsEditor(sec: ListSec, i: number, item: AnyItem) {
    const bullets = item.bullets as string[];
    const key = `${sec}.${i}`;
    const filled = bullets.filter((x) => x.trim()).length;
    const p = ai[key];
    return (
      <>
        <div className="sub-label">
          <span>Bullet points</span>
          <button className="btn btn-sm btn-ai" type="button" onClick={() => requestAI("bullets", key)}>
            <Wand2 size={14} /> Improve with AI
          </button>
        </div>
        {bullets.map((b, j) => (
          <div className="bullet-row" key={j}>
            <span className="bullet-dot" aria-hidden />
            <textarea
              aria-label={`Bullet ${j + 1}`}
              value={b}
              placeholder="Start with an action verb; add a number if you can"
              onChange={(e) => {
                const v = e.target.value;
                update((d) => ((items(d, sec)[i].bullets as string[])[j] = v));
              }}
            />
            <button className="icon-btn danger" type="button" title="Remove bullet" aria-label="Remove bullet" onClick={() => update((d) => (items(d, sec)[i].bullets as string[]).splice(j, 1), 300)}>
              <X size={16} />
            </button>
          </div>
        ))}
        <div className="add-row">
          <button className="btn btn-sm btn-add" type="button" onClick={() => update((d) => (items(d, sec)[i].bullets as string[]).push(""), 300)}>
            <Plus size={14} /> Bullet
          </button>
        </div>
        <AiPanelBox state={p} onClose={() => closeAi(key)}>
          {(s, k) => (
            <div className="ai-suggestion">
              <p>{s}</p>
              <button
                className="btn btn-sm btn-ai"
                type="button"
                onClick={() =>
                  update((d) => {
                    const bs = items(d, sec)[i].bullets as string[];
                    const filledIdx = bs.map((x, n) => (x.trim() ? n : -1)).filter((n) => n >= 0);
                    if (k < filledIdx.length) bs[filledIdx[k]] = s; // replace the k-th written bullet
                    else {
                      const empty = bs.findIndex((x) => !x.trim());
                      if (empty >= 0) bs[empty] = s;
                      else bs.push(s);
                    }
                  }, 300)
                }
              >
                {k < filled ? `Replace #${k + 1}` : "Add"}
              </button>
            </div>
          )}
        </AiPanelBox>
        {p && !p.loading && !p.error && p.suggestions.length > 1 && (
          <div className="ai-actions">
            <button
              className="btn btn-sm btn-ai"
              type="button"
              onClick={() => {
                update((d) => (items(d, sec)[i].bullets = [...p.suggestions]), 300);
                closeAi(key);
              }}
            >
              <Sparkles size={14} /> Replace all bullets
            </button>
          </div>
        )}
      </>
    );
  }

  function listSection(sec: ListSec) {
    const cfg = SECTIONS[sec];
    const list = items(data, sec);
    const noun = cfg.label.toLowerCase().replace(/s$/, "");
    return (
      <SectionBox {...sectionProps} id={sec} icon={cfg.icon} title={cfg.label} count={list.length}>
        {list.map((item, i) => (
          <div className="item" key={i}>
            <div className="item-head">
              <span className="item-name">{(item[cfg.nameField] as string) || `${cfg.label.replace(/s$/, "")} ${i + 1}`}</span>
              <span className="spacer" />
              <button className="icon-btn sm" type="button" title="Move up" aria-label="Move up" disabled={i === 0} onClick={() => move(sec, i, -1)}>
                <ArrowUp size={15} />
              </button>
              <button className="icon-btn sm" type="button" title="Move down" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(sec, i, 1)}>
                <ArrowDown size={15} />
              </button>
              <button className="icon-btn sm danger" type="button" title="Remove" aria-label="Remove" onClick={() => removeItem(sec, i)}>
                <Trash2 size={15} />
              </button>
            </div>
            <div className="grid-2">
              {cfg.fields.map(([f, label, ph]) => (
                <FieldBox key={f} label={label} placeholder={ph} value={item[f] as string} onChange={(v) => update((d) => (items(d, sec)[i][f] = v))} />
              ))}
            </div>
            {cfg.bullets && bulletsEditor(sec, i, item)}
          </div>
        ))}
        <button
          className="btn btn-sm btn-add"
          type="button"
          onClick={() => {
            update((d) => items(d, sec).push(cfg.blank()), 300);
            setOpen((o) => new Set(o).add(sec));
          }}
        >
          <Plus size={14} /> Add {noun}
        </button>
      </SectionBox>
    );
  }

  // ------------------------------------------------------------------ preview scaling + zoom
  const paneRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [pageH, setPageH] = useState(1123);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const page = pageRef.current;
    if (!pane || !page) return;
    const measure = () => {
      if (pane.clientWidth) setFit(Math.min(1, Math.max(0.3, (pane.clientWidth - 48) / PAGE_W)));
      setPageH(page.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);
  const scale = zoom === "fit" ? fit : zoom;
  const stepZoom = (d: number) => setZoom(Math.round(Math.min(2, Math.max(0.3, scale + d)) * 10) / 10);

  // ------------------------------------------------------------------ JSX
  const jd = ai.jd;
  const d = data;
  const st = useMemo(() => strength(data), [data]);
  const SAVE = {
    saved: { icon: <CircleCheck size={13} />, text: "Saved", cls: "" },
    unsaved: { icon: <PenLine size={13} />, text: "Unsaved…", cls: "saving" },
    saving: { icon: <LoaderCircle size={13} className="spin" />, text: "Saving…", cls: "saving" },
    error: { icon: <CircleAlert size={13} />, text: "Save failed — retrying", cls: "error" },
  }[saveState];

  return (
    <div className="editor-shell" data-view={view}>
      <section className="editor-pane" aria-label="Resume editor">
        <div className="editor-toolbar">
          <div className="toolbar-row">
            <Link className="icon-btn" href="/dashboard" title="Back to my resumes" aria-label="Back">
              <ArrowLeft size={18} />
            </Link>
            <input
              className="title-input"
              type="text"
              value={title}
              maxLength={100}
              aria-label="Resume name"
              onChange={(e) => {
                setTitle(e.target.value);
                latest.current = { ...latest.current, title: e.target.value };
                scheduleSave();
              }}
            />
            <span className={`save-state ${SAVE.cls}`} role="status">
              {SAVE.icon}
              {SAVE.text}
            </span>
          </div>
          <div className="toolbar-row">
            <div className="segmented" role="group" aria-label="Template">
              {(Object.entries(TEMPLATES) as [TemplateKey, (typeof TEMPLATES)[TemplateKey]][]).map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={template === k}
                  title={t.description}
                  onClick={() => {
                    if (!isTemplate(k) || k === template) return;
                    setTemplate(k);
                    latest.current = { ...latest.current, template: k };
                    scheduleSave(0);
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <span className="spacer" />
            <div className="segmented view-toggle" role="group" aria-label="View">
              <button type="button" aria-pressed={view === "edit"} onClick={() => setView("edit")}>
                <PenLine size={14} /> <span className="tb-label">Edit</span>
              </button>
              <button type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")}>
                <Eye size={14} /> <span className="tb-label">Preview</span>
              </button>
            </div>
            <a className="btn btn-primary btn-sm" href={`/resumes/${resume.id}/pdf`} onClick={downloadPdf} title="Download PDF">
              <Download size={15} /> <span className="tb-label">PDF</span>
            </a>
          </div>
        </div>

        <div className="strength" aria-label="Resume strength">
          <div className="strength-top">
            <span>Resume strength</span>
            <span className="row" style={{ gap: 8 }}>
              <span className="badge badge-ai" title="AI provider">
                <Sparkles size={11} /> {provider}
              </span>
              <span>{st.score}%</span>
            </span>
          </div>
          <div className="strength-bar">
            <span style={{ width: `${st.score}%` }} />
          </div>
          <div className="strength-tip">
            <Lightbulb size={14} />
            <span>{st.tip ?? "Looks great! Tailor it to a job description below before you apply."}</span>
          </div>
        </div>

        <div className="editor-body">
          <SectionBox {...sectionProps} id="personal" icon={UserRound} title="Personal details">
            <div className="grid-2">
              {(
                [
                  ["full_name", "Full name"],
                  ["headline", "Headline", "Backend Engineer | Python, SQL"],
                  ["email", "Email"],
                  ["phone", "Phone"],
                  ["location", "Location"],
                ] as const
              ).map(([f, label, ph]) => (
                <FieldBox key={f} label={label} placeholder={ph} value={d.personal[f]} onChange={(v) => update((x) => (x.personal[f] = v))} />
              ))}
              <FieldBox label="Target role (used by AI)" placeholder="e.g. Data Engineer" value={d.target_role} onChange={(v) => update((x) => (x.target_role = v))} />
              {(
                [
                  ["linkedin", "LinkedIn", "linkedin.com/in/you"],
                  ["github", "GitHub", "github.com/you"],
                  ["website", "Website", "you.dev"],
                ] as const
              ).map(([f, label, ph]) => (
                <FieldBox key={f} label={label} placeholder={ph} value={d.personal[f]} onChange={(v) => update((x) => (x.personal[f] = v))} />
              ))}
            </div>
          </SectionBox>

          <SectionBox {...sectionProps} id="summary" icon={AlignLeft} title="Professional summary">
            <FieldBox
              label="Summary"
              textarea
              rows={4}
              placeholder="2–3 sentences: who you are, your strongest evidence, what you want next."
              value={d.summary}
              onChange={(v) => update((x) => (x.summary = v))}
            />
            <div className="add-row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-ai" type="button" onClick={() => requestAI("summary", "summary")}>
                <Wand2 size={14} /> Generate with AI
              </button>
            </div>
            <AiPanelBox state={ai.summary} onClose={() => closeAi("summary")}>
              {(s) => (
                <div className="ai-suggestion">
                  <p>{s}</p>
                  <button className="btn btn-sm btn-ai" type="button" onClick={() => update((x) => (x.summary = s), 300)}>
                    Use
                  </button>
                </div>
              )}
            </AiPanelBox>
          </SectionBox>

          {listSection("experience")}
          {listSection("projects")}
          {listSection("education")}

          <SectionBox {...sectionProps} id="skills" icon={Wrench} title="Skills" count={d.skills.length}>
            {d.skills.map((g, i) => (
              <div className="item" key={i}>
                <div className="item-head">
                  <span className="item-name">{g.category || `Group ${i + 1}`}</span>
                  <span className="spacer" />
                  <button className="icon-btn sm danger" type="button" title="Remove" aria-label="Remove" onClick={() => removeItem("skills", i)}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="grid-2" style={{ gridTemplateColumns: "1fr 2fr" }}>
                  <FieldBox label="Category" placeholder="Languages" value={g.category} onChange={(v) => update((x) => (x.skills[i].category = v))} />
                  <SkillsInput items={g.items} onChange={(list) => update((x) => (x.skills[i].items = list))} />
                </div>
              </div>
            ))}
            <div className="add-row">
              <button className="btn btn-sm btn-add" type="button" onClick={() => update((x) => x.skills.push({ category: "", items: [] }), 300)}>
                <Plus size={14} /> Skill group
              </button>
              <button className="btn btn-sm btn-ai" type="button" onClick={() => requestAI("skills", "skills")}>
                <Sparkles size={14} /> Suggest skills
              </button>
            </div>
            <AiPanelBox state={ai.skills} onClose={() => closeAi("skills")} inline>
              {(s) => {
                const have = d.skills.some((g) => g.items.some((x) => x.toLowerCase() === s.toLowerCase()));
                return (
                  <button
                    className={`chip ${have ? "added" : ""}`}
                    type="button"
                    disabled={have}
                    onClick={() =>
                      update((x) => {
                        if (!x.skills.length) x.skills.push({ category: "Skills", items: [] });
                        x.skills[x.skills.length - 1].items.push(s);
                      }, 300)
                    }
                  >
                    {have ? "✓" : "+"} {s}
                  </button>
                );
              }}
            </AiPanelBox>
          </SectionBox>

          {listSection("certifications")}

          <SectionBox {...sectionProps} id="achievements" icon={Trophy} title="Achievements" count={d.achievements.length}>
            {d.achievements.map((a, j) => (
              <div className="bullet-row" key={j}>
                <span className="bullet-dot" aria-hidden />
                <textarea
                  aria-label={`Achievement ${j + 1}`}
                  value={a}
                  placeholder="e.g. Finalist, Smart India Hackathon 2026"
                  onChange={(e) => {
                    const v = e.target.value;
                    update((x) => (x.achievements[j] = v));
                  }}
                />
                <button className="icon-btn danger" type="button" title="Remove" aria-label="Remove" onClick={() => update((x) => x.achievements.splice(j, 1), 300)}>
                  <X size={16} />
                </button>
              </div>
            ))}
            <button className="btn btn-sm btn-add" type="button" onClick={() => update((x) => x.achievements.push(""), 300)}>
              <Plus size={14} /> Achievement
            </button>
          </SectionBox>

          <SectionBox {...sectionProps} id="tailor" icon={Target} title="Tailor to a job description" ai>
            <label htmlFor="jd">Paste the job description</label>
            <textarea id="jd" rows={6} placeholder="Paste the full job posting here…" value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
            <div className="add-row" style={{ marginTop: 10 }}>
              <button
                className="btn btn-sm btn-ai"
                type="button"
                onClick={() => {
                  if (jobDescription.trim().length < 30) {
                    setAi((a) => ({ ...a, jd: { loading: false, suggestions: [], error: "Paste a job description (at least a few lines) first." } }));
                    return;
                  }
                  requestAI("keywords", "jd");
                }}
              >
                <Target size={14} /> Analyze match
              </button>
            </div>
            {jd?.report ? (
              <div className="ai-panel">
                <h4>
                  <Target size={14} /> Match report <span className="small muted">({jd.provider})</span>
                  <button className="icon-btn sm close" type="button" title="Close" aria-label="Close" onClick={() => closeAi("jd")}>
                    <X size={15} />
                  </button>
                </h4>
                {jd.notice && (
                  <div className="ai-notice">
                    <CircleAlert size={14} /> {jd.notice}
                  </div>
                )}
                <div className="score">
                  <div
                    className="score-ring"
                    style={{ ["--p" as string]: jd.report.score, ["--c" as string]: jd.report.score >= 70 ? "var(--ok)" : jd.report.score >= 40 ? "var(--warn)" : "var(--err)" }}
                  >
                    {jd.report.score}%
                  </div>
                  <div className="small">
                    <strong>Keyword match with the job description</strong>
                    <br />
                    <span className="muted">Aim for 70%+, but only add skills you really have.</span>
                  </div>
                </div>
                {jd.report.missing.length > 0 && (
                  <>
                    <div className="kw-group">Missing</div>
                    {jd.report.missing.map((k) => (
                      <span key={k} className="kw miss">
                        {k}
                      </span>
                    ))}
                  </>
                )}
                {jd.report.matched.length > 0 && (
                  <>
                    <div className="kw-group">Found</div>
                    {jd.report.matched.map((k) => (
                      <span key={k} className="kw hit">
                        {k}
                      </span>
                    ))}
                  </>
                )}
                <div className="kw-group" style={{ marginBottom: 8, marginTop: 14 }}>
                  Suggestions
                </div>
                {jd.suggestions.map((s, i) => (
                  <div className="ai-suggestion" key={i}>
                    <p>{s}</p>
                  </div>
                ))}
              </div>
            ) : (
              <AiPanelBox state={jd} onClose={() => closeAi("jd")}>
                {(s) => (
                  <div className="ai-suggestion">
                    <p>{s}</p>
                  </div>
                )}
              </AiPanelBox>
            )}
          </SectionBox>
        </div>
      </section>

      <section className="preview-pane" ref={paneRef} aria-label="Live preview">
        <div className="preview-stage">
          <div style={{ width: PAGE_W * scale, height: pageH * scale, flexShrink: 0 }}>
            <div className="preview-frame preview-scaler" ref={pageRef} style={{ transform: `scale(${scale})` }}>
              <ResumeView data={data} template={template} />
            </div>
          </div>
        </div>
        <div className="zoom-bar" role="toolbar" aria-label="Zoom">
          <button className="icon-btn sm" type="button" aria-label="Zoom out" title="Zoom out" onClick={() => stepZoom(-0.1)}>
            <Minus size={15} />
          </button>
          <span className="val">{Math.round(scale * 100)}%</span>
          <button className="icon-btn sm" type="button" aria-label="Zoom in" title="Zoom in" onClick={() => stepZoom(0.1)}>
            <Plus size={15} />
          </button>
          <span className="sep" />
          <button className="icon-btn sm" type="button" aria-label="Fit to width" title="Fit to width" onClick={() => setZoom("fit")}>
            <Maximize2 size={14} />
          </button>
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ presentational pieces
// Defined at module level so React keeps the same component identity between renders
// (otherwise inputs would remount and lose focus on every keystroke).

function SectionBox({
  id,
  title,
  icon: Icon,
  count,
  ai,
  children,
  open,
  setOpen,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  count?: number;
  ai?: boolean;
  children: ReactNode;
  open: Set<string>;
  setOpen: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  return (
    <details
      className="ed-section"
      open={open.has(id)}
      onToggle={(e) => {
        const isOpen = (e.currentTarget as HTMLDetailsElement).open;
        setOpen((o) => {
          if (o.has(id) === isOpen) return o;
          const n = new Set(o);
          if (isOpen) n.add(id);
          else n.delete(id);
          return n;
        });
      }}
    >
      <summary>
        <span className={`sec-ic ${ai ? "ai" : ""}`}>
          <Icon size={17} />
        </span>
        <span className="sec-title">{title}</span>
        {count != null && <span className="sec-count">{count}</span>}
        <ChevronDown size={18} className="chev" />
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function AiPanelBox({
  state: p,
  onClose,
  inline,
  children,
}: {
  state: AIState | undefined;
  onClose: () => void;
  inline?: boolean;
  children: (s: string, i: number) => ReactNode;
}) {
  if (!p) return null;
  return (
    <div className="ai-panel">
      <h4>
        <Sparkles size={14} /> AI suggestions {p.provider && <span className="small muted">({p.provider})</span>}
        <button className="icon-btn sm close" type="button" title="Close" aria-label="Close" onClick={onClose}>
          <X size={15} />
        </button>
      </h4>
      {p.loading ? (
        <>
          <div className="ai-loading">
            <LoaderCircle size={15} className="spin" /> Thinking…
          </div>
          <div className="shimmer" />
          <div className="shimmer" style={{ width: "80%" }} />
        </>
      ) : p.error ? (
        <div className="small row" style={{ color: "var(--err)", gap: 6 }}>
          <CircleAlert size={15} /> {p.error}
        </div>
      ) : (
        <>
          {p.notice && (
            <div className="ai-notice">
              <CircleAlert size={14} /> {p.notice}
            </div>
          )}
          {inline ? (
            <div>
              {p.suggestions.map((s, i) => (
                <Fragment key={i}>{children(s, i)}</Fragment>
              ))}
            </div>
          ) : (
            p.suggestions.map((s, i) => <Fragment key={i}>{children(s, i)}</Fragment>)
          )}
        </>
      )}
    </div>
  );
}

function FieldBox({
  label,
  value,
  onChange,
  placeholder,
  textarea,
  rows,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id}>{label}</label>
      {textarea ? (
        <textarea id={id} rows={rows ?? 3} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={id} type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

/** Comma-separated skills. Keeps its own draft so typing "Python, " isn't immediately re-formatted. */
function SkillsInput({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const parse = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const id = useId();
  const [draft, setDraft] = useState(items.join(", "));
  // Re-sync when items change from outside (e.g. an AI suggestion was added).
  if (parse(draft).join("\u0000") !== items.join("\u0000")) {
    const next = items.join(", ");
    if (draft !== next) setDraft(next);
  }
  return (
    <div>
      <label htmlFor={id}>Skills (comma separated)</label>
      <input
        id={id}
        type="text"
        value={draft}
        placeholder="Python, SQL, Docker"
        onChange={(e) => {
          setDraft(e.target.value);
          onChange(parse(e.target.value));
        }}
      />
    </div>
  );
}
