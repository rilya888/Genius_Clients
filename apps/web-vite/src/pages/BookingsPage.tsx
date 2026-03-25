import { useEffect, useState } from "react";
import { confirmAdminBooking, listAdminBookings } from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";
import { emitAdminBookingsChanged } from "../shared/admin-events";

type BookingRow = {
  id: string;
  clientName: string;
  serviceName: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected";
};

export function BookingsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"" | "pending" | "confirmed" | "completed" | "cancelled" | "rejected">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingBookingId, setConfirmingBookingId] = useState<string | null>(null);
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
    setActionError(null);
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
              serviceName: item.serviceDisplayName,
              status: item.status
            }))
          });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ pending: false, error: formatApiError(error, t("common.errors.generic")), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [status, from, to]);

  async function handleConfirmBooking(bookingId: string) {
    setActionError(null);
    setConfirmingBookingId(bookingId);

    const previous = state.data;
    setState((prev) => ({
      ...prev,
      data:
        status === "pending"
          ? prev.data.filter((row) => row.id !== bookingId)
          : prev.data.map((row) => (row.id === bookingId ? { ...row, status: "confirmed" } : row))
    }));

    try {
      await confirmAdminBooking(bookingId);
      emitAdminBookingsChanged();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        data: previous
      }));
      setActionError(formatApiError(error, t("admin.bookings.confirmFailed")));
    } finally {
      setConfirmingBookingId(null);
    }
  }

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
            <option value="rejected">{t("common.bookingStatus.rejected")}</option>
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
      {actionError ? <ErrorState text={actionError} /> : null}

      {!state.pending && !state.error && state.data.length === 0 ? (
        <EmptyState title={t("admin.bookings.emptyTitle")} description={t("admin.bookings.emptyDescription")} />
      ) : null}

      {state.data.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("public.booking.clientSection")}</th>
                <th>{t("booking.service")}</th>
                <th>{t("common.col.status")}</th>
                <th>{t("common.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.clientName}</td>
                  <td>{row.serviceName}</td>
                  <td>
                    <span className={`status-pill status-${row.status}`}>{t(`common.bookingStatus.${row.status}`)}</span>
                  </td>
                  <td>
                    {row.status === "pending" ? (
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={confirmingBookingId === row.id}
                        onClick={() => handleConfirmBooking(row.id)}
                      >
                        {confirmingBookingId === row.id ? t("auth.loading") : t("admin.bookings.confirmAction")}
                      </button>
                    ) : (
                      <span className="status-muted">-</span>
                    )}
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
