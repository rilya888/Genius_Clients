"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled" | "rejected";

type BookingItem = {
  id: string;
  clientName: string;
  clientPhoneE164: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
};

export default function BookingsPage() {
  const [items, setItems] = useState<BookingItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [status, setStatus] = useState("");

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
      return;
    }
    setItems(payload?.data?.items ?? []);
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
      return;
    }
    setStatus("Booking updated");
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

  return (
    <main className="gc-admin-page">
      <h1 className="gc-admin-title">Bookings</h1>
      <div className="gc-admin-filters">
        <div className="gc-field">
          <span className="gc-field-label">Status filter</span>
          <select className="gc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">pending</option>
            <option value="confirmed">confirmed</option>
            <option value="completed">completed</option>
            <option value="cancelled">cancelled</option>
            <option value="rejected">rejected</option>
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
      <p className="gc-muted-line">{status}</p>

      <div className="gc-admin-table-wrap">
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
                <td>{item.status}</td>
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
          </tbody>
        </table>
      </div>
    </main>
  );
}
