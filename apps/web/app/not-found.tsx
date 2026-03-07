import Link from "next/link";

export default function NotFound() {
  return (
    <main className="gc-system-page">
      <section className="gc-card gc-system-card">
        <h1 className="gc-system-title">Page not found</h1>
        <p className="gc-system-text">
          The page you are looking for does not exist or has been moved.
        </p>
        <div className="gc-home-actions">
          <Link href="/" className="gc-btn gc-btn-primary">
            Back to Home
          </Link>
          <Link href="/auth" className="gc-btn gc-btn-secondary">
            Open Auth
          </Link>
        </div>
      </section>
    </main>
  );
}
