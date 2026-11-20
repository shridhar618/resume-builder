"use client";
/* Small interactive pieces used by server-rendered pages. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { TEMPLATES } from "@/lib/resumeModel";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  return (
    <Link href={href} className={path === href ? "active" : undefined}>
      {children}
    </Link>
  );
}

/**
 * Flash messages come from a cookie read on the server. Once shown, the cookie is cleared,
 * and the messages hide when the user navigates elsewhere (the root layout persists across
 * client-side navigations, so they'd otherwise linger).
 */
export function Flashes({ messages }: { messages: { type: string; text: string }[] }) {
  const path = usePathname();
  const [shownAt] = useState(path);
  useEffect(() => {
    if (messages.length) document.cookie = "rb_flash=; Max-Age=0; path=/";
  }, [messages]);
  if (!messages.length || path !== shownAt) return null;
  return (
    <div className="flashes">
      {messages.map((m, i) => (
        <div key={i} className={`flash flash-${m.type}`}>
          {m.text}
        </div>
      ))}
    </div>
  );
}

export function SubmitButton({ className = "btn", children, title }: { className?: string; children: ReactNode; title?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending} title={title}>
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

export function NewResumeButton({
  action,
  label,
}: {
  action: (fd: FormData) => Promise<void>;
  label: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button className="btn btn-primary" type="button" onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog ref={ref}>
        <form action={action} className="stack">
          <h2>New resume</h2>
          <div>
            <label htmlFor={titleId}>Name it</label>
            <input id={titleId} name="title" type="text" placeholder="e.g. Backend Engineer – Razorpay" maxLength={100} required />
          </div>
          <div>
            <label>Template</label>
            <div className="template-pick">
              {Object.entries(TEMPLATES).map(([key, t], i) => (
                <label key={key} title={t.description}>
                  <input type="radio" name="template" value={key} defaultChecked={i === 0} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label>Start from</label>
            <div className="template-pick" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <label>
                <input type="radio" name="start_from" value="profile" defaultChecked />
                My profile
              </label>
              <label>
                <input type="radio" name="start_from" value="sample" />
                Sample content
              </label>
            </div>
          </div>
          <div className="row">
            <span className="spacer" />
            <button className="btn" type="button" onClick={() => ref.current?.close()}>
              Cancel
            </button>
            <SubmitButton className="btn btn-primary">Create</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
