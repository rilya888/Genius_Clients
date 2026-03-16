import { useEffect, useState } from "react";
import { getNotificationSummary } from "../shared/api/adminApi";
import { loadSystemStatus } from "../shared/api/systemApi";
import { useI18n } from "../shared/i18n/I18nProvider";

export function DashboardPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<{
    pending: boolean;
    error: string | null;
    health: "ok" | "error" | "-";
    ready: "ok" | "error" | "-";
  }>({
    pending: true,
    error: null,
    health: "-",
    ready: "-"
  });
  const [notificationFailed, setNotificationFailed] = useState<number | null>(null);
  const healthLabel = status.pending ? t("common.loadingDots") : t(`common.systemStatus.${status.health}`);
  const readyLabel = status.pending ? t("common.loadingDots") : t(`common.systemStatus.${status.ready}`);
  const healthClass = status.health === "ok" ? "status-success" : status.health === "error" ? "status-error" : "status-muted";
  const readyClass = status.ready === "ok" ? "status-success" : status.ready === "error" ? "status-error" : "status-muted";

  useEffect(() => {
    let cancelled = false;
    loadSystemStatus()
      .then((payload) => {
        if (!cancelled) {
          setStatus({ pending: false, error: null, ...payload });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus({
            pending: false,
            error: t("admin.dashboard.statusLoadFailed"),
            health: "error",
            ready: "error"
          });
        }
      });
    getNotificationSummary()
      .then((summary) => {
        if (!cancelled) {
          setNotificationFailed(summary.failed + summary.deadLetter);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setNotificationFailed(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page-shell">
      <h1>{t("admin.dashboard.title")}</h1>
      <div className="admin-kpi-grid">
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.bookingsToday")}</h3>
          <p>42</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.reminderDelivery")}</h3>
          <p>97.2%</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.noShowRisk")}</h3>
          <p>{t("admin.dashboard.noShowRiskValue")}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.apiHealth")}</h3>
          <p className={healthClass}>{healthLabel}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.apiReady")}</h3>
          <p className={readyClass}>{readyLabel}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.notificationFailures")}</h3>
          <p>{notificationFailed === null ? t("common.value.na") : notificationFailed}</p>
        </article>
      </div>
      {status.error ? <p className="status-error">{status.error}</p> : null}
    </section>
  );
}
