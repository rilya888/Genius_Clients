import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listPublicPricingPlans, trackMarketingEvent } from "../shared/api/marketingApi";
import { useRevealOnScroll } from "../shared/hooks/useRevealOnScroll";
import { useI18n } from "../shared/i18n/I18nProvider";

type PublicPlan = Awaited<ReturnType<typeof listPublicPricingPlans>>[number];

const canonicalPlanOrder = ["starter", "pro", "business", "enterprise"] as const;

export function LandingPage() {
  const { t } = useI18n();
  const heroRef = useRevealOnScroll<HTMLElement>();
  const pricingRef = useRevealOnScroll<HTMLElement>();
  const [plans, setPlans] = useState<PublicPlan[]>([]);

  useEffect(() => {
    let cancelled = false;
    listPublicPricingPlans()
      .then((items) => {
        if (cancelled) {
          return;
        }
        const sorted = [...items].sort(
          (left, right) => canonicalPlanOrder.indexOf(left.code as (typeof canonicalPlanOrder)[number]) - canonicalPlanOrder.indexOf(right.code as (typeof canonicalPlanOrder)[number])
        );
        setPlans(sorted);
        void trackMarketingEvent({
          event: "landing_pricing_plan_view",
          payload: {
            count: sorted.length,
            codes: sorted.map((item) => item.code)
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPlans([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const verticals = useMemo(
    () => [
      { title: t("landing.vertical.salon.title"), text: t("landing.vertical.salon.text") },
      { title: t("landing.vertical.auto.title"), text: t("landing.vertical.auto.text") },
      { title: t("landing.vertical.medical.title"), text: t("landing.vertical.medical.text") },
      { title: t("landing.vertical.wellness.title"), text: t("landing.vertical.wellness.text") },
      { title: t("landing.vertical.generic.title"), text: t("landing.vertical.generic.text") }
    ],
    [t]
  );

  const whatsappFlow = useMemo(
    () => [
      { step: "01", title: t("landing.whatsapp.step1.title"), text: t("landing.whatsapp.step1.text") },
      { step: "02", title: t("landing.whatsapp.step2.title"), text: t("landing.whatsapp.step2.text") },
      { step: "03", title: t("landing.whatsapp.step3.title"), text: t("landing.whatsapp.step3.text") },
      { step: "04", title: t("landing.whatsapp.step4.title"), text: t("landing.whatsapp.step4.text") }
    ],
    [t]
  );

  const operations = useMemo(
    () => [
      { title: t("landing.ops.item1.title"), text: t("landing.ops.item1.text") },
      { title: t("landing.ops.item2.title"), text: t("landing.ops.item2.text") },
      { title: t("landing.ops.item3.title"), text: t("landing.ops.item3.text") },
      { title: t("landing.ops.item4.title"), text: t("landing.ops.item4.text") }
    ],
    [t]
  );

  return (
    <>
      <section ref={heroRef} className="section hero reveal-on-scroll">
        <div>
          <p className="eyebrow">{t("landing.eyebrow")}</p>
          <h1>{t("landing.v2.title")}</h1>
          <p className="hero-subtitle">{t("landing.v2.subtitle")}</p>
          <div className="hero-actions">
            <Link
              className="btn btn-primary"
              to="/register"
              onClick={() => void trackMarketingEvent({ event: "landing_cta_start_free_click" })}
            >
              {t("hero.ctaPrimary")}
            </Link>
            <Link className="btn btn-ghost" to="/pricing">
              {t("hero.ctaSecondary")}
            </Link>
          </div>
        </div>
        <div className="hero-panel card-hover">
          <h3>{t("landing.v2.heroPanelTitle")}</h3>
          <ul>
            <li>{t("landing.v2.heroPanelItem1")}</li>
            <li>{t("landing.v2.heroPanelItem2")}</li>
            <li>{t("landing.v2.heroPanelItem3")}</li>
          </ul>
        </div>
      </section>

      <section className="section reveal-on-scroll">
        <h2>{t("landing.v2.verticalsTitle")}</h2>
        <div className="feature-grid">
          {verticals.map((item) => (
            <article className="feature-card card-hover" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section reveal-on-scroll">
        <div className="inline-actions" style={{ justifyContent: "space-between", alignItems: "end" }}>
          <div>
            <h2>{t("landing.whatsapp.title")}</h2>
            <p className="status-muted">{t("landing.whatsapp.subtitle")}</p>
          </div>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => void trackMarketingEvent({ event: "landing_whatsapp_flow_expand" })}
          >
            {t("landing.whatsapp.track")}
          </button>
        </div>
        <div className="steps-grid">
          {whatsappFlow.map((item) => (
            <article className="step-card card-hover" key={item.step}>
              <span>{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section reveal-on-scroll">
        <h2>{t("landing.ops.title")}</h2>
        <div className="tour-grid">
          {operations.map((item) => (
            <article className="tour-card card-hover" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section ref={pricingRef} className="section reveal-on-scroll">
        <h2>{t("pricing.title")}</h2>
        <p className="status-muted">{t("landing.v2.pricingSubtitle")}</p>
        <div className="pricing-grid">
          {plans.map((plan) => {
            const isEnterprise = plan.isEnterprise;
            const featured = plan.code === "pro";
            const price = isEnterprise ? t("pricing.enterprise.contactOnly") : `€${(plan.priceCents / 100).toFixed(0)}`;
            return (
              <article key={plan.code} className={`pricing-card card-hover ${featured ? "featured" : ""}`}>
                {featured ? <span className="badge-inline">{t("pricing.popular")}</span> : null}
                <h3>{t(`pricing.plan.${plan.code}.name`)}</h3>
                <p className="price">{price}</p>
                {!isEnterprise ? <p className="status-muted">{t("pricing.perMonth")}</p> : null}
                <p>{t(`pricing.plan.${plan.code}.description`)}</p>
                <ul>
                  <li>{t(`pricing.plan.${plan.code}.feature1`)}</li>
                  <li>{t(`pricing.plan.${plan.code}.feature2`)}</li>
                  <li>{t(`pricing.plan.${plan.code}.feature3`)}</li>
                </ul>
                {isEnterprise ? (
                  <Link
                    className="btn btn-primary"
                    to="/contact"
                    onClick={() => void trackMarketingEvent({ event: "landing_cta_enterprise_click" })}
                  >
                    {t("pricing.enterprise.cta")}
                  </Link>
                ) : (
                  <Link
                    className="btn btn-primary"
                    to="/register"
                    onClick={() => void trackMarketingEvent({ event: "landing_cta_start_free_click", payload: { planCode: plan.code } })}
                  >
                    {t("pricing.select")}
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="section reveal-on-scroll">
        <h2>{t("faq.title")}</h2>
        <div className="faq-list">
          <details className="faq-item card-hover" open>
            <summary>{t("landing.v2.faq1.q")}</summary>
            <p>{t("landing.v2.faq1.a")}</p>
          </details>
          <details className="faq-item card-hover">
            <summary>{t("landing.v2.faq2.q")}</summary>
            <p>{t("landing.v2.faq2.a")}</p>
          </details>
          <details className="faq-item card-hover">
            <summary>{t("landing.v2.faq3.q")}</summary>
            <p>{t("landing.v2.faq3.a")}</p>
          </details>
        </div>
      </section>

      <section className="section final-cta">
        <h2>{t("final.title")}</h2>
        <div className="hero-actions" style={{ justifyContent: "center" }}>
          <Link
            className="btn btn-primary"
            to="/register"
            onClick={() => void trackMarketingEvent({ event: "landing_cta_start_free_click" })}
          >
            {t("final.cta")}
          </Link>
          <Link
            className="btn btn-ghost"
            to="/contact"
            onClick={() => void trackMarketingEvent({ event: "landing_cta_enterprise_click" })}
          >
            {t("landing.v2.contactAdmin")}
          </Link>
        </div>
      </section>
    </>
  );
}

