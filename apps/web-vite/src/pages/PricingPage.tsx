import { useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useRevealOnScroll } from "../shared/hooks/useRevealOnScroll";

export function PricingPage() {
  const { t } = useI18n();
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const shellRef = useRevealOnScroll<HTMLElement>();

  const plans = [
    {
      name: t("pricing.plan.starter.name"),
      priceMonthly: 19,
      priceYearly: 15,
      description: t("pricing.plan.starter.description"),
      features: [t("pricing.plan.starter.feature1"), t("pricing.plan.starter.feature2"), t("pricing.plan.starter.feature3")]
    },
    {
      name: t("pricing.plan.pro.name"),
      priceMonthly: 49,
      priceYearly: 39,
      description: t("pricing.plan.pro.description"),
      features: [t("pricing.plan.pro.feature1"), t("pricing.plan.pro.feature2"), t("pricing.plan.pro.feature3")],
      featured: true
    },
    {
      name: t("pricing.plan.business.name"),
      priceMonthly: 99,
      priceYearly: 79,
      description: t("pricing.plan.business.description"),
      features: [
        t("pricing.plan.business.feature1"),
        t("pricing.plan.business.feature2"),
        t("pricing.plan.business.feature3")
      ]
    }
  ];

  return (
    <section ref={shellRef} className="section page-shell reveal-on-scroll">
      <h1>{t("pricing.pageTitle")}</h1>
      <p>{t("pricing.pageSubtitle")}</p>
      <div className="pricing-switch">
        <button type="button" onClick={() => setPeriod("monthly")} data-active={period === "monthly"}>
          {t("pricing.monthly")}
        </button>
        <button type="button" onClick={() => setPeriod("yearly")} data-active={period === "yearly"}>
          {t("pricing.yearly")}
        </button>
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <article key={plan.name} className={`pricing-card card-hover ${plan.featured ? "featured" : ""}`}>
            <h2>{plan.name}</h2>
            <p className="price">€{period === "monthly" ? plan.priceMonthly : plan.priceYearly}</p>
            <p className="status-muted">{t("pricing.perMonth")}</p>
            {period === "yearly" ? <p className="badge-inline">{t("pricing.yearlySave")}</p> : null}
            <p>{plan.description}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Link className="btn btn-primary" to="/register">
              {t("pricing.select")}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
