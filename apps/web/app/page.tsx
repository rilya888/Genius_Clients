export default function HomePage() {
  return (
    <main className="gc-container gc-home">
      <section className="gc-card gc-home-hero">
        <div className="gc-home-kicker">Genius Clients • Multi-tenant booking SaaS</div>
        <h1 className="gc-home-title">Booking platform with multi-tenant workflow</h1>
        <p className="gc-home-subtitle">
          Design migration has started. Auth, admin, and public booking flows are available for
          backend-integrated testing while UI foundations are being upgraded.
        </p>
        <div className="gc-home-actions">
          <a href="/auth" className="gc-btn gc-btn-primary">
            Start with Auth
          </a>
          <a href="/admin" className="gc-btn gc-btn-secondary">
            Open Admin
          </a>
          <a href="/public/book" className="gc-btn gc-btn-secondary">
            Try Public Booking
          </a>
          <a href="/privacy" className="gc-btn gc-btn-secondary">
            Privacy Policy
          </a>
          <a href="/terms" className="gc-btn gc-btn-secondary">
            Terms of Service
          </a>
        </div>
        <div className="gc-home-metrics">
          <article className="gc-home-metric">
            <div className="gc-home-metric-value">IT / EN</div>
            <div className="gc-home-metric-label">Runtime locale switching</div>
          </article>
          <article className="gc-home-metric">
            <div className="gc-home-metric-value">BFF-First</div>
            <div className="gc-home-metric-label">Next.js server-mediated API access</div>
          </article>
          <article className="gc-home-metric">
            <div className="gc-home-metric-value">MVP Ready</div>
            <div className="gc-home-metric-label">Booking, admin, and auth flows available</div>
          </article>
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

      <section className="gc-home-section">
        <h2 className="gc-home-section-title">Commercial entry points</h2>
        <div className="gc-feature-grid">
          <article className="gc-card gc-feature-card">
            <h3 className="gc-feature-title">Pricing-ready foundation</h3>
            <p className="gc-feature-text">
              Designed to scale from starter tenants to advanced multi-service businesses with clear
              plan differentiation.
            </p>
          </article>
          <article className="gc-card gc-feature-card">
            <h3 className="gc-feature-title">FAQ and support readiness</h3>
            <p className="gc-feature-text">
              Structured information architecture for onboarding, legal clarity, and support
              deflection.
            </p>
          </article>
          <article className="gc-card gc-feature-card">
            <h3 className="gc-feature-title">Design-system rollout path</h3>
            <p className="gc-feature-text">
              Teal-first visual language is being unified across landing, auth, booking, and admin.
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
