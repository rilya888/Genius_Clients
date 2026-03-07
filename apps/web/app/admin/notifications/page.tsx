"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type DeliveryItem = {
  id: string;
  bookingId: string | null;
  notificationType: string;
  channel: string;
  recipient: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  deadLetteredAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
};

type DeliverySummary = {
  queued: number;
  sent: number;
  failed: number;
  deadLetter: number;
  total: number;
};

export default function NotificationsPage() {
  const [items, setItems] = useState<DeliveryItem[]>([]);
  const [summary, setSummary] = useState<DeliverySummary>({
    queued: 0,
    sent: 0,
    failed: 0,
    deadLetter: 0,
    total: 0
  });
  const [role, setRole] = useState<string>("");
  const [status, setStatus] = useState("");

  async function load() {
    const [meResult, listResult, summaryResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { role?: string } }>("/api/auth/me"),
      fetchJsonWithSessionRetry<{
        data?: { items?: DeliveryItem[] };
        error?: { message?: string };
      }>("/api/admin/notification-deliveries?limit=100"),
      fetchJsonWithSessionRetry<{ data?: DeliverySummary }>("/api/admin/notification-deliveries/summary")
    ]);
    if (meResult.response.ok) {
      setRole(meResult.payload?.data?.role ?? "");
    }
    const { response, payload } = listResult;
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to load notification deliveries");
      return;
    }
    setItems(payload?.data?.items ?? []);
    if (summaryResult.response.ok && summaryResult.payload?.data) {
      setSummary(summaryResult.payload.data);
    }
    setStatus("");
  }

  async function retryFailed() {
    const { response, payload } = await fetchJsonWithSessionRetry<{
      data?: { queued?: number };
      error?: { message?: string };
    }>("/api/admin/notification-deliveries/retry-failed", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 200 })
    });

    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Retry failed");
      return;
    }

    setStatus(`Queued for retry: ${payload?.data?.queued ?? 0}`);
    await load();
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Notification Deliveries</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => void load()}>Refresh</button>
        {role === "owner" ? <button onClick={() => void retryFailed()}>Retry failed</button> : null}
      </div>
      <p style={{ color: "#4b5563", minHeight: 20 }}>{status}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
          <div style={{ color: "#6b7280", fontSize: 12 }}>Total</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.total}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
          <div style={{ color: "#6b7280", fontSize: 12 }}>Queued</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.queued}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
          <div style={{ color: "#6b7280", fontSize: 12 }}>Sent</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.sent}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
          <div style={{ color: "#6b7280", fontSize: 12 }}>Failed</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.failed}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}>
          <div style={{ color: "#6b7280", fontSize: 12 }}>Dead Letter</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{summary.deadLetter}</div>
        </div>
      </div>

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
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Created</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Type</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Channel</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Recipient</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Status</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Attempts</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Sent At</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Error</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                {new Date(item.createdAt).toLocaleString()}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.notificationType}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.channel}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.recipient}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.status}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                {item.attemptCount}/{item.maxAttempts}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                {item.sentAt ? new Date(item.sentAt).toLocaleString() : "-"}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                {item.errorCode ?? item.errorMessage ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
