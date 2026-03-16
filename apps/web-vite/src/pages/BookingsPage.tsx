import { useEffect, useState } from "react";
import { listAdminBookings } from "../shared/api/adminApi";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";

type BookingRow = {
  id: string;
  clientName: string;
  serviceId: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
};

export function BookingsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"" | "pending" | "confirmed" | "completed" | "cancelled">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    data: BookingRow[];
  }>({
    pending: true,
    error: null,
    data: []
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, pending: true, error: null }));
    listAdminBookings({
      status: status || undefined,
      from: from || undefined,
      to: to || undefined
    })
      .then((items) => {
        if (!cancelled) {
          setState({
            pending: false,
            error: null,
            data: items.map((item) => ({
              id: item.id,
              clientName: item.clientName,
              serviceId: item.serviceId,
              status: item.status
            }))
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ pending: false, error: t("common.errors.generic"), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status, from, to]);

  return (
    <section className="page-shell">
      <h1>{t("admin.bookings.title")}</h1>
      <div className="booking-controls">
        <label>
          {t("admin.bookings.statusFilter")}
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="">{t("common.value.all")}</option>
            <option value="pending">{t("common.bookingStatus.pending")}</option>
            <option value="confirmed">{t("common.bookingStatus.confirmed")}</option>
            <option value="completed">{t("common.bookingStatus.completed")}</option>
            <option value="cancelled">{t("common.bookingStatus.cancelled")}</option>
          </select>
        </label>
        <label>
          {t("admin.bookings.from")}
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          {t("admin.bookings.to")}
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <div />
      </div>
      {state.pending ? <LoadingState text={t("admin.bookings.loading")} /> : null}
      {state.error ? <ErrorState text={state.error} /> : null}

      {!state.pending && !state.error && state.data.length === 0 ? (
        <EmptyState title={t("admin.bookings.emptyTitle")} description={t("admin.bookings.emptyDescription")} />
      ) : null}

      {state.data.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("common.col.id")}</th>
                <th>{t("public.booking.clientSection")}</th>
                <th>{t("booking.service")}</th>
                <th>{t("common.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>{row.clientName}</td>
                  <td>{row.serviceId}</td>
                  <td>
                    <span className={`status-pill status-${row.status}`}>{t(`common.bookingStatus.${row.status}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
