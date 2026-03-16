export default function HomePage() {
  const plans = [
    {
      name: "Starter",
      price: "€29",
      period: "/month",
      description: "For solo operators and small studios starting with online booking.",
      features: ["Up to 300 bookings/month", "Core booking funnel", "Email support"],
      recommended: false
    },
    {
      name: "Pro",
      price: "€79",
      period: "/month",
      description: "For growing teams that need stronger automation and operations.",
      features: ["Up to 1500 bookings/month", "Advanced admin workflows", "Priority support"],
      recommended: true
    },
    {
      name: "Business",
      price: "Custom",
      period: "",
      description: "For multi-location setups and high-volume tenant operations.",
      features: ["Unlimited bookings", "Enterprise onboarding", "Dedicated success contact"],
      recommended: false
    }
  ];

  const faq = [
    {
      question: "Can I use one tenant for multiple masters?",
      answer: "Yes. The admin area supports master management, service mapping, and schedule exceptions."
    },
    {
      question: "Is localization included?",
      answer: "Yes. The platform supports IT/EN runtime switching and locale-aware booking communication."
    },
    {
      question: "Does this support WhatsApp and notifications?",
      answer: "Yes. Notification flows and bot integrations are part of the operational platform architecture."
    },
    {
      question: "Can I start with a lightweight setup?",
      answer: "Yes. Starter onboarding is designed for fast launch, then scale into advanced admin workflows."
    }
  ];

  return (
    <main className="gc-container gc-home">
      <section className="gc-card gc-home-hero">
        <div className="gc-home-kicker">Genius Clients • Multi-tenant booking SaaS</div>
        <h1 className="gc-home-title">Convert visitors into confirmed bookings with one unified platform</h1>
        <p className="gc-home-subtitle">
          From public booking to admin operations, Genius Clients gives service businesses a consistent
          workflow to run scheduling, confirmations, and growth.
        </p>
        <div className="gc-home-actions">
          <a href="/auth" className="gc-btn gc-btn-primary">
            Start Free Setup
          </a>
          <a href="/public/book" className="gc-btn gc-btn-secondary">
            View Booking Flow
          </a>
          <a href="/admin" className="gc-btn gc-btn-secondary">
            Explore Admin
          </a>
        </div>
        <div className="gc-home-metrics">
          <article className="gc-home-metric">
            <div className="gc-home-metric-value">+32%</div>
            <div className="gc-home-metric-label">faster booking completion in guided flow</div>
          </article>
          <article className="gc-home-metric">
            <div className="gc-home-metric-value">IT / EN</div>
            <div className="gc-home-metric-label">runtime locale switching</div>
          </article>
          <article className="gc-home-metric">
            <div className="gc-home-metric-value">BFF-first</div>
            <div className="gc-home-metric-label">secure server-mediated API access</div>
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
        <h2 className="gc-home-section-title">How it works</h2>
        <div className="gc-flow-grid">
          <article className="gc-card gc-flow-card">
            <div className="gc-flow-step">01</div>
            <h3 className="gc-feature-title">Attract and route</h3>
            <p className="gc-feature-text">Visitors land on your public page and enter a guided booking flow.</p>
          </article>
          <article className="gc-card gc-flow-card">
            <div className="gc-flow-step">02</div>
            <h3 className="gc-feature-title">Match and schedule</h3>
            <p className="gc-feature-text">Services, masters, and slots are aligned with your tenant schedule rules.</p>
          </article>
          <article className="gc-card gc-flow-card">
            <div className="gc-flow-step">03</div>
            <h3 className="gc-feature-title">Operate and retain</h3>
            <p className="gc-feature-text">
              Admin teams manage bookings, notifications, and updates from one operational panel.
            </p>
          </article>
        </div>
      </section>

      <section className="gc-home-section">
        <h2 className="gc-home-section-title">Plans built for growth</h2>
        <div className="gc-pricing-grid">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className={`gc-card gc-pricing-card${plan.recommended ? " gc-pricing-card-recommended" : ""}`}
            >
              {plan.recommended ? <div className="gc-plan-badge">Recommended</div> : null}
              <h3 className="gc-pricing-name">{plan.name}</h3>
              <p className="gc-pricing-description">{plan.description}</p>
              <p className="gc-pricing-price">
                <span>{plan.price}</span>
                <small>{plan.period}</small>
              </p>
              <ul className="gc-pricing-list">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <a href="/auth" className="gc-btn gc-btn-secondary">
                Choose {plan.name}
              </a>
            </article>
          ))}
        </div>
      </section>

      <section className="gc-home-section">
        <h2 className="gc-home-section-title">FAQ</h2>
        <div className="gc-faq-grid">
          {faq.map((item) => (
            <article key={item.question} className="gc-card gc-faq-card">
              <h3 className="gc-feature-title">{item.question}</h3>
              <p className="gc-feature-text">{item.answer}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="gc-home-section">
        <div className="gc-card gc-home-cta">
          <h2 className="gc-home-section-title">Launch your booking workflow in one stack</h2>
          <p className="gc-home-subtitle">
            Start with auth and booking today, then scale operations with the admin modules as your tenant grows.
          </p>
          <div className="gc-home-actions">
            <a href="/auth" className="gc-btn gc-btn-primary">
              Create Account
            </a>
            <a href="/terms" className="gc-btn gc-btn-secondary">
              Terms of Service
            </a>
            <a href="/privacy" className="gc-btn gc-btn-secondary">
              Privacy Policy
            </a>
          </div>
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

      <div className="gc-card gc-status-card gc-home-section">
        <strong>Current phase:</strong> design migration in progress, foundations + key admin/public
        pages already moved to the new visual system.
      </div>
    </main>
  );
}
