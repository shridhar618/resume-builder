import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  CircleCheck,
  Download,
  FileText,
  LayoutTemplate,
  PenLine,
  ShieldCheck,
  Sparkles,
  Target,
  Wand2,
  Zap,
} from "lucide-react";
import { ResumeView } from "@/components/ResumeView";
import { TEMPLATES, sampleResume, type TemplateKey } from "@/lib/resumeModel";
import { getSession } from "@/lib/session";

const FEATURES = [
  { icon: Wand2, tone: "ai", title: "AI bullet rewriting", text: "Turn “worked on the API” into a crisp, metric-led achievement — one bullet or all at once." },
  { icon: Target, tone: "", title: "Job-description match", text: "Paste a posting to get a keyword score, what’s missing, and specific tailoring tips." },
  { icon: Sparkles, tone: "ai", title: "Summaries & skills", text: "Generate three summary options and get skill suggestions for the role you’re targeting." },
  { icon: LayoutTemplate, tone: "", title: "Three pro templates", text: "Modern, Classic and Minimal. Switch any time — the preview updates as you type." },
  { icon: FileText, tone: "ok", title: "ATS-friendly PDFs", text: "Real, selectable text with clickable links. No images, no tables that confuse parsers." },
  { icon: ShieldCheck, tone: "ok", title: "Private by default", text: "Your resumes belong to your account only. Works offline with built-in suggestions." },
] as const;

const STEPS = [
  { icon: PenLine, title: "Fill in your profile", text: "Your details pre-fill every new resume, so you only type them once." },
  { icon: Wand2, title: "Polish with AI", text: "Rewrite bullets, generate a summary and match it against the job you want." },
  { icon: Download, title: "Download the PDF", text: "Export a clean A4 PDF, named after you, ready to upload anywhere." },
];

export default async function Landing() {
  if (await getSession()) redirect("/dashboard");
  const sample = sampleResume();

  return (
    <main>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <span className="pill">
              <span className="badge badge-ai">
                <Sparkles size={12} /> AI
              </span>
              Gemini, OpenAI or Claude — or fully offline
            </span>
            <h1>
              Build a resume <span className="grad-text">recruiters actually read</span>
            </h1>
            <p className="lead">
              Pick a template, let AI tighten your summary and bullet points, check it against a job description, and download a clean,
              ATS-friendly PDF.
            </p>
            <div className="row">
              <Link className="btn btn-primary btn-lg" href="/register">
                Get started — it&apos;s free <ArrowRight size={18} />
              </Link>
              <Link className="btn btn-lg" href="/login">
                Sign in
              </Link>
            </div>
            <div className="checks">
              <span>
                <CircleCheck size={16} /> No credit card
              </span>
              <span>
                <CircleCheck size={16} /> 3 templates
              </span>
              <span>
                <CircleCheck size={16} /> PDF export
              </span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden>
            <div className="paper">
              <ResumeView data={sample} template="modern" links={false} />
            </div>
            <div className="float float-ai">
              <h5>
                <Wand2 size={13} /> AI rewrite
              </h5>
              <div className="from">Worked on the payments API</div>
              <div className="to">Developed the payments API handling 2M transactions/day, cutting p95 latency by 70%</div>
            </div>
            <div className="float float-score">
              <div className="score-ring" style={{ ["--p" as string]: 86 }}>
                86%
              </div>
              <div>
                <h5 style={{ margin: 0 }}>
                  <Target size={13} /> JD match
                </h5>
                <span className="xs muted">Add “Kubernetes” and “Kafka” to reach 95%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">
            <Zap size={14} /> Features
          </span>
          <h2>Everything you need to land the interview</h2>
          <p>Write faster, tailor every application, and export a resume that parses cleanly.</p>
        </div>
        <div className="grid-3">
          {FEATURES.map(({ icon: Icon, tone, title, text }) => (
            <div className="card feature" key={title}>
              <div className={`feature-icon ${tone}`}>
                <Icon size={21} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">
            <LayoutTemplate size={14} /> Templates
          </span>
          <h2>{Object.keys(TEMPLATES).length} templates, real PDFs</h2>
          <p>Each one is tuned for readability and applicant-tracking systems.</p>
        </div>
        <div className="tpl-showcase">
          {(Object.entries(TEMPLATES) as [TemplateKey, (typeof TEMPLATES)[TemplateKey]][]).map(([key, t]) => (
            <div className="tpl-card" key={key}>
              <TemplatePaper template={key} />
              <h3>{t.name}</h3>
              <p>{t.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">
            <ArrowRight size={14} /> How it works
          </span>
          <h2>From blank page to PDF in minutes</h2>
        </div>
        <div className="steps">
          {STEPS.map(({ icon: Icon, title, text }, i) => (
            <div className="card step" key={title}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className="step-num">{i + 1}</div>
                <Icon size={20} className="muted" />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <h2>Your next resume is ten minutes away</h2>
        <p>Create a free account and start from a complete sample.</p>
        <Link className="btn btn-lg" href="/register">
          Create my resume <ArrowRight size={18} />
        </Link>
      </section>

      <footer className="footer">ResumeAI · Built with Next.js · Your data stays in your account</footer>
    </main>
  );
}

/** The sample resume at 40% scale (318 × 400 px window onto the page). */
function TemplatePaper({ template }: { template: TemplateKey }) {
  return (
    <div className="paper">
      <ResumeView data={sampleResume()} template={template} links={false} />
    </div>
  );
}
