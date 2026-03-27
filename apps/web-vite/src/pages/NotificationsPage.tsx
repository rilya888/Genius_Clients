import { useEffect, useState } from "react";
import { getNotificationSummary, listNotificationDeliveries, retryFailedNotifications } from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useScopeContext } from "../shared/hooks/useScopeContext";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { formatUiDateTime } from "../shared/i18n/dateTime";

export function NotificationsPage() {
  const { t } = useI18n();
  const { role, tenantTimezone } = useScopeContext();
  const [summary, setSummary] = useState<{
    pending: boolean;
    error: string | null;
    data: { total: number; failed: number; deadLetter: number } | null;
  }>({ pending: true, error: null, data: null });
  const [rows, setRows] = useState<{
    pending: boolean;
    error: string | null;
    data: Array<{ id: string; notificationType: string; status: string; channel: string; createdAt: string }>;
  }>({ pending: true, error: null, data: [] });
  const [retryPending, setRetryPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getNotificationSummary()
      .then((data) => {
        if (!cancelled) {
          setSummary({ pending: false, error: null, data: { total: data.total, failed: data.failed, deadLetter: data.deadLetter } });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSummary({ pending: false, error: formatApiError(error, t("admin.notifications.loadSummaryFailed")), data: null });
        }
      });

    listNotificationDeliveries()
      .then((items) => {
        if (!cancelled) {
          setRows({
            pending: false,
            error: null,
            data: items.map((item) => ({
              id: item.id,
              notificationType: item.notificationType,
              status: item.status,
              channel: item.channel,
              createdAt: item.createdAt
            }))
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setRows({ pending: false, error: formatApiError(error, t("admin.notifications.loadRowsFailed")), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function runRetry() {
    if (role !== "owner") {
      setMessage(t("admin.notifications.retryOwnerOnly"));
      return;
    }
    setRetryPending(true);
    setMessage(null);
    try {
      const result = await retryFailedNotifications();
      setMessage(`${t("admin.notifications.retryCta")}: ${result.queued}`);
    } catch (error) {
      setMessage(formatApiError(error, t("admin.notifications.retryFailed")));
    } finally {
      setRetryPending(false);
    }
  }

  function notificationStatusLabel(status: string) {
    if (status === "pending" || status === "sent" || status === "failed") {
      return t(`common.notificationStatus.${status}`);
    }
    return status;
  }

  return (
    <section className="page-shell">
      <h1>{t("admin.notifications.title")}</h1>
      {summary.pending ? <LoadingState text={t("admin.notifications.loadingSummary")} /> : null}
      {summary.error ? <ErrorState text={summary.error} /> : null}
      {summary.data ? (
        <div className="admin-kpi-grid">
          <article className="kpi card-hover">
            <h3>{t("notifications.total")}</h3>
            <p>{summary.data.total}</p>
          </article>
          <article className="kpi card-hover">
            <h3>{t("notifications.failed")}</h3>
            <p>{summary.data.failed}</p>
          </article>
          <article className="kpi card-hover">
            <h3>{t("notifications.deadLetter")}</h3>
            <p>{summary.data.deadLetter}</p>
          </article>
        </div>
      ) : null}

      <div className="inline-actions">
        <button className="btn btn-primary" type="button" onClick={runRetry} disabled={retryPending}>
          {retryPending ? t("admin.notifications.retrying") : t("admin.notifications.retryCta")}
        </button>
        {role !== "owner" ? <p className="status-muted">{t("admin.notifications.readOnly")}</p> : null}
        {message ? <p>{message}</p> : null}
      </div>

      {rows.pending ? <LoadingState text={t("admin.notifications.loadingRows")} /> : null}
      {rows.error ? <ErrorState text={rows.error} /> : null}
      {!rows.pending && !rows.error && rows.data.length === 0 ? (
        <EmptyState title={t("admin.notifications.emptyTitle")} description={t("admin.notifications.emptyDescription")} />
      ) : null}
      {rows.data.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("notifications.colType")}</th>
                <th>{t("common.col.status")}</th>
                <th>{t("notifications.colChannel")}</th>
                <th>{t("notifications.colCreated")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.notificationType}</td>
                  <td>
                    <span className={`status-pill notification-status-${row.status}`}>{notificationStatusLabel(row.status)}</span>
                  </td>
                <td>{row.channel}</td>
                <td>{formatUiDateTime(row.createdAt, tenantTimezone)}</td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
