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
    <main className="gc-admin-page">
      <h1 className="gc-admin-title">Notification Deliveries</h1>
      <div className="gc-admin-filters">
        <button className="gc-action-btn" onClick={() => void load()}>
          Refresh
        </button>
        {role === "owner" ? (
          <button className="gc-action-btn" onClick={() => void retryFailed()}>
            Retry failed
          </button>
        ) : null}
      </div>
      <p className="gc-muted-line">{status}</p>
      <div className="gc-notifications-summary-grid">
        <div className="gc-card gc-status-card-small">
          <div className="gc-status-name">Total</div>
          <div className="gc-status-value">{summary.total}</div>
        </div>
        <div className="gc-card gc-status-card-small">
          <div className="gc-status-name">Queued</div>
          <div className="gc-status-value">{summary.queued}</div>
        </div>
        <div className="gc-card gc-status-card-small">
          <div className="gc-status-name">Sent</div>
          <div className="gc-status-value">{summary.sent}</div>
        </div>
        <div className="gc-card gc-status-card-small">
          <div className="gc-status-name">Failed</div>
          <div className="gc-status-value">{summary.failed}</div>
        </div>
        <div className="gc-card gc-status-card-small">
          <div className="gc-status-name">Dead Letter</div>
          <div className="gc-status-value">{summary.deadLetter}</div>
        </div>
      </div>

      <div className="gc-admin-table-wrap">
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Type</th>
              <th>Channel</th>
              <th>Recipient</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Sent At</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{new Date(item.createdAt).toLocaleString()}</td>
                <td>{item.notificationType}</td>
                <td>{item.channel}</td>
                <td>{item.recipient}</td>
                <td>{item.status}</td>
                <td>
                  {item.attemptCount}/{item.maxAttempts}
                </td>
                <td>{item.sentAt ? new Date(item.sentAt).toLocaleString() : "-"}</td>
                <td>{item.errorCode ?? item.errorMessage ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
