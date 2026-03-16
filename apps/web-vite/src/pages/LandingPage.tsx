import { Link } from "react-router-dom";
import { useRevealOnScroll } from "../shared/hooks/useRevealOnScroll";
import { useI18n } from "../shared/i18n/I18nProvider";

const plans = [
  {
    name: "Starter",
    price: "€19",
    caption: "pricing.plan.starter.description",
    features: ["pricing.plan.starter.feature1", "pricing.plan.starter.feature2", "pricing.plan.starter.feature3"]
  },
  {
    name: "Pro",
    price: "€49",
    caption: "pricing.plan.pro.description",
    features: ["pricing.plan.pro.feature1", "pricing.plan.pro.feature2", "pricing.plan.pro.feature3"],
    featured: true
  },
  {
    name: "Business",
    price: "€99",
    caption: "pricing.plan.business.description",
    features: ["pricing.plan.business.feature1", "pricing.plan.business.feature2", "pricing.plan.business.feature3"]
  }
] as Array<{ name: string; price: string; caption: string; features: string[]; featured?: boolean }>;

export function LandingPage() {
  const { t } = useI18n();
  const heroRef = useRevealOnScroll<HTMLElement>();
  const featuresRef = useRevealOnScroll<HTMLElement>();
  const pricingRef = useRevealOnScroll<HTMLElement>();
  const faqRef = useRevealOnScroll<HTMLElement>();

  const howItWorks = [
    { step: "01", title: t("landing.how.step1.title"), text: t("landing.how.step1.text") },
    { step: "02", title: t("landing.how.step2.title"), text: t("landing.how.step2.text") },
    { step: "03", title: t("landing.how.step3.title"), text: t("landing.how.step3.text") },
    { step: "04", title: t("landing.how.step4.title"), text: t("landing.how.step4.text") }
  ];

  const tourPanels = [
    { title: t("landing.tour.item1.title"), text: t("landing.tour.item1.text") },
    { title: t("landing.tour.item2.title"), text: t("landing.tour.item2.text") },
    { title: t("landing.tour.item3.title"), text: t("landing.tour.item3.text") }
  ];

  const faqs = [
    { q: t("landing.faq.item1.q"), a: t("landing.faq.item1.a") },
    { q: t("landing.faq.item2.q"), a: t("landing.faq.item2.a") },
    { q: t("landing.faq.item3.q"), a: t("landing.faq.item3.a") }
  ];

  const highlights = [
    { icon: "📅", title: t("features.booking"), text: t("landing.featureCard.booking") },
    { icon: "🔔", title: t("features.reminders"), text: t("landing.featureCard.reminders") },
    { icon: "👥", title: t("features.staff"), text: t("landing.featureCard.staff") },
    { icon: "📈", title: t("features.analytics"), text: t("landing.featureCard.analytics") }
  ];

  return (
    <>
      <section ref={heroRef} className="section hero reveal-on-scroll">
        <div>
          <p className="eyebrow">{t("landing.eyebrow")}</p>
          <h1>{t("hero.title")}</h1>
          <p className="hero-subtitle">{t("hero.subtitle")}</p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/register">
              {t("hero.ctaPrimary")}
            </Link>
            <Link className="btn btn-ghost" to="/pricing">
              {t("hero.ctaSecondary")}
            </Link>
          </div>
        </div>
        <div className="hero-panel card-hover">
          <h3>{t("landing.heroOverview.title")}</h3>
          <ul>
            <li>{t("landing.heroOverview.item1")}</li>
            <li>{t("landing.heroOverview.item2")}</li>
            <li>{t("landing.heroOverview.item3")}</li>
          </ul>
          <div className="hero-metrics">
            <div>
              <strong>4.9</strong>
              <span>{t("landing.metrics.rating")}</span>
            </div>
            <div>
              <strong>500K+</strong>
              <span>{t("landing.metrics.bookings")}</span>
            </div>
            <div>
              <strong>97%</strong>
              <span>{t("landing.metrics.delivery")}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section proof">
        <p>{t("proof.title")}</p>
        <div className="proof-logos">
          <span>STYLE LAB</span>
          <span>URBAN CUT</span>
          <span>LAGOON SPA</span>
          <span>NOVA STUDIO</span>
        </div>
      </section>

      <section ref={featuresRef} className="section reveal-on-scroll">
        <h2>{t("features.title")}</h2>
        <div className="feature-grid">
          {highlights.map((item) => (
            <article key={item.title} className="feature-card card-hover">
              <span className="feature-icon" aria-hidden="true">
                {item.icon}
              </span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section reveal-on-scroll">
        <h2>{t("landing.how.title")}</h2>
        <div className="steps-grid">
          {howItWorks.map((item) => (
            <article className="step-card card-hover" key={item.step}>
              <span>{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section reveal-on-scroll">
        <h2>{t("landing.tour.title")}</h2>
        <div className="tour-grid">
          {tourPanels.map((panel) => (
            <article key={panel.title} className="tour-card card-hover">
              <h3>{panel.title}</h3>
              <p>{panel.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section ref={pricingRef} className="section reveal-on-scroll">
        <h2>{t("pricing.title")}</h2>
        <div className="pricing-grid">
          {plans.map((plan) => (
            <article key={plan.name} className={`pricing-card card-hover ${plan.featured ? "featured" : ""}`}>
              {plan.featured ? <span className="badge-inline">{t("pricing.popular")}</span> : null}
              <h3>{plan.name}</h3>
              <p className="price">{plan.price}</p>
              <p>{t(plan.caption)}</p>
              <ul>
                {plan.features.map((feature) => (
                  <li key={feature}>{t(feature)}</li>
                ))}
              </ul>
              <Link className="btn btn-primary" to="/register">
                {t("landing.choosePlan")}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section ref={faqRef} className="section reveal-on-scroll">
        <h2>{t("faq.title")}</h2>
        <div className="faq-list">
          {faqs.map((item) => (
            <details key={item.q} className="faq-item card-hover">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section final-cta">
        <h2>{t("final.title")}</h2>
        <Link className="btn btn-primary" to="/register">
          {t("final.cta")}
        </Link>
      </section>

      <section className="section trust-section">
        <article className="trust-card card-hover">
          <h3>{t("landing.trust.item1.title")}</h3>
          <p>{t("landing.trust.item1.text")}</p>
        </article>
        <article className="trust-card card-hover">
          <h3>{t("landing.trust.item2.title")}</h3>
          <p>{t("landing.trust.item2.text")}</p>
        </article>
      </section>

    </>
  );
}
