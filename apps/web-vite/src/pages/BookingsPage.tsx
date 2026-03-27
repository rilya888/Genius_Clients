import { useEffect, useState } from "react";
import { confirmAdminBooking, listAdminBookings, updateAdminBookingStatus } from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";
import { emitAdminBookingsChanged } from "../shared/admin-events";

type BookingRow = {
  id: string;
  clientName: string;
  serviceName: string;
  startAt: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" | "no_show";
};

export function BookingsPage() {
  const { t } = useI18n();
  const [status, setStatus] = useState<"" | "pending" | "confirmed" | "completed" | "cancelled" | "rejected" | "no_show">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [processingBookingId, setProcessingBookingId] = useState<string | null>(null);
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
              startAt: item.startAt,
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
    setProcessingBookingId(bookingId);

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
      setProcessingBookingId(null);
    }
  }

  async function handleBookingStatusAction(bookingId: string, currentStatus: BookingRow["status"], nextStatus: BookingRow["status"]) {
    setActionError(null);
    setProcessingBookingId(bookingId);
    try {
      if (nextStatus === "cancelled") {
        const cancellationReason = window.prompt(t("admin.bookings.cancelReasonPrompt"), "");
        if (!cancellationReason?.trim()) {
          setProcessingBookingId(null);
          return;
        }
        await updateAdminBookingStatus({
          bookingId,
          status: "cancelled",
          cancellationReason: cancellationReason.trim()
        });
      } else if (nextStatus === "rejected") {
        const rejectionReason = window.prompt(t("admin.bookings.rejectReasonPrompt"), "");
        if (!rejectionReason?.trim()) {
          setProcessingBookingId(null);
          return;
        }
        await updateAdminBookingStatus({
          bookingId,
          status: "rejected",
          rejectionReason: rejectionReason.trim()
        });
      } else if (nextStatus === "completed") {
        const amountRaw = window.prompt(t("admin.bookings.completeAmountPrompt"), "");
        const amountNormalized = amountRaw?.trim() ?? "";
        let completedAmountMinor: number | null = null;
        if (amountNormalized.length > 0) {
          const amountValue = Number(amountNormalized.replace(",", "."));
          if (!Number.isFinite(amountValue) || amountValue <= 0) {
            throw new Error("completed_amount_invalid");
          }
          completedAmountMinor = Math.round(amountValue * 100);
        }
        await updateAdminBookingStatus({
          bookingId,
          status: "completed",
          completedAmountMinor,
          completedCurrency: "EUR"
        });
      } else if (nextStatus === "no_show") {
        await updateAdminBookingStatus({
          bookingId,
          status: "no_show"
        });
      } else if (nextStatus === "confirmed" && currentStatus === "pending") {
        await confirmAdminBooking(bookingId);
      } else {
        setProcessingBookingId(null);
        return;
      }

      setState((prev) => ({
        ...prev,
        data:
          status && status !== nextStatus
            ? prev.data.filter((row) => row.id !== bookingId)
            : prev.data.map((row) => (row.id === bookingId ? { ...row, status: nextStatus } : row))
      }));
      emitAdminBookingsChanged();
    } catch (error) {
      const fallbackKey =
        nextStatus === "confirmed"
          ? "admin.bookings.confirmFailed"
          : nextStatus === "cancelled"
            ? "admin.bookings.cancelFailed"
            : nextStatus === "rejected"
              ? "admin.bookings.rejectFailed"
              : nextStatus === "completed"
                ? "admin.bookings.completeFailed"
                : "admin.bookings.noShowFailed";
      const fallbackMessage =
        error instanceof Error && error.message === "completed_amount_invalid"
          ? t("admin.bookings.completeAmountInvalid")
          : t(fallbackKey);
      setActionError(formatApiError(error, fallbackMessage));
    } finally {
      setProcessingBookingId(null);
    }
  }

  function renderActions(row: BookingRow) {
    const bookingStartMs = new Date(row.startAt).getTime();
    const canCompleteNow = Number.isFinite(bookingStartMs) ? bookingStartMs <= Date.now() : true;
    if (row.status === "pending") {
      return (
        <div className="inline-actions booking-row-actions">
          <button
            className="btn btn-ghost"
            type="button"
            disabled={processingBookingId === row.id}
            onClick={() => handleConfirmBooking(row.id)}
          >
            {processingBookingId === row.id ? t("auth.loading") : t("admin.bookings.confirmAction")}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={processingBookingId === row.id}
            onClick={() => void handleBookingStatusAction(row.id, row.status, "cancelled")}
          >
            {t("admin.bookings.cancelAction")}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={processingBookingId === row.id}
            onClick={() => void handleBookingStatusAction(row.id, row.status, "rejected")}
          >
            {t("admin.bookings.rejectAction")}
          </button>
        </div>
      );
    }
    if (row.status === "confirmed") {
      return (
        <div className="inline-actions booking-row-actions">
          <button
            className="btn btn-ghost"
            type="button"
            disabled={processingBookingId === row.id || !canCompleteNow}
            title={!canCompleteNow ? t("admin.bookings.completeFutureHint") : undefined}
            onClick={() => void handleBookingStatusAction(row.id, row.status, "completed")}
          >
            {t("admin.bookings.completeAction")}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={processingBookingId === row.id}
            onClick={() => void handleBookingStatusAction(row.id, row.status, "no_show")}
          >
            {t("admin.bookings.noShowAction")}
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={processingBookingId === row.id}
            onClick={() => void handleBookingStatusAction(row.id, row.status, "cancelled")}
          >
            {t("admin.bookings.cancelAction")}
          </button>
        </div>
      );
    }
    return <span className="status-muted">-</span>;
  }

  return (
    <section className="page-shell">
      <h1>{t("admin.bookings.title")}</h1>
      <div className="booking-controls booking-controls-compact">
        <label>
          {t("admin.bookings.statusFilter")}
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="">{t("common.value.all")}</option>
            <option value="pending">{t("common.bookingStatus.pending")}</option>
            <option value="confirmed">{t("common.bookingStatus.confirmed")}</option>
            <option value="completed">{t("common.bookingStatus.completed")}</option>
            <option value="cancelled">{t("common.bookingStatus.cancelled")}</option>
            <option value="rejected">{t("common.bookingStatus.rejected")}</option>
            <option value="no_show">{t("common.bookingStatus.no_show")}</option>
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
      </div>
      {state.pending ? <LoadingState text={t("admin.bookings.loading")} /> : null}
      {state.error ? <ErrorState text={state.error} /> : null}
      {actionError ? <ErrorState text={actionError} /> : null}

      {!state.pending && !state.error && state.data.length === 0 ? (
        <EmptyState title={t("admin.bookings.emptyTitle")} description={t("admin.bookings.emptyDescription")} />
      ) : null}

      {state.data.length > 0 ? (
        <div className="table-shell booking-table-desktop">
          <table>
            <thead>
              <tr>
                <th>{t("public.booking.clientSection")}</th>
                <th>{t("booking.service")}</th>
                <th>{t("common.col.date")}</th>
                <th>{t("common.col.status")}</th>
                <th>{t("common.col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((row) => (
                <tr key={row.id}>
                  <td>{row.clientName}</td>
                  <td>{row.serviceName}</td>
                  <td>{new Date(row.startAt).toLocaleString()}</td>
                  <td>
                    <span className={`status-pill status-${row.status}`}>{t(`common.bookingStatus.${row.status}`)}</span>
                  </td>
                  <td>{renderActions(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {state.data.length > 0 ? (
        <div className="booking-mobile-list">
          {state.data.map((row) => (
            <article className="booking-mobile-card" key={row.id}>
              <header className="booking-mobile-header">
                <strong>{row.clientName}</strong>
                <span className={`status-pill status-${row.status}`}>{t(`common.bookingStatus.${row.status}`)}</span>
              </header>
              <p>{row.serviceName}</p>
              <p className="status-muted">{new Date(row.startAt).toLocaleString()}</p>
              {renderActions(row)}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
