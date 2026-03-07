"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

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
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Bookings</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="confirmed">confirmed</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button onClick={() => void load()}>Refresh</button>
      </div>
      <p style={{ color: "#4b5563", minHeight: 20 }}>{status}</p>

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          background: "#fff",
          border: "1px solid #e5e7eb"
        }}
      >
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Client</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Phone</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Start</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Status</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.clientName}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.clientPhoneE164}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                {new Date(item.startAt).toLocaleString()}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.status}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", display: "flex", gap: 6 }}>
                {nextActions(item).map((nextStatus) => (
                  <button key={nextStatus} onClick={() => void changeStatus(item.id, nextStatus)}>
                    {nextStatus}
                  </button>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
