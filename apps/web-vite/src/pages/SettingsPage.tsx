import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../shared/i18n/I18nProvider";
import {
  confirmBillingCheckout,
  createBillingCheckout,
  getBillingPlans,
  getBillingSubscription
} from "../shared/api/adminApi";
import { ApiHttpError } from "../shared/api/http";
import { useScopeContext } from "../shared/hooks/useScopeContext";

type BillingPlan = Awaited<ReturnType<typeof getBillingPlans>>[number];
type BillingSubscription = Awaited<ReturnType<typeof getBillingSubscription>>;

export function SettingsPage() {
  const { t } = useI18n();
  const { role } = useScopeContext();
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [billingSubscription, setBillingSubscription] = useState<BillingSubscription | null>(null);
  const [billingPending, setBillingPending] = useState(true);
  const [billingActionPendingCode, setBillingActionPendingCode] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingInfo, setBillingInfo] = useState<string | null>(null);

  const isOwner = role === "owner";

  useEffect(() => {
    let cancelled = false;
    setBillingPending(true);
    setBillingError(null);
    setBillingInfo(null);

    Promise.all([getBillingPlans(), getBillingSubscription()])
      .then(([plans, subscription]) => {
        if (cancelled) {
          return;
        }
        setBillingPlans(plans);
        setBillingSubscription(subscription);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setBillingError(t("settings.subscription.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) {
          setBillingPending(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const sortedBillingPlans = useMemo(
    () => [...billingPlans].sort((left, right) => left.priceCents - right.priceCents),
    [billingPlans]
  );

  async function refreshBilling() {
    const [plans, subscription] = await Promise.all([getBillingPlans(), getBillingSubscription()]);
    setBillingPlans(plans);
    setBillingSubscription(subscription);
  }

  async function handleUpgrade(planCode: string) {
    if (!isOwner) {
      return;
    }
    setBillingActionPendingCode(planCode);
    setBillingError(null);
    setBillingInfo(null);
    try {
      const response = await createBillingCheckout({ targetPlanCode: planCode });
      if (response.requiresTrialConfirm) {
        const confirmed = window.confirm(
          `${t("settings.subscription.trialConfirmPrefix")} ${response.trialDaysLeft} ${t(
            "settings.subscription.trialConfirmSuffix"
          )}`
        );
        if (!confirmed) {
          setBillingInfo(t("settings.subscription.trialConfirmCancelled"));
          return;
        }
        const confirmedResponse = await confirmBillingCheckout(planCode);
        if (confirmedResponse.requiresTrialConfirm) {
          setBillingError(t("settings.subscription.checkoutFailed"));
          return;
        }
        if ("checkoutUrl" in confirmedResponse && confirmedResponse.checkoutUrl) {
          window.location.href = confirmedResponse.checkoutUrl;
          return;
        }
        setBillingInfo(t("settings.subscription.updatedNow"));
        await refreshBilling();
        return;
      }

      if ("checkoutUrl" in response && response.checkoutUrl) {
        window.location.href = response.checkoutUrl;
        return;
      }

      setBillingInfo(t("settings.subscription.updatedNow"));
      await refreshBilling();
    } catch (error) {
      if (error instanceof ApiHttpError) {
        setBillingError(t(`settings.subscription.error.${error.code ?? "generic"}`));
      } else {
        setBillingError(t("settings.subscription.checkoutFailed"));
      }
    } finally {
      setBillingActionPendingCode(null);
    }
  }

  const billingStateLabel = billingSubscription
    ? t(`settings.subscription.state.${billingSubscription.billingState}`)
    : t("common.value.na");

  return (
    <section className="page-shell">
      <h1>{t("settings.title")}</h1>
      <div className="settings-grid">
        <article className="settings-card card-hover">
          <h3>{t("settings.subscription.title")}</h3>
          <p>{t("settings.subscription.description")}</p>
          {billingPending ? <p>{t("settings.subscription.loading")}</p> : null}
          {billingError ? <p className="status-error">{billingError}</p> : null}
          {billingInfo ? <p className="status-success">{billingInfo}</p> : null}
          {!billingPending && billingSubscription ? (
            <div>
              <p>
                {t("settings.subscription.currentPlan")}:{" "}
                <strong>{billingSubscription.planCode ?? t("common.value.na")}</strong>
              </p>
              <p>
                {t("settings.subscription.status")}: <strong>{billingStateLabel}</strong>
              </p>
              {billingSubscription.trialDaysLeft > 0 ? (
                <p>
                  {t("settings.subscription.trialDaysLeftPrefix")} {billingSubscription.trialDaysLeft}
                </p>
              ) : null}
              {billingSubscription.daysPastDue > 0 ? (
                <p>
                  {t("settings.subscription.pastDuePrefix")} {billingSubscription.daysPastDue}
                </p>
              ) : null}
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {sortedBillingPlans.map((plan) => {
              const disabled =
                !isOwner || !plan.canUpgrade || !plan.isActive || billingActionPendingCode === plan.code;
              return (
                <div
                  key={plan.code}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
                >
                  <div>
                    <strong>{plan.name}</strong>
                    <div>
                      {plan.priceCents > 0
                        ? `€${(plan.priceCents / 100).toFixed(2)} / ${plan.billingPeriod}`
                        : t("settings.subscription.enterpriseContactOnly")}
                    </div>
                  </div>
                  {plan.isEnterprise ? (
                    <span>{t("settings.subscription.enterpriseContactOnly")}</span>
                  ) : (
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        void handleUpgrade(plan.code);
                      }}
                    >
                      {billingActionPendingCode === plan.code
                        ? t("settings.subscription.processing")
                        : plan.isCurrent
                          ? t("settings.subscription.current")
                          : t("settings.subscription.upgrade")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!isOwner ? <p className="status-muted">{t("settings.subscription.ownerOnly")}</p> : null}
        </article>
        <article className="settings-card card-hover">
          <h3>{t("settings.faq.title")}</h3>
          <p>{t("settings.faq.description")}</p>
          <Link className="btn btn-primary" to="/app/settings/faq">
            {t("settings.faq.cta")}
          </Link>
        </article>
        <article className="settings-card card-hover">
          <h3>{t("settings.privacy.title")}</h3>
          <p>{t("settings.privacy.description")}</p>
          <Link className="btn btn-ghost" to="/app/settings/privacy">
            {t("settings.privacy.cta")}
          </Link>
        </article>
        <article className="settings-card card-hover">
          <h3>{t("settings.notifications.title")}</h3>
          <p>{t("settings.notifications.description")}</p>
          <Link className="btn btn-primary" to="/app/settings/notifications">
            {t("settings.notifications.cta")}
          </Link>
        </article>
      </div>
    </section>
  );
}
