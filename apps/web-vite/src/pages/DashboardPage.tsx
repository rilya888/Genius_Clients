import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { confirmAdminBooking, getAdminDashboard, listAdminBookings, updateOperationalSettings } from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { useI18n } from "../shared/i18n/I18nProvider";
import { emitAdminBookingsChanged } from "../shared/admin-events";
import { useScopeContext } from "../shared/hooks/useScopeContext";
import { formatUiDateTime, formatUiTime } from "../shared/i18n/dateTime";

export function DashboardPage() {
  const { t } = useI18n();
  const { tenantTimezone } = useScopeContext();
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
      bookingsNoShowToday: number;
      completedRevenueTodayMinor: number;
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
    revenueOverview: {
      today: {
        totalRevenueMinor: number;
        completedCount: number;
        completedWithAmountCount: number;
        completedWithoutAmountCount: number;
        averageTicketMinor: number;
      };
      week: {
        totalRevenueMinor: number;
        completedCount: number;
        completedWithAmountCount: number;
        completedWithoutAmountCount: number;
        averageTicketMinor: number;
      };
      month: {
        totalRevenueMinor: number;
        completedCount: number;
        completedWithAmountCount: number;
        completedWithoutAmountCount: number;
        averageTicketMinor: number;
      };
    } | null;
    todayBookings: Array<{
      id: string;
      clientName: string;
      serviceDisplayName: string;
      status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" | "no_show";
      startAt: string;
    }>;
    tomorrowBookings: Array<{
      id: string;
      clientName: string;
      serviceDisplayName: string;
      status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" | "no_show";
      startAt: string;
    }>;
    quickActionBusyBookingId: string | null;
    whatsappSetup: {
      desiredBotNumber: string | null;
      operatorNumber: string | null;
      status:
        | "not_started"
        | "incomplete"
        | "numbers_provided"
        | "pending_meta_connection"
        | "connected"
        | "action_required";
      connectedEndpointId: string | null;
      connectedDisplayPhoneNumber: string | null;
      requiresAction: boolean;
      statusReason: string;
    } | null;
    whatsappSaving: boolean;
    whatsappMessage: string | null;
    whatsappMessageIsError: boolean;
    whatsappForm: {
      desiredBotNumber: string;
      operatorNumber: string;
    };
  }>({
    pending: true,
    error: null,
    kpis: null,
    attention: null,
    recentActivity: [],
    revenueOverview: null,
    todayBookings: [],
    tomorrowBookings: [],
    quickActionBusyBookingId: null,
    whatsappSetup: null,
    whatsappSaving: false,
    whatsappMessage: null,
    whatsappMessageIsError: false,
    whatsappForm: {
      desiredBotNumber: "",
      operatorNumber: ""
    }
  });

  useEffect(() => {
    let cancelled = false;
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const formatDateOnly = (value: Date) => {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, "0");
      const day = String(value.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const todayDate = formatDateOnly(today);
    const tomorrowDate = formatDateOnly(tomorrow);

    Promise.all([
      getAdminDashboard(),
      listAdminBookings({
        from: todayDate,
        to: todayDate
      }),
      listAdminBookings({
        from: tomorrowDate,
        to: tomorrowDate
      })
    ])
      .then(([payload, todayBookings, tomorrowBookings]) => {
        if (!cancelled) {
          setState({
            pending: false,
            error: null,
            kpis: payload.kpis,
            attention: payload.attention,
            recentActivity: payload.recentActivity,
            revenueOverview: payload.revenueOverview,
            todayBookings,
            tomorrowBookings,
            quickActionBusyBookingId: null,
            whatsappSetup: payload.whatsappSetup,
            whatsappSaving: false,
            whatsappMessage: null,
            whatsappMessageIsError: false,
            whatsappForm: {
              desiredBotNumber: payload.whatsappSetup.desiredBotNumber ?? "",
              operatorNumber: payload.whatsappSetup.operatorNumber ?? ""
            }
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
            recentActivity: [],
            revenueOverview: null,
            todayBookings: [],
            tomorrowBookings: [],
            quickActionBusyBookingId: null,
            whatsappSetup: null,
            whatsappSaving: false,
            whatsappMessage: null,
            whatsappMessageIsError: false,
            whatsappForm: {
              desiredBotNumber: "",
              operatorNumber: ""
            }
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const kpis = state.kpis;
  const attention = state.attention;
  const whatsappSetup = state.whatsappSetup;

  function getWhatsAppSetupStatusLabel() {
    if (!whatsappSetup) {
      return t("common.loadingDots");
    }
    return t(`admin.dashboard.whatsapp.status.${whatsappSetup.status}`);
  }

  function getWhatsAppSetupReason() {
    if (!whatsappSetup) {
      return "";
    }
    return t(`admin.dashboard.whatsapp.reason.${whatsappSetup.statusReason}`);
  }

  async function handleQuickConfirm(bookingId: string) {
    setState((current) => ({
      ...current,
      quickActionBusyBookingId: bookingId
    }));
    try {
      await confirmAdminBooking(bookingId);
      setState((current) => ({
        ...current,
        todayBookings: current.todayBookings.map((row) => (row.id === bookingId ? { ...row, status: "confirmed" } : row)),
        tomorrowBookings: current.tomorrowBookings.map((row) =>
          row.id === bookingId ? { ...row, status: "confirmed" } : row
        ),
        quickActionBusyBookingId: null
      }));
      emitAdminBookingsChanged();
    } catch (error) {
      setState((current) => ({
        ...current,
        quickActionBusyBookingId: null,
        error: formatApiError(error, t("admin.bookings.confirmFailed"))
      }));
    }
  }

  async function handleWhatsAppSave() {
    setState((current) => ({
      ...current,
      whatsappSaving: true,
      whatsappMessage: null,
      whatsappMessageIsError: false
    }));
    try {
      const payload = await updateOperationalSettings({
        whatsapp: {
          desiredBotNumber: state.whatsappForm.desiredBotNumber,
          operatorNumber: state.whatsappForm.operatorNumber
        }
      });
      setState((current) => ({
        ...current,
        whatsappSaving: false,
        whatsappSetup: payload.whatsapp,
        whatsappMessage: t("admin.dashboard.whatsapp.saved"),
        whatsappMessageIsError: false,
        whatsappForm: {
          desiredBotNumber: payload.whatsapp.desiredBotNumber ?? "",
          operatorNumber: payload.whatsapp.operatorNumber ?? ""
        }
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        whatsappSaving: false,
        whatsappMessage: formatApiError(error, t("admin.dashboard.whatsapp.saveFailed")),
        whatsappMessageIsError: true
      }));
    }
  }

  return (
    <section className="page-shell">
      <h1>{t("admin.dashboard.title")}</h1>
      <div className="settings-grid" style={{ marginBottom: "1rem" }}>
        <article className="settings-card card-hover">
          <h3>{t("admin.dashboard.bookingsToday")}</h3>
          {state.pending ? <p>{t("common.loadingDots")}</p> : null}
          {!state.pending && state.todayBookings.length === 0 ? (
            <p className="status-muted">{t("admin.bookings.emptyTitle")}</p>
          ) : null}
          {!state.pending && state.todayBookings.length > 0 ? (
            <div className="table-shell">
              <table>
                <tbody>
                  {state.todayBookings.slice(0, 8).map((row) => (
                    <tr key={row.id}>
                      <td>{formatUiTime(row.startAt, tenantTimezone)}</td>
                      <td>{row.clientName}</td>
                      <td>{row.serviceDisplayName}</td>
                      <td>
                        <span className={`status-pill status-${row.status}`}>{t(`common.bookingStatus.${row.status}`)}</span>
                      </td>
                      <td>
                        {row.status === "pending" ? (
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={state.quickActionBusyBookingId === row.id}
                            onClick={() => void handleQuickConfirm(row.id)}
                          >
                            {state.quickActionBusyBookingId === row.id ? t("auth.loading") : t("admin.bookings.confirmAction")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="inline-actions">
            <Link className="btn btn-ghost" to="/app/bookings">
              {t("admin.dashboard.quick.openBookings")}
            </Link>
          </div>
        </article>
        <article className="settings-card card-hover">
          <h3>{t("admin.dashboard.bookingsTomorrow")}</h3>
          {state.pending ? <p>{t("common.loadingDots")}</p> : null}
          {!state.pending && state.tomorrowBookings.length === 0 ? (
            <p className="status-muted">{t("admin.bookings.emptyTitle")}</p>
          ) : null}
          {!state.pending && state.tomorrowBookings.length > 0 ? (
            <div className="table-shell">
              <table>
                <tbody>
                  {state.tomorrowBookings.slice(0, 8).map((row) => (
                    <tr key={row.id}>
                      <td>{formatUiTime(row.startAt, tenantTimezone)}</td>
                      <td>{row.clientName}</td>
                      <td>{row.serviceDisplayName}</td>
                      <td>
                        <span className={`status-pill status-${row.status}`}>{t(`common.bookingStatus.${row.status}`)}</span>
                      </td>
                      <td>
                        {row.status === "pending" ? (
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={state.quickActionBusyBookingId === row.id}
                            onClick={() => void handleQuickConfirm(row.id)}
                          >
                            {state.quickActionBusyBookingId === row.id ? t("auth.loading") : t("admin.bookings.confirmAction")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="inline-actions">
            <Link className="btn btn-ghost" to="/app/bookings">
              {t("admin.dashboard.quick.openBookings")}
            </Link>
          </div>
        </article>
      </div>
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
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.noShowToday")}</h3>
          <p>{state.pending || !kpis ? t("common.loadingDots") : kpis.bookingsNoShowToday}</p>
        </article>
        <article className="kpi card-hover">
          <h3>{t("admin.dashboard.completedRevenueToday")}</h3>
          <p>
            {state.pending || !kpis
              ? t("common.loadingDots")
              : new Intl.NumberFormat(undefined, {
                  style: "currency",
                  currency: "EUR"
                }).format((kpis.completedRevenueTodayMinor ?? 0) / 100)}
          </p>
        </article>
      </div>
      <div className="settings-grid" style={{ marginTop: "1rem" }}>
        <article className="settings-card card-hover">
          <h3>{t("admin.revenue.overviewTitle")}</h3>
          {state.pending || !state.revenueOverview ? <p>{t("common.loadingDots")}</p> : null}
          {!state.pending && state.revenueOverview ? (
            <div className="revenue-overview-grid">
              <div>
                <strong>{t("admin.revenue.range.today")}</strong>
                <p>
                  {new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(
                    state.revenueOverview.today.totalRevenueMinor / 100
                  )}
                </p>
                <p className="status-muted">{t("admin.revenue.completedCount")}: {state.revenueOverview.today.completedCount}</p>
              </div>
              <div>
                <strong>{t("admin.revenue.range.week")}</strong>
                <p>
                  {new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(
                    state.revenueOverview.week.totalRevenueMinor / 100
                  )}
                </p>
                <p className="status-muted">{t("admin.revenue.completedCount")}: {state.revenueOverview.week.completedCount}</p>
              </div>
              <div>
                <strong>{t("admin.revenue.range.month")}</strong>
                <p>
                  {new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(
                    state.revenueOverview.month.totalRevenueMinor / 100
                  )}
                </p>
                <p className="status-muted">{t("admin.revenue.completedCount")}: {state.revenueOverview.month.completedCount}</p>
              </div>
            </div>
          ) : null}
          <div className="inline-actions">
            <Link className="btn btn-ghost" to="revenue">
              {t("admin.revenue.openPage")}
            </Link>
          </div>
        </article>
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
            <div className="table-shell activity-table-shell">
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
                      <td data-label={t("admin.dashboard.activityAction")}>{item.action}</td>
                      <td data-label={t("admin.dashboard.activityEntity")}>{item.entity}</td>
                      <td data-label={t("common.col.date")}>{formatUiDateTime(item.createdAt, tenantTimezone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>
        <article className="settings-card card-hover">
          <h3>{t("admin.dashboard.whatsapp.title")}</h3>
          <p>{t("admin.dashboard.whatsapp.description")}</p>
          <p>
            {t("admin.dashboard.whatsapp.currentStatus")}: <strong>{getWhatsAppSetupStatusLabel()}</strong>
          </p>
          {whatsappSetup?.connectedDisplayPhoneNumber ? (
            <p>
              {t("admin.dashboard.whatsapp.connectedNumber")}:{" "}
              <strong>{whatsappSetup.connectedDisplayPhoneNumber}</strong>
            </p>
          ) : null}
          <p className="status-muted">{getWhatsAppSetupReason()}</p>
          <form className="auth-card" onSubmit={(event) => event.preventDefault()}>
            <label>
              {t("admin.dashboard.whatsapp.botNumber")}
              <input
                placeholder="+393331234567"
                value={state.whatsappForm.desiredBotNumber}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    whatsappForm: {
                      ...current.whatsappForm,
                      desiredBotNumber: event.target.value
                    }
                  }))
                }
              />
            </label>
            <label>
              {t("admin.dashboard.whatsapp.operatorNumber")}
              <input
                placeholder="+393339876543"
                value={state.whatsappForm.operatorNumber}
                onChange={(event) =>
                  setState((current) => ({
                    ...current,
                    whatsappForm: {
                      ...current.whatsappForm,
                      operatorNumber: event.target.value
                    }
                  }))
                }
              />
            </label>
            <p className="status-muted">{t("admin.dashboard.whatsapp.hint")}</p>
            {state.whatsappMessage ? (
              <p className={state.whatsappMessageIsError ? "status-error" : "status-success"}>
                {state.whatsappMessage}
              </p>
            ) : null}
            <div className="inline-actions">
              <button
                className="btn btn-primary"
                type="button"
                disabled={state.whatsappSaving}
                onClick={() => void handleWhatsAppSave()}
              >
                {state.whatsappSaving ? t("settings.operational.saving") : t("common.action.save")}
              </button>
              <Link className="btn btn-ghost" to="/app/settings">
                {t("admin.dashboard.whatsapp.openSettings")}
              </Link>
            </div>
          </form>
        </article>
      </div>
      {state.error ? <p className="status-error">{state.error}</p> : null}
    </section>
  );
}
