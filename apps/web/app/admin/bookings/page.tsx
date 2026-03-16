"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";
import { isUiV2Enabled } from "../../../lib/ui-flags";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

type BookingItem = {
  id: string;
  clientName: string;
  clientPhoneE164: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
};
type StatusTone = "neutral" | "error" | "success";

function bookingStatusTone(status: BookingStatus): "pending" | "success" | "error" | "info" {
  if (status === "confirmed") {
    return "success";
  }
  if (status === "completed") {
    return "info";
  }
  if (status === "cancelled") {
    return "error";
  }
  return "pending";
}

export default function BookingsPage() {
  const uiV2Enabled = isUiV2Enabled();
  const [items, setItems] = useState<BookingItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  async function load() {
    const queryParams = new URLSearchParams();
    if (statusFilter) {
      queryParams.set("status", statusFilter);
    }
    if (fromDate) {
      queryParams.set("from", new Date(`${fromDate}T00:00:00.000Z`).toISOString());
    }
    if (toDate) {
      queryParams.set("to", new Date(`${toDate}T23:59:59.999Z`).toISOString());
    }
    const qs = queryParams.toString();
    const { response, payload } = await fetchJsonWithSessionRetry<{
      data?: { items?: BookingItem[] };
      error?: { message?: string };
    }>(`/api/admin/bookings${qs ? `?${qs}` : ""}`);
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to load bookings");
      setStatusTone("error");
      return;
    }
    setItems(payload?.data?.items ?? []);
    setStatus("");
    setStatusTone("neutral");
  }

  useEffect(() => {
    void load();
  }, [statusFilter, fromDate, toDate]);

  async function changeStatus(id: string, nextStatus: BookingStatus) {
    const cancellationReason =
      nextStatus === "cancelled" ? window.prompt("Cancellation reason", "Client cancelled") : undefined;
    if (nextStatus === "cancelled" && cancellationReason === null) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/bookings/${id}`,
      {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        status: nextStatus,
        cancellationReason: cancellationReason ?? undefined
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to update booking");
      setStatusTone("error");
      return;
    }
    setStatus("Booking updated");
    setStatusTone("success");
    await load();
  }

  function nextActions(item: BookingItem): BookingStatus[] {
    if (item.status === "pending") {
      return ["confirmed", "cancelled"];
    }
    if (item.status === "confirmed") {
      return ["completed", "cancelled"];
    }
    return [];
  }

  const summary = {
    pending: items.filter((item) => item.status === "pending").length,
    confirmed: items.filter((item) => item.status === "confirmed").length,
    completed: items.filter((item) => item.status === "completed").length,
    cancelled: items.filter((item) => item.status === "cancelled").length
  };

  return (
    <main className={`gc-admin-page${uiV2Enabled ? " gc-admin-page-v2" : ""}`}>
      <h1 className="gc-admin-title">Bookings</h1>
      <p className="gc-admin-subtitle">Track and manage client appointments with status transitions.</p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <div className={`gc-admin-filters${uiV2Enabled ? " gc-admin-filters-v2" : ""}`}>
          <div className="gc-field">
            <span className="gc-field-label">Status filter</span>
            <select className="gc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">pending</option>
              <option value="confirmed">confirmed</option>
              <option value="completed">completed</option>
              <option value="cancelled">cancelled</option>
            </select>
          </div>
          <div className="gc-field">
            <span className="gc-field-label">From date</span>
            <input className="gc-date" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="gc-field">
            <span className="gc-field-label">To date</span>
            <input className="gc-date" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <button className="gc-action-btn" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </section>
      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Status summary</h2>
        <div className="gc-admin-grid-4">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Pending</div>
            <div className="gc-admin-stat-value">{summary.pending}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Confirmed</div>
            <div className="gc-admin-stat-value">{summary.confirmed}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Completed</div>
            <div className="gc-admin-stat-value">{summary.completed}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Cancelled</div>
            <div className="gc-admin-stat-value">{summary.cancelled}</div>
          </div>
        </div>
      </section>

      <div className={`gc-admin-table-wrap${uiV2Enabled ? " gc-admin-table-wrap-v2" : ""}`}>
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Phone</th>
              <th>Start</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.clientName}</td>
                <td>{item.clientPhoneE164}</td>
                <td>{new Date(item.startAt).toLocaleString()}</td>
                <td>
                  <span className="gc-status-chip" data-tone={bookingStatusTone(item.status)}>
                    {item.status}
                  </span>
                </td>
                <td>
                  <div className="gc-inline-actions">
                    {nextActions(item).map((nextStatus) => (
                      <button
                        key={nextStatus}
                        className="gc-pill-btn"
                        onClick={() => void changeStatus(item.id, nextStatus)}
                      >
                        {nextStatus}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="gc-empty-cell" colSpan={5}>
                  No bookings found for the selected filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
