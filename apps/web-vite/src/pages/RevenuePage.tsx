import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { getRevenueSummary, listRevenueBookings, type RevenueRange } from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useScopeContext } from "../shared/hooks/useScopeContext";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { buildTenantScopedPath, resolveCurrentTenantSlug } from "../shared/routing/tenant-host";

export function RevenuePage() {
  const { t } = useI18n();
  const { role } = useScopeContext();
  const canViewRevenue = role === "owner" || role === "admin";
  const currentTenantSlug = resolveCurrentTenantSlug();
  const dashboardHref = currentTenantSlug ? buildTenantScopedPath(currentTenantSlug, "/app") : "/app";
  const [range, setRange] = useState<RevenueRange>("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    summary: {
      totalRevenueMinor: number;
      averageTicketMinor: number;
      completedCount: number;
      completedWithAmountCount: number;
      completedWithoutAmountCount: number;
      currency: string;
    } | null;
    items: Array<{
      id: string;
      clientName: string;
      serviceDisplayName: string;
      completedAt: string;
      completedAmountMinor: number | null;
      completedCurrency: string | null;
      completedPaymentMethod: string | null;
      completedPaymentNote: string | null;
    }>;
  }>({
    pending: true,
    error: null,
    summary: null,
    items: []
  });

  const query = useMemo(
    () => ({
      range,
      from: range === "custom" ? from || undefined : undefined,
      to: range === "custom" ? to || undefined : undefined
    }),
    [range, from, to]
  );

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, pending: true, error: null }));
    Promise.all([
      getRevenueSummary(query),
      listRevenueBookings({
        ...query,
        limit: 100,
        offset: 0
      })
    ])
      .then(([summary, bookings]) => {
        if (cancelled) {
          return;
        }
        setState({
          pending: false,
          error: null,
          summary: {
            totalRevenueMinor: summary.totalRevenueMinor,
            averageTicketMinor: summary.averageTicketMinor,
            completedCount: summary.completedCount,
            completedWithAmountCount: summary.completedWithAmountCount,
            completedWithoutAmountCount: summary.completedWithoutAmountCount,
            currency: summary.currency
          },
          items: bookings.items.map((item) => ({
            id: item.id,
            clientName: item.clientName,
            serviceDisplayName: item.serviceDisplayName,
            completedAt: item.completedAt,
            completedAmountMinor: item.completedAmountMinor,
            completedCurrency: item.completedCurrency,
            completedPaymentMethod: item.completedPaymentMethod,
            completedPaymentNote: item.completedPaymentNote
          }))
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setState({
          pending: false,
          error: formatApiError(error, t("admin.revenue.loadFailed")),
          summary: null,
          items: []
        });
      });

    return () => {
      cancelled = true;
    };
  }, [query, t]);

  if (!canViewRevenue) {
    return <Navigate to={dashboardHref} replace />;
  }

  return (
    <section className="page-shell">
      <h1>{t("admin.revenue.title")}</h1>
      <div className="booking-controls booking-controls-compact">
        <label>
          {t("admin.revenue.range.label")}
          <select value={range} onChange={(event) => setRange(event.target.value as RevenueRange)}>
            <option value="today">{t("admin.revenue.range.today")}</option>
            <option value="week">{t("admin.revenue.range.week")}</option>
            <option value="month">{t("admin.revenue.range.month")}</option>
            <option value="custom">{t("admin.revenue.range.custom")}</option>
          </select>
        </label>
        {range === "custom" ? (
          <>
            <label>
              {t("admin.bookings.from")}
              <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label>
              {t("admin.bookings.to")}
              <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </label>
          </>
        ) : null}
      </div>

      {state.pending ? <LoadingState text={t("admin.revenue.loading")} /> : null}
      {state.error ? <ErrorState text={state.error} /> : null}

      {!state.pending && !state.error && state.summary ? (
        <div className="admin-kpi-grid">
          <article className="kpi card-hover">
            <h3>{t("admin.revenue.total")}</h3>
            <p>
              {new Intl.NumberFormat(undefined, { style: "currency", currency: state.summary.currency || "EUR" }).format(
                state.summary.totalRevenueMinor / 100
              )}
            </p>
          </article>
          <article className="kpi card-hover">
            <h3>{t("admin.revenue.averageTicket")}</h3>
            <p>
              {new Intl.NumberFormat(undefined, { style: "currency", currency: state.summary.currency || "EUR" }).format(
                state.summary.averageTicketMinor / 100
              )}
            </p>
          </article>
          <article className="kpi card-hover">
            <h3>{t("admin.revenue.completedCount")}</h3>
            <p>{state.summary.completedCount}</p>
          </article>
          <article className="kpi card-hover">
            <h3>{t("admin.revenue.completedWithAmountCount")}</h3>
            <p>{state.summary.completedWithAmountCount}</p>
          </article>
          <article className="kpi card-hover">
            <h3>{t("admin.revenue.completedWithoutAmountCount")}</h3>
            <p>{state.summary.completedWithoutAmountCount}</p>
          </article>
        </div>
      ) : null}

      {!state.pending && !state.error && state.items.length === 0 ? (
        <EmptyState title={t("admin.revenue.emptyTitle")} description={t("admin.revenue.emptyDescription")} />
      ) : null}

      {state.items.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("public.booking.clientSection")}</th>
                <th>{t("booking.service")}</th>
                <th>{t("admin.revenue.completedAt")}</th>
                <th>{t("admin.revenue.amount")}</th>
                <th>{t("admin.revenue.paymentMethod")}</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.clientName}</td>
                  <td>{item.serviceDisplayName}</td>
                  <td>{new Date(item.completedAt).toLocaleString()}</td>
                  <td>
                    {item.completedAmountMinor && item.completedAmountMinor > 0
                      ? new Intl.NumberFormat(undefined, {
                          style: "currency",
                          currency: item.completedCurrency ?? "EUR"
                        }).format(item.completedAmountMinor / 100)
                      : "—"}
                  </td>
                  <td>{item.completedPaymentMethod ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
