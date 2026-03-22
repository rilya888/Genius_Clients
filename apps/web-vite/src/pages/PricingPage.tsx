import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { listPublicPricingPlans, trackMarketingEvent } from "../shared/api/marketingApi";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useRevealOnScroll } from "../shared/hooks/useRevealOnScroll";

type PublicPlan = Awaited<ReturnType<typeof listPublicPricingPlans>>[number];

export function PricingPage() {
  const { t } = useI18n();
  const shellRef = useRevealOnScroll<HTMLElement>();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listPublicPricingPlans()
      .then((items) => {
        if (cancelled) {
          return;
        }
        setPlans(items);
        void trackMarketingEvent({
          event: "landing_pricing_plan_view",
          payload: {
            source: "pricing_page",
            count: items.length
          }
        });
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedPlans = useMemo(() => {
    const order = ["starter", "pro", "business", "enterprise"];
    return [...plans].sort((left, right) => order.indexOf(left.code) - order.indexOf(right.code));
  }, [plans]);

  return (
    <section ref={shellRef} className="section page-shell reveal-on-scroll">
      <h1>{t("pricing.pageTitle")}</h1>
      <p>{t("pricing.pageSubtitle")}</p>
      {loading ? <p>{t("common.loadingDots")}</p> : null}
      <div className="pricing-grid">
        {sortedPlans.map((plan) => {
          const isEnterprise = plan.isEnterprise;
          const featured = plan.code === "pro";
          return (
            <article key={plan.code} className={`pricing-card card-hover ${featured ? "featured" : ""}`}>
              {featured ? <span className="badge-inline">{t("pricing.popular")}</span> : null}
              <h2>{t(`pricing.plan.${plan.code}.name`)}</h2>
              {isEnterprise ? (
                <p className="price">{t("pricing.enterprise.contactOnly")}</p>
              ) : (
                <>
                  <p className="price">€{(plan.priceCents / 100).toFixed(0)}</p>
                  <p className="status-muted">{t("pricing.perMonth")}</p>
                </>
              )}
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
                  onClick={() => void trackMarketingEvent({ event: "landing_cta_enterprise_click", payload: { source: "pricing_page" } })}
                >
                  {t("pricing.enterprise.cta")}
                </Link>
              ) : (
                <Link
                  className="btn btn-primary"
                  to="/register"
                  onClick={() => void trackMarketingEvent({ event: "landing_cta_start_free_click", payload: { source: "pricing_page", planCode: plan.code } })}
                >
                  {t("pricing.select")}
                </Link>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

