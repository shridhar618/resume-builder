"use client";
/* Small interactive pieces used by server-rendered pages. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Check, CircleAlert, CircleCheck, FilePlus2, LoaderCircle, Plus, Sparkles, UserRound, X } from "lucide-react";
import { ResumeView } from "./ResumeView";
import { TEMPLATES, sampleResume, type TemplateKey } from "@/lib/resumeModel";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = path === href || path.startsWith(href + "/");
  return (
    <Link href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

/** Avatar button with a dropdown; closes on outside click, Escape, or navigation. */
export function UserMenu({ initials, name, email, children }: { initials: string; name: string; email: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [path]);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="user-menu" ref={ref}>
      <summary aria-label="Account menu">
        <span className="avatar">{initials}</span>
        <span className="user-name">{name}</span>
      </summary>
      <div className="menu" role="menu">
        <div className="menu-head">
          <strong>{name}</strong>
          <span className="xs muted">{email}</span>
        </div>
        {children}
      </div>
    </details>
  );
}

/**
 * Flash messages come from a cookie read on the server. They show as toasts, the cookie is
 * cleared once shown, and they auto-dismiss (or hide when the user navigates elsewhere).
 */
export function Toasts({ messages }: { messages: { type: string; text: string }[] }) {
  const path = usePathname();
  const [shownAt] = useState(path);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!messages.length) return;
    document.cookie = "rb_flash=; Max-Age=0; path=/";
    const t = setTimeout(() => setHidden(new Set(messages.map((_, i) => i))), 6000);
    return () => clearTimeout(t);
  }, [messages]);
  if (!messages.length || path !== shownAt) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {messages.map((m, i) =>
        hidden.has(i) ? null : (
          <div key={i} className={`toast toast-${m.type}`}>
            {m.type === "error" ? <CircleAlert size={18} /> : <CircleCheck size={18} />}
            <p>{m.text}</p>
            <button className="icon-btn sm" type="button" aria-label="Dismiss" onClick={() => setHidden((h) => new Set(h).add(i))}>
              <X size={15} />
            </button>
          </div>
        ),
      )}
    </div>
  );
}

export function SubmitButton({ className = "btn", children, title }: { className?: string; children: ReactNode; title?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} title={title} aria-label={title}>
      {pending && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}

/** A form that asks for confirmation before submitting (destructive actions). */
export function ConfirmForm({
  action,
  confirm,
  className,
  children,
}: {
  action: (fd: FormData) => Promise<void>;
  confirm: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </form>
  );
}

const SAMPLE = sampleResume();

export function NewResumeButton({
  action,
  label,
  variant = "button",
}: {
  action: (fd: FormData) => Promise<void>;
  label: string;
  variant?: "button" | "card";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = () => ref.current?.showModal();
  return (
    <>
      {variant === "card" ? (
        <button className="new-card" type="button" onClick={open}>
          <span>
            <span className="plus">
              <Plus size={22} />
            </span>
            <strong>{label}</strong>
            <span className="small">Start from your profile or a sample</span>
          </span>
        </button>
      ) : (
        <button className="btn btn-primary" type="button" onClick={open}>
          <Plus size={17} /> {label}
        </button>
      )}
      <dialog ref={ref} aria-labelledby={`${titleId}-h`} onClick={(e) => e.target === ref.current && ref.current?.close()}>
        <form action={action}>
          <div className="dialog-head">
            <div style={{ flex: 1 }}>
              <h2 id={`${titleId}-h`}>Create a new resume</h2>
              <p>Pick a template — you can switch any time.</p>
            </div>
            <button className="icon-btn" type="button" aria-label="Close" onClick={() => ref.current?.close()}>
              <X size={18} />
            </button>
          </div>
          <div className="dialog-body">
            <label htmlFor={titleId}>Resume name</label>
            <input id={titleId} name="title" type="text" placeholder="e.g. Backend Engineer – Razorpay" maxLength={100} required />

            <span className="field-label">Template</span>
            <div className="choice-grid" role="radiogroup" aria-label="Template">
              {(Object.entries(TEMPLATES) as [TemplateKey, (typeof TEMPLATES)[TemplateKey]][]).map(([key, t], i) => (
                <label key={key} className="choice">
                  <input type="radio" name="template" value={key} defaultChecked={i === 0} />
                  <div className="mini" aria-hidden>
                    <ResumeView data={SAMPLE} template={key} links={false} />
                  </div>
                  <span className="choice-title">
                    {t.name} <Check size={15} />
                  </span>
                  <span className="choice-desc">{t.description}</span>
                </label>
              ))}
            </div>

            <span className="field-label">Start from</span>
            <div className="choice-grid two" role="radiogroup" aria-label="Start from">
              <label className="choice">
                <input type="radio" name="start_from" value="profile" defaultChecked />
                <span className="choice-row">
                  <span className="ic">
                    <UserRound size={17} />
                  </span>
                  <span>
                    <span className="choice-title">My profile</span>
                    <span className="choice-desc">Pre-filled with your saved details</span>
                  </span>
                </span>
              </label>
              <label className="choice">
                <input type="radio" name="start_from" value="sample" />
                <span className="choice-row">
                  <span className="ic">
                    <Sparkles size={17} />
                  </span>
                  <span>
                    <span className="choice-title">Sample content</span>
                    <span className="choice-desc">A complete example to edit</span>
                  </span>
                </span>
              </label>
            </div>
          </div>
          <div className="dialog-foot">
            <button className="btn btn-ghost" type="button" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <SubmitButton className="btn btn-primary">
              <FilePlus2 size={16} /> Create resume
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
