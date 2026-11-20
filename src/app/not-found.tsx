import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="notfound">
      <div className="code grad-text">404</div>
      <h1>Page not found</h1>
      <p className="muted">That page doesn&apos;t exist (or isn&apos;t yours).</p>
      <Link className="btn" href="/">
        <ArrowLeft size={16} /> Go home
      </Link>
    </main>
  );
}
