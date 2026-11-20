"use client";
/* Resume editor: form state, debounced autosave, live preview, and the AI suggestion panels. */
import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
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

const SECTIONS: Record<ListSec, { label: string; fields: [string, string][]; bullets?: boolean; blank: () => AnyItem }> = {
  experience: {
    label: "Experience",
    fields: [["role", "Job title"], ["company", "Company"], ["location", "Location"], ["start", "Start (e.g. Jan 2025)"], ["end", "End (or Present)"]],
    bullets: true,
    blank: () => ({ role: "", company: "", location: "", start: "", end: "", bullets: [""] }),
  },
  projects: {
    label: "Projects",
    fields: [["name", "Project name"], ["tech", "Tech stack"], ["link", "Link (GitHub / demo)"]],
    bullets: true,
    blank: () => ({ name: "", tech: "", link: "", bullets: [""] }),
  },
  education: {
    label: "Education",
    fields: [["degree", "Degree"], ["school", "College / university"], ["location", "Location"], ["score", "CGPA / %"], ["start", "Start year"], ["end", "End year"]],
    blank: () => ({ degree: "", school: "", location: "", start: "", end: "", score: "" }),
  },
  certifications: {
    label: "Certifications",
    fields: [["name", "Certification"], ["issuer", "Issuer"], ["date", "Date"]],
    blank: () => ({ name: "", issuer: "", date: "" }),
  },
};

const PAGE_W = 794;

