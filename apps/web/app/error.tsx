"use client";

import Link from "next/link";

export default function GlobalError({
  error: _error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="gc-system-page">
      <section className="gc-card gc-system-card">
        <h1 className="gc-system-title">Something went wrong</h1>
        <p className="gc-system-text">
          An unexpected error occurred while rendering this page.
        </p>
        <div className="gc-home-actions">
          <button className="gc-btn gc-btn-primary" onClick={reset}>
            Retry
          </button>
          <Link href="/" className="gc-btn gc-btn-secondary">
            Back to Home
          </Link>
        </div>
      </section>
    </main>
  );
}
