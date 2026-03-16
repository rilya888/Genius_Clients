export default function HomePage() {
  return (
    <main className="gc-container gc-home">
      <section className="gc-card gc-home-hero">
        <h1 className="gc-home-title">Booking platform with multi-tenant workflow</h1>
        <p className="gc-home-subtitle">
          Design migration has started. Auth, admin, and public booking flows are available for
          backend-integrated testing while UI foundations are being upgraded.
        </p>
        <div className="gc-home-actions">
          <a href="/auth" className="gc-btn gc-btn-primary">
            Open Auth
          </a>
          <a href="/admin" className="gc-btn gc-btn-secondary">
            Open Admin
          </a>
          <a href="/public/book" className="gc-btn gc-btn-secondary">
            Open Public Booking
          </a>
          <a href="/privacy" className="gc-btn gc-btn-secondary">
            Privacy Policy
          </a>
          <a href="/terms" className="gc-btn gc-btn-secondary">
            Terms of Service
          </a>
        </div>
      </section>
      <section className="gc-home-section">
        <h2 className="gc-home-section-title">Core capabilities</h2>
        <div className="gc-feature-grid">
          <article className="gc-card gc-feature-card">
            <h3 className="gc-feature-title">Public Booking</h3>
            <p className="gc-feature-text">
              Service and master selection, slot discovery, E.164 phone validation, and consent
              capture.
            </p>
          </article>
          <article className="gc-card gc-feature-card">
            <h3 className="gc-feature-title">Admin Operations</h3>
            <p className="gc-feature-text">
              Masters, services, schedules, exceptions, bookings, and notifications in one control
              space.
            </p>
          </article>
          <article className="gc-card gc-feature-card">
            <h3 className="gc-feature-title">Localization IT/EN</h3>
            <p className="gc-feature-text">
              Runtime locale switching via UI cookie and query param, designed for multi-tenant
              expansion.
            </p>
          </article>
        </div>
      </section>

      <div className="gc-home-gap" />
      <div className="gc-card gc-status-card">
        <strong>Current phase:</strong> design migration in progress, foundations + key admin/public
        pages already moved to the new visual system.
      </div>
    </main>
  );
}
