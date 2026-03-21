import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAdminDashboard } from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { useI18n } from "../shared/i18n/I18nProvider";

export function DashboardPage() {
  const { t } = useI18n();
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    kpis: {
      bookingsTodayTotal: number;
      bookingsWeekTotal: number;
      bookingsPendingCount: number;
      bookingsCancelledWeek: number;
      staffActiveCount: number;
      bookedMinutesToday: number;
    } | null;
    attention: {
      servicesWithoutMasters: number;
      mastersWithoutSchedule: number;
      pendingBookings: number;
    } | null;
    recentActivity: Array<{
      id: string;
      action: string;
      entity: string;
      createdAt: string;
    }>;
  }>({
    pending: true,
    error: null,
    kpis: null,
    attention: null,
    recentActivity: []
  });

  useEffect(() => {
    let cancelled = false;
    getAdminDashboard()
      .then((payload) => {
        if (!cancelled) {
          setState({
            pending: false,
            error: null,
            kpis: payload.kpis,
            attention: payload.attention,
            recentActivity: payload.recentActivity
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            pending: false,
            error: formatApiError(error, t("admin.dashboard.statusLoadFailed")),
            kpis: null,
            attention: null,
            recentActivity: []
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const kpis = state.kpis;
  const attention = state.attention;

  return (
    <section className="page-shell">
      <h1>{t("admin.dashboard.title")}</h1>
      <div className="admin-kpi-grid">
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.bookingsToday")}</h3>
          <p>{state.pending || !kpis ? t("common.loadingDots") : kpis.bookingsTodayTotal}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.bookingsWeek")}</h3>
          <p>{state.pending || !kpis ? t("common.loadingDots") : kpis.bookingsWeekTotal}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.pendingBookings")}</h3>
          <p>{state.pending || !kpis ? t("common.loadingDots") : kpis.bookingsPendingCount}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.cancelledWeek")}</h3>
          <p>{state.pending || !kpis ? t("common.loadingDots") : kpis.bookingsCancelledWeek}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.activeStaff")}</h3>
          <p>{state.pending || !kpis ? t("common.loadingDots") : kpis.staffActiveCount}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.bookedMinutesToday")}</h3>
          <p>{state.pending || !kpis ? t("common.loadingDots") : kpis.bookedMinutesToday}</p>
        </article>
      </div>
      <div className="settings-grid" style={{ marginTop: "1rem" }}>
        <article className="settings-card card-hover">
          <h3>{t("admin.dashboard.attentionTitle")}</h3>
          <p>
            {t("admin.dashboard.attention.pendingBookings")}:{" "}
            <strong>{state.pending || !attention ? t("common.loadingDots") : attention.pendingBookings}</strong>
          </p>
          <p>
            {t("admin.dashboard.attention.servicesWithoutMasters")}:{" "}
            <strong>
              {state.pending || !attention ? t("common.loadingDots") : attention.servicesWithoutMasters}
            </strong>
          </p>
          <p>
            {t("admin.dashboard.attention.mastersWithoutSchedule")}:{" "}
            <strong>
              {state.pending || !attention ? t("common.loadingDots") : attention.mastersWithoutSchedule}
            </strong>
          </p>
          <div className="inline-actions">
            <Link className="btn btn-ghost" to="/app/bookings">
              {t("admin.dashboard.quick.openBookings")}
            </Link>
            <Link className="btn btn-ghost" to="/app/services">
              {t("admin.dashboard.quick.openServices")}
            </Link>
            <Link className="btn btn-ghost" to="/app/staff">
              {t("admin.dashboard.quick.openStaff")}
            </Link>
            <Link className="btn btn-ghost" to="/app/schedule">
              {t("admin.dashboard.quick.openSchedule")}
            </Link>
          </div>
        </article>
        <article className="settings-card card-hover">
          <h3>{t("admin.dashboard.activityTitle")}</h3>
          {state.pending ? <p>{t("common.loadingDots")}</p> : null}
          {!state.pending && state.recentActivity.length === 0 ? (
            <p className="status-muted">{t("admin.dashboard.activityEmpty")}</p>
          ) : null}
          {!state.pending && state.recentActivity.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th>{t("admin.dashboard.activityAction")}</th>
                  <th>{t("admin.dashboard.activityEntity")}</th>
                  <th>{t("common.col.date")}</th>
                </tr>
              </thead>
              <tbody>
                {state.recentActivity.map((item) => (
                  <tr key={item.id}>
                    <td>{item.action}</td>
                    <td>{item.entity}</td>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </article>
      </div>
      {state.error ? <p className="status-error">{state.error}</p> : null}
    </section>
  );
}