export function Editor({ resume, csrf, provider }: { resume: Resume; csrf: string; provider: string }) {
  const [title, setTitle] = useState(resume.title);
  const [template, setTemplate] = useState<TemplateKey>(resume.template);
  const [data, setData] = useState<ResumeData>(resume.data);
  const [open, setOpen] = useState(() => new Set(["personal", "summary", "experience"]));
  const [ai, setAi] = useState<Record<string, AIState>>({});
  const [jobDescription, setJobDescription] = useState("");
  const [saveState, setSaveState] = useState<{ text: string; cls: string }>({ text: "Saved", cls: "" });

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
    setSaveState({ text: "Saving…", cls: "saving" });
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
      if (!dirty.current) setSaveState({ text: "Saved", cls: "" });
    } catch {
      dirty.current = true;
      setSaveState({ text: "Save failed — retrying", cls: "error" });
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
      setSaveState({ text: "Unsaved…", cls: "saving" });
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

  // ------------------------------------------------------------------ render pieces
  const sectionProps = { open, setOpen };

  function bulletsEditor(sec: ListSec, i: number, item: AnyItem) {
    const bullets = item.bullets as string[];
    const key = `${sec}.${i}`;
    const filled = bullets.filter((x) => x.trim()).length;
    const p = ai[key];
    return (
      <>
        <label style={{ marginTop: 10 }}>Bullet points</label>
        {bullets.map((b, j) => (
          <div className="bullet-row" key={j}>
            <textarea
              aria-label={`Bullet ${j + 1}`}
              value={b}
              placeholder="Start with an action verb; add a number if you can"
              onChange={(e) => {
                const v = e.target.value;
                update((d) => ((items(d, sec)[i].bullets as string[])[j] = v));
              }}
            />
            <button className="icon-btn danger" type="button" title="Remove bullet" onClick={() => update((d) => (items(d, sec)[i].bullets as string[]).splice(j, 1), 300)}>
              ✕
            </button>
          </div>
        ))}
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" type="button" onClick={() => update((d) => (items(d, sec)[i].bullets as string[]).push(""), 300)}>
            + Bullet
          </button>
          <button className="btn btn-sm btn-ai" type="button" onClick={() => requestAI("bullets", key)}>
            ✨ Improve with AI
          </button>
        </div>
        <AiPanelBox state={ai[key]} onClose={() => closeAi(key)}>
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
              Replace all bullets
            </button>
          </div>
        )}
      </>
    );
  }

  function listSection(sec: ListSec) {
    const cfg = SECTIONS[sec];
    const list = items(data, sec);
    return (
      <SectionBox {...sectionProps} id={sec} title={cfg.label} count={list.length}>
        {list.map((item, i) => (
          <div className="item" key={i}>
            <div className="item-head">
              #{i + 1} <span className="spacer" />
              <button className="icon-btn" type="button" title="Move up" disabled={i === 0} onClick={() => move(sec, i, -1)}>
                ↑
              </button>
              <button className="icon-btn" type="button" title="Move down" disabled={i === list.length - 1} onClick={() => move(sec, i, 1)}>
                ↓
              </button>
              <button className="icon-btn danger" type="button" title="Remove" onClick={() => removeItem(sec, i)}>
                🗑
              </button>
            </div>
            <div className="grid-2">
              {cfg.fields.map(([f, label]) => (
                <FieldBox key={f} label={label} value={item[f] as string} onChange={(v) => update((d) => (items(d, sec)[i][f] = v))} />
              ))}
            </div>
            {cfg.bullets && bulletsEditor(sec, i, item)}
          </div>
        ))}
        <button
          className="btn btn-sm"
          type="button"
          onClick={() => {
            update((d) => items(d, sec).push(cfg.blank()), 300);
            setOpen((o) => new Set(o).add(sec));
          }}
        >
          + Add {cfg.label.toLowerCase().replace(/s$/, "")}
        </button>
      </SectionBox>
    );
  }

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

  // ------------------------------------------------------------------ preview scaling
  const paneRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pageH, setPageH] = useState(1123);
  useLayoutEffect(() => {
    const pane = paneRef.current;
    const page = pageRef.current;
    if (!pane || !page) return;
    const measure = () => {
      setScale(Math.min(1, (pane.clientWidth - 48) / PAGE_W));
      setPageH(page.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    ro.observe(page);
    return () => ro.disconnect();
  }, []);

  // ------------------------------------------------------------------ JSX
  const jd = ai.jd;
  const d = data;

  return (
    <div className="editor-shell">
      <section className="editor-pane" aria-label="Resume editor">
        <div className="editor-toolbar">
          <div className="row" style={{ gap: 8 }}>
            <Link className="icon-btn" href="/dashboard" title="Back to my resumes" aria-label="Back">
              ←
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
            <span className={`save-state ${saveState.cls}`}>{saveState.text}</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <label htmlFor="template" style={{ margin: 0 }}>
              Template
            </label>
            <select
              id="template"
              style={{ width: "auto" }}
              value={template}
              onChange={(e) => {
                if (!isTemplate(e.target.value)) return;
                setTemplate(e.target.value);
                latest.current = { ...latest.current, template: e.target.value };
                scheduleSave(0);
              }}
            >
              {Object.entries(TEMPLATES).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="spacer" />
            <span className="badge badge-ai" title="AI provider">
              AI: {provider}
            </span>
            <a className="btn btn-primary btn-sm" href={`/resumes/${resume.id}/pdf`} onClick={downloadPdf}>
              ⬇ Download PDF
            </a>
          </div>
        </div>

        <div className="editor-body">
          <SectionBox {...sectionProps} id="personal" title="Personal details">
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
                  ["linkedin", "LinkedIn"],
                  ["github", "GitHub"],
                  ["website", "Website"],
                ] as const
              ).map(([f, label]) => (
                <FieldBox key={f} label={label} value={d.personal[f]} onChange={(v) => update((x) => (x.personal[f] = v))} />
              ))}
            </div>
          </SectionBox>

          <SectionBox {...sectionProps} id="summary" title="Professional summary">
            <FieldBox
              label="Summary"
              textarea
              rows={4}
              placeholder="2–3 sentences: who you are, your strongest evidence, what you want next."
              value={d.summary}
              onChange={(v) => update((x) => (x.summary = v))}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-ai" type="button" onClick={() => requestAI("summary", "summary")}>
                ✨ Generate with AI
              </button>
            </div>
            <AiPanelBox state={ai["summary"]} onClose={() => closeAi("summary")}>
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

          <SectionBox {...sectionProps} id="skills" title="Skills" count={d.skills.length}>
            {d.skills.map((g, i) => (
              <div className="item" key={i}>
                <div className="item-head">
                  Group {i + 1}
                  <span className="spacer" />
                  <button className="icon-btn danger" type="button" title="Remove" onClick={() => removeItem("skills", i)}>
                    🗑
                  </button>
                </div>
                <div className="grid-2" style={{ gridTemplateColumns: "1fr 2fr" }}>
                  <FieldBox label="Category" placeholder="Languages" value={g.category} onChange={(v) => update((x) => (x.skills[i].category = v))} />
                  <SkillsInput items={g.items} onChange={(list) => update((x) => (x.skills[i].items = list))} />
                </div>
              </div>
            ))}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn btn-sm" type="button" onClick={() => update((x) => x.skills.push({ category: "", items: [] }), 300)}>
                + Skill group
              </button>
              <button className="btn btn-sm btn-ai" type="button" onClick={() => requestAI("skills", "skills")}>
                ✨ Suggest skills
              </button>
            </div>
            <AiPanelBox state={ai["skills"]} onClose={() => closeAi("skills")}>
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

          <SectionBox {...sectionProps} id="achievements" title="Achievements" count={d.achievements.length}>
            {d.achievements.map((a, j) => (
              <div className="bullet-row" key={j}>
                <textarea
                  aria-label={`Achievement ${j + 1}`}
                  value={a}
                  placeholder="e.g. Finalist, Smart India Hackathon 2026"
                  onChange={(e) => {
                    const v = e.target.value;
                    update((x) => (x.achievements[j] = v));
                  }}
                />
                <button className="icon-btn danger" type="button" title="Remove" onClick={() => update((x) => x.achievements.splice(j, 1), 300)}>
                  ✕
                </button>
              </div>
            ))}
            <button className="btn btn-sm" type="button" onClick={() => update((x) => x.achievements.push(""), 300)}>
              + Achievement
            </button>
          </SectionBox>

          <SectionBox {...sectionProps} id="tailor" title="🎯 Tailor to a job description">
            <label htmlFor="jd">Paste the job description</label>
            <textarea id="jd" rows={6} placeholder="Paste the full job posting here…" value={jobDescription} onChange={(e) => setJobDescription(e.target.value)} />
            <div className="row" style={{ marginTop: 8 }}>
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
                Analyze match
              </button>
            </div>
            {jd?.report ? (
              <div className="ai-panel">
                <h4>
                  🎯 Match report <span className="small muted">({jd.provider})</span>
                  <button className="icon-btn close" type="button" title="Close" onClick={() => closeAi("jd")}>
                    ✕
                  </button>
                </h4>
                {jd.notice && <div className="ai-notice">{jd.notice}</div>}
                <div className="score">
                  <div className="score-ring" style={{ ["--p" as string]: jd.report.score }}>
                    {jd.report.score}%
                  </div>
                  <div className="small">
                    Keyword match with the job description.
                    <br />
                    <span className="muted">Aim for 70%+, but only add skills you really have.</span>
                  </div>
                </div>
                {jd.report.missing.length > 0 && (
                  <>
                    <div className="small" style={{ marginBottom: 4 }}>
                      <b>Missing</b>
                    </div>
                    {jd.report.missing.map((k) => (
                      <span key={k} className="kw miss">
                        {k}
                      </span>
                    ))}
                  </>
                )}
                {jd.report.matched.length > 0 && (
                  <>
                    <div className="small" style={{ margin: "6px 0 4px" }}>
                      <b>Found</b>
                    </div>
                    {jd.report.matched.map((k) => (
                      <span key={k} className="kw hit">
                        {k}
                      </span>
                    ))}
                  </>
                )}
                <div className="small" style={{ margin: "10px 0 6px" }}>
                  <b>Suggestions</b>
                </div>
                {jd.suggestions.map((s, i) => (
                  <div className="ai-suggestion" key={i}>
                    <p>{s}</p>
                  </div>
                ))}
              </div>
            ) : (
              <AiPanelBox state={ai["jd"]} onClose={() => closeAi("jd")}>
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
        <div style={{ width: PAGE_W * scale, height: pageH * scale, flexShrink: 0 }}>
          <div className="preview-frame preview-scaler" ref={pageRef} style={{ transform: `scale(${scale})` }}>
            <ResumeView data={data} template={template} />
          </div>
        </div>
      </section>
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

// ------------------------------------------------------------------ presentational pieces
// Defined at module level so React keeps the same component identity between renders
// (otherwise inputs would remount and lose focus on every keystroke).

function SectionBox({ id, title, count, children, open, setOpen }: {
  id: string;
  title: string;
  count?: number;
  children: ReactNode;
  open: Set<string>;
  setOpen: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  return (
    <details
      className="section"
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
        {title} {count != null && <span className="count">({count})</span>}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function AiPanelBox({ state: p, onClose, children }: {
  state: AIState | undefined;
  onClose: () => void;
  children: (s: string, i: number) => ReactNode;
}) {
  if (!p) return null;
  return (
    <div className="ai-panel">
      <h4>
        ✨ AI suggestions {p.provider && <span className="small muted">({p.provider})</span>}
        <button className="icon-btn close" type="button" title="Close" onClick={onClose}>
          ✕
        </button>
      </h4>
      {p.loading ? (
        <div className="small muted">
          <span className="spinner" /> Thinking…
        </div>
      ) : p.error ? (
        <div className="small" style={{ color: "var(--err)" }}>
          {p.error}
        </div>
      ) : (
        <>
          {p.notice && <div className="ai-notice">{p.notice}</div>}
          {p.suggestions.map((s, i) => (
            <Fragment key={i}>{children(s, i)}</Fragment>
          ))}
        </>
      )}
    </div>
  );
}

function FieldBox({ label, value, onChange, placeholder, textarea, rows, className }: {
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
