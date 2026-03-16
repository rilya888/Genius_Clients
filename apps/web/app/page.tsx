import { isUiV2Enabled } from "../lib/ui-flags";

function LegacyLanding() {
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
      <div className="gc-card gc-status-card gc-home-section">
        <strong>Current phase:</strong> design migration in progress, foundations + key admin/public
        pages already moved to the new visual system.
      </div>
    </main>
  );
}

function V2Landing() {
  const trustLogos = ["Company A", "Company B", "Company C", "Company D", "Company E"];

  const steps = [
    {
      step: "01",
      title: "Set up in minutes",
      text: "Configure services, staff, and booking rules from one onboarding flow."
    },
    {
      step: "02",
      title: "Publish your booking page",
      text: "Share a mobile-first page where clients pick service, staff, and time slot."
    },
    {
      step: "03",
      title: "Automate communication",
      text: "Keep clients informed with multilingual reminders and confirmation updates."
    },
    {
      step: "04",
      title: "Scale operations",
      text: "Use dashboard metrics and admin controls to optimize conversion and retention."
    }
  ];

  const featureCards = [
    {
      title: "Smart booking funnel",
      text: "Service -> staff -> date -> slot flow with guardrails for cleaner conversion."
    },
    {
      title: "Team-ready scheduling",
      text: "Working hours, exceptions, and master-service mapping managed in one panel."
    },
    {
      title: "Client-safe communication",
      text: "Consent-aware reminders and notifications aligned with tenant configuration."
    },
    {
      title: "IT/EN localization",
      text: "Runtime locale switching across landing, booking, and administration."
    },
    {
      title: "Operational dashboard",
      text: "Live booking status snapshots, retries, and system visibility for daily ops."
    },
    {
      title: "Secure BFF foundation",
      text: "Session-based architecture and server-mediated API calls by default."
    }
  ];

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
    },
    {
      question: "Is there a yearly billing option?",
      answer: "Yes. Yearly plans are designed for better unit economics and predictable scaling."
    },
    {
      question: "Can I run this with my current Next.js stack?",
      answer: "Yes. The UI targets Next.js App Router + React + plain CSS architecture."
    },
    {
      question: "Will this work for high-volume booking?",
      answer: "Yes. Business setup supports larger throughput and stronger admin observability."
    },
    {
      question: "Do I get migration support?",
      answer: "Yes. Pro and Business include structured onboarding and migration guidance."
    }
  ];

  return (
    <main className="gc-container gc-home">
      <section className="gc-card gc-home-hero gc-v2-fade-up">
        <div className="gc-home-hero-layout">
          <div>
            <div className="gc-home-kicker">Genius Clients • Multi-tenant booking SaaS</div>
            <h1 className="gc-home-title">Convert more visitors into booked appointments</h1>
            <p className="gc-home-subtitle">
              A modern booking product for teams that need fast conversion on the front and clear operational control
              on the back.
            </p>
            <div className="gc-home-actions">
              <a href="/auth" className="gc-btn gc-btn-primary">
                Start Free Setup
              </a>
              <a href="/public/book" className="gc-btn gc-btn-secondary">
                Watch Booking Flow
              </a>
              <a href="/admin" className="gc-btn gc-btn-secondary">
                Open Admin Demo
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
          </div>
          <article className="gc-card gc-home-hero-visual">
            <div className="gc-home-hero-visual-head">
              <strong>Live Product Snapshot</strong>
              <span>Booking + Admin</span>
            </div>
            <div className="gc-home-hero-visual-grid">
              <div className="gc-home-hero-chip">
                <strong>Bookings</strong>
                <span>124 this week</span>
              </div>
              <div className="gc-home-hero-chip">
                <strong>Conversion</strong>
                <span>68%</span>
              </div>
              <div className="gc-home-hero-chip">
                <strong>Avg. response</strong>
                <span>&lt; 5 min</span>
              </div>
              <div className="gc-home-hero-chip">
                <strong>Locale coverage</strong>
                <span>Italian + English</span>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="gc-home-section gc-home-section-soft gc-v2-fade-up gc-v2-fade-up-delay-1">
        <div className="gc-home-proof-head">
          <p className="gc-home-proof-kicker">Trusted by industry leaders</p>
          <div className="gc-home-proof-logos">
            {trustLogos.map((logo) => (
              <span key={logo}>{logo}</span>
            ))}
          </div>
        </div>
        <div className="gc-home-proof-stats">
          <article className="gc-card gc-home-proof-stat">
            <div className="gc-home-proof-value">10,000+</div>
            <div className="gc-home-proof-label">Active businesses</div>
          </article>
          <article className="gc-card gc-home-proof-stat">
            <div className="gc-home-proof-value">500K+</div>
            <div className="gc-home-proof-label">Monthly bookings processed</div>
          </article>
          <article className="gc-card gc-home-proof-stat">
            <div className="gc-home-proof-value">4.9 / 5</div>
            <div className="gc-home-proof-label">Average customer rating</div>
          </article>
        </div>
      </section>

      <section className="gc-home-section gc-v2-fade-up gc-v2-fade-up-delay-1">
        <h2 className="gc-home-section-title">How it works</h2>
        <div className="gc-flow-grid gc-flow-grid-4">
          {steps.map((item) => (
            <article key={item.step} className="gc-card gc-flow-card">
              <div className="gc-flow-step">{item.step}</div>
              <h3 className="gc-feature-title">{item.title}</h3>
              <p className="gc-feature-text">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="gc-home-section gc-v2-fade-up gc-v2-fade-up-delay-2">
        <h2 className="gc-home-section-title">Core capabilities</h2>
        <div className="gc-feature-grid">
          {featureCards.map((feature) => (
            <article key={feature.title} className="gc-card gc-feature-card">
              <h3 className="gc-feature-title">{feature.title}</h3>
              <p className="gc-feature-text">{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="gc-home-section gc-v2-fade-up gc-v2-fade-up-delay-2">
        <h2 className="gc-home-section-title">Product tour</h2>
        <div className="gc-home-tour-grid">
          <article className="gc-card gc-home-tour-copy">
            <h3 className="gc-feature-title">One visual language across landing, auth, and admin</h3>
            <p className="gc-feature-text">
              Keep acquisition and operations aligned: same design language, same status logic, and consistent form
              behavior in every core workflow.
            </p>
            <div className="gc-home-tour-tabs">
              <span data-active="true">Bookings</span>
              <span>Services</span>
              <span>Schedule</span>
              <span>Settings</span>
            </div>
            <ul className="gc-pricing-list">
              <li>Real-time status monitoring</li>
              <li>Fast actions for booking lifecycle</li>
              <li>Tenant-aware configuration controls</li>
            </ul>
          </article>
          <article className="gc-card gc-home-tour-visual">
            <div className="gc-home-tour-visual-title">Dashboard Preview</div>
            <div className="gc-home-tour-visual-body">
              <div className="gc-home-tour-chart" />
              <div className="gc-home-tour-lines">
                <span />
                <span />
                <span />
              </div>
              <div className="gc-home-tour-kpis">
                <div>Queue health: stable</div>
                <div>Weekly growth: +14%</div>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="gc-home-section gc-v2-fade-up">
        <h2 className="gc-home-section-title">Plans built for growth</h2>
        <div className="gc-pricing-toggle">
          <span>Monthly</span>
          <span data-active="true">Yearly (-20%)</span>
        </div>
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

      <section className="gc-home-section gc-v2-fade-up gc-v2-fade-up-delay-1">
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

      <section className="gc-home-section gc-home-section-soft gc-v2-fade-up gc-v2-fade-up-delay-1">
        <div className="gc-home-trust">
          <h2 className="gc-home-section-title">Trust and security</h2>
          <p className="gc-home-subtitle">
            Data flows are protected by server-mediated architecture and compliance-oriented tenant
            controls.
          </p>
          <div className="gc-home-trust-grid">
            <article className="gc-card gc-home-trust-item">
              <h3 className="gc-feature-title">Secure transport</h3>
              <p className="gc-feature-text">Session and request handling are designed for safe production use.</p>
            </article>
            <article className="gc-card gc-home-trust-item">
              <h3 className="gc-feature-title">Privacy aware flows</h3>
              <p className="gc-feature-text">Consent and locale-aware communication are built into booking flow.</p>
            </article>
            <article className="gc-card gc-home-trust-item">
              <h3 className="gc-feature-title">Operational reliability</h3>
              <p className="gc-feature-text">Notifications and retries are observable from the admin control area.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="gc-home-section gc-v2-fade-up gc-v2-fade-up-delay-2">
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
    </main>
  );
}

export default function HomePage() {
  if (!isUiV2Enabled()) {
    return <LegacyLanding />;
  }
  return <V2Landing />;
}
