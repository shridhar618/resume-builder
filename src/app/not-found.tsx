import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container narrow">
      <div className="card">
        <h1>404</h1>
        <p className="muted">That page doesn&apos;t exist (or isn&apos;t yours).</p>
        <Link className="btn" href="/">
          Go home
        </Link>
      </div>
    </main>
  );
}
