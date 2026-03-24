import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../shared/i18n/I18nProvider";
import {
  confirmBillingCheckout,
  createBillingCheckout,
  getBillingPlans,
  getBillingSubscription,
  getOperationalSettings,
  updateOperationalSettings
} from "../shared/api/adminApi";
import { ApiHttpError } from "../shared/api/http";
import { formatApiError } from "../shared/api/formatApiError";
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
  const [operationalPending, setOperationalPending] = useState(true);
  const [operationalSaving, setOperationalSaving] = useState(false);
  const [operationalError, setOperationalError] = useState<string | null>(null);
  const [operationalInfo, setOperationalInfo] = useState<string | null>(null);
  const [operationalForm, setOperationalForm] = useState({
    timezone: "Europe/Rome",
    country: "",
    city: "",
    line1: "",
    line2: "",
    postalCode: "",
    parkingAvailable: "unknown" as "unknown" | "yes" | "no",
    parkingNote: "",
    businessHoursNote: "",
    desiredBotNumber: "",
    operatorNumber: "",
    whatsappStatus:
      "not_started" as
        | "not_started"
        | "incomplete"
        | "numbers_provided"
        | "pending_meta_connection"
        | "connected"
        | "action_required",
    whatsappStatusReason: "missing_numbers",
    connectedDisplayPhoneNumber: ""
  });

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

  useEffect(() => {
    let cancelled = false;
    setOperationalPending(true);
    setOperationalError(null);
    setOperationalInfo(null);

    getOperationalSettings()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setOperationalForm({
          timezone: payload.timezone || "Europe/Rome",
          country: payload.address.country ?? "",
          city: payload.address.city ?? "",
          line1: payload.address.line1 ?? "",
          line2: payload.address.line2 ?? "",
          postalCode: payload.address.postalCode ?? "",
          parkingAvailable:
            payload.parking.available === true ? "yes" : payload.parking.available === false ? "no" : "unknown",
          parkingNote: payload.parking.note ?? "",
          businessHoursNote: payload.businessHoursNote ?? "",
          desiredBotNumber: payload.whatsapp.desiredBotNumber ?? "",
          operatorNumber: payload.whatsapp.operatorNumber ?? "",
          whatsappStatus: payload.whatsapp.status,
          whatsappStatusReason: payload.whatsapp.statusReason,
          connectedDisplayPhoneNumber: payload.whatsapp.connectedDisplayPhoneNumber ?? ""
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setOperationalError(formatApiError(error, t("settings.operational.loadFailed")));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOperationalPending(false);
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

  async function handleOperationalSave() {
    setOperationalSaving(true);
    setOperationalError(null);
    setOperationalInfo(null);
    try {
      const payload = await updateOperationalSettings({
        timezone: operationalForm.timezone.trim(),
        address: {
          country: operationalForm.country,
          city: operationalForm.city,
          line1: operationalForm.line1,
          line2: operationalForm.line2,
          postalCode: operationalForm.postalCode
        },
        parking: {
          available:
            operationalForm.parkingAvailable === "unknown"
              ? null
              : operationalForm.parkingAvailable === "yes",
          note: operationalForm.parkingNote
        },
        businessHoursNote: operationalForm.businessHoursNote,
        whatsapp: {
          desiredBotNumber: operationalForm.desiredBotNumber,
          operatorNumber: operationalForm.operatorNumber
        }
      });
      setOperationalForm((current) => ({
        ...current,
        timezone: payload.timezone || current.timezone,
        country: payload.address.country ?? "",
        city: payload.address.city ?? "",
        line1: payload.address.line1 ?? "",
        line2: payload.address.line2 ?? "",
        postalCode: payload.address.postalCode ?? "",
        parkingAvailable:
          payload.parking.available === true ? "yes" : payload.parking.available === false ? "no" : "unknown",
        parkingNote: payload.parking.note ?? "",
        businessHoursNote: payload.businessHoursNote ?? "",
        desiredBotNumber: payload.whatsapp.desiredBotNumber ?? "",
        operatorNumber: payload.whatsapp.operatorNumber ?? "",
        whatsappStatus: payload.whatsapp.status,
        whatsappStatusReason: payload.whatsapp.statusReason,
        connectedDisplayPhoneNumber: payload.whatsapp.connectedDisplayPhoneNumber ?? ""
      }));
      setOperationalInfo(t("settings.operational.saved"));
    } catch (error) {
      setOperationalError(formatApiError(error, t("settings.operational.saveFailed")));
    } finally {
      setOperationalSaving(false);
    }
  }

  const billingStateLabel = billingSubscription
    ? t(`settings.subscription.state.${billingSubscription.billingState}`)
    : t("common.value.na");
  const whatsappStatusLabel = t(`settings.operational.whatsapp.status.${operationalForm.whatsappStatus}`);
  const whatsappStatusReason = t(`settings.operational.whatsapp.reason.${operationalForm.whatsappStatusReason}`);

  return (
    <section className="page-shell">
      <h1>{t("settings.title")}</h1>
      <div className="settings-grid settings-grid--content">
        <article className="settings-card card-hover">
          <h3>{t("settings.operational.title")}</h3>
          <p>{t("settings.operational.description")}</p>
          {operationalPending ? <p>{t("settings.operational.loading")}</p> : null}
          {operationalError ? <p className="status-error">{operationalError}</p> : null}
          {operationalInfo ? <p className="status-success">{operationalInfo}</p> : null}
          {!operationalPending ? (
            <form className="auth-card" onSubmit={(event) => event.preventDefault()}>
              <label>
                {t("settings.operational.timezone")}
                <input
                  value={operationalForm.timezone}
                  onChange={(event) => setOperationalForm((prev) => ({ ...prev, timezone: event.target.value }))}
                />
              </label>
              <label>
                {t("settings.operational.country")}
                <input
                  value={operationalForm.country}
                  onChange={(event) => setOperationalForm((prev) => ({ ...prev, country: event.target.value }))}
                />
              </label>
              <label>
                {t("settings.operational.city")}
                <input value={operationalForm.city} onChange={(event) => setOperationalForm((prev) => ({ ...prev, city: event.target.value }))} />
              </label>
              <label>
                {t("settings.operational.line1")}
                <input value={operationalForm.line1} onChange={(event) => setOperationalForm((prev) => ({ ...prev, line1: event.target.value }))} />
              </label>
              <label>
                {t("settings.operational.line2")}
                <input value={operationalForm.line2} onChange={(event) => setOperationalForm((prev) => ({ ...prev, line2: event.target.value }))} />
              </label>
              <label>
                {t("settings.operational.postalCode")}
                <input
                  value={operationalForm.postalCode}
                  onChange={(event) => setOperationalForm((prev) => ({ ...prev, postalCode: event.target.value }))}
                />
              </label>
              <label>
                {t("settings.operational.parkingAvailable")}
                <select
                  value={operationalForm.parkingAvailable}
                  onChange={(event) =>
                    setOperationalForm((prev) => ({
                      ...prev,
                      parkingAvailable: event.target.value as "unknown" | "yes" | "no"
                    }))
                  }
                >
                  <option value="unknown">{t("common.value.na")}</option>
                  <option value="yes">{t("common.value.yes")}</option>
                  <option value="no">{t("common.value.no")}</option>
                </select>
              </label>
              <label>
                {t("settings.operational.parkingNote")}
                <input
                  value={operationalForm.parkingNote}
                  onChange={(event) => setOperationalForm((prev) => ({ ...prev, parkingNote: event.target.value }))}
                />
              </label>
              <label>
                {t("settings.operational.businessHoursNote")}
                <input
                  value={operationalForm.businessHoursNote}
                  onChange={(event) => setOperationalForm((prev) => ({ ...prev, businessHoursNote: event.target.value }))}
                />
              </label>
              <label>
                {t("settings.operational.whatsapp.botNumber")}
                <input
                  placeholder="+393331234567"
                  value={operationalForm.desiredBotNumber}
                  onChange={(event) => setOperationalForm((prev) => ({ ...prev, desiredBotNumber: event.target.value }))}
                />
              </label>
              <label>
                {t("settings.operational.whatsapp.operatorNumber")}
                <input
                  placeholder="+393339876543"
                  value={operationalForm.operatorNumber}
                  onChange={(event) => setOperationalForm((prev) => ({ ...prev, operatorNumber: event.target.value }))}
                />
              </label>
              <p className="status-muted">
                {t("settings.operational.whatsapp.currentStatus")}: <strong>{whatsappStatusLabel}</strong>
              </p>
              {operationalForm.connectedDisplayPhoneNumber ? (
                <p className="status-muted">
                  {t("settings.operational.whatsapp.connectedNumber")}:{" "}
                  <strong>{operationalForm.connectedDisplayPhoneNumber}</strong>
                </p>
              ) : null}
              <p className="status-muted">{whatsappStatusReason}</p>
              <p className="status-muted">{t("settings.operational.whatsapp.hint")}</p>
              <button className="btn btn-primary" type="button" disabled={operationalSaving} onClick={() => void handleOperationalSave()}>
                {operationalSaving ? t("settings.operational.saving") : t("common.action.save")}
              </button>
            </form>
          ) : null}
        </article>
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
