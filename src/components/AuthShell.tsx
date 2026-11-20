import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import { ResumeView } from "./ResumeView";
import { sampleResume } from "@/lib/resumeModel";

/** Two-column auth layout: form on the left, product pitch on the right (hidden on mobile). */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="auth">
      <div className="auth-main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {children}
          <div className="auth-foot">{footer}</div>
        </div>
      </div>
      <aside className="auth-side" aria-hidden>
        <h2>Write a stronger resume in minutes, not hours.</h2>
        <ul>
          <li>
            <CircleCheck size={20} /> AI rewrites weak bullets into measurable achievements
          </li>
          <li>
            <CircleCheck size={20} /> Match score against any job description
          </li>
          <li>
            <CircleCheck size={20} /> Clean, ATS-friendly PDF export
          </li>
        </ul>
        <div className="paper">
          <ResumeView data={sampleResume()} template="classic" links={false} />
        </div>
      </aside>
    </main>
  );
}
