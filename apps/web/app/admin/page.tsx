"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../lib/client-api";
import { isUiV2Enabled } from "../../lib/ui-flags";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
type Booking = { status: BookingStatus };
type IntegrationsStatus = {
  redis: boolean;
  sentry: boolean;
  stripe: boolean;
  openai: boolean;
  whatsapp: boolean;
  telegram: boolean;
  email: boolean;
};
type StatusTone = "neutral" | "error";

export default function AdminPage() {
  const uiV2Enabled = isUiV2Enabled();
  const [mastersCount, setMastersCount] = useState(0);
  const [servicesCount, setServicesCount] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  useEffect(() => {
    async function load() {
      const [mastersResult, servicesResult, bookingsResult, integrationsResult] = await Promise.all([
        fetchJsonWithSessionRetry<{ data?: { items?: unknown[] } }>("/api/admin/masters"),
        fetchJsonWithSessionRetry<{ data?: { items?: unknown[] } }>("/api/admin/services"),
        fetchJsonWithSessionRetry<{ data?: { items?: Booking[] } }>("/api/admin/bookings?limit=200"),
        fetchJsonWithSessionRetry<{ data?: IntegrationsStatus }>("/api/admin/integrations/status")
      ]);

      if (!mastersResult.response.ok || !servicesResult.response.ok || !bookingsResult.response.ok) {
        setStatus("Failed to load dashboard data");
        setStatusTone("error");
        return;
      }

      setMastersCount((mastersResult.payload?.data?.items ?? []).length);
      setServicesCount((servicesResult.payload?.data?.items ?? []).length);
      setBookings(bookingsResult.payload?.data?.items ?? []);
      if (integrationsResult.response.ok && integrationsResult.payload?.data) {
        setIntegrations(integrationsResult.payload.data);
      }
      setStatus("");
      setStatusTone("neutral");
    }

    void load();
  }, []);

  const stats = useMemo(() => {
    const pending = bookings.filter((item) => item.status === "pending").length;
    const confirmed = bookings.filter((item) => item.status === "confirmed").length;
    const completed = bookings.filter((item) => item.status === "completed").length;
    const cancelled = bookings.filter((item) => item.status === "cancelled").length;
    return { pending, confirmed, completed, cancelled };
  }, [bookings]);

  return (
    <main className={`gc-admin-page${uiV2Enabled ? " gc-admin-page-v2" : ""}`}>
      <h1 className="gc-admin-title">Admin Dashboard</h1>
      <p className="gc-admin-subtitle">
        Operational snapshot and links for day-to-day tenant management.
      </p>
      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <div className={uiV2Enabled ? "gc-admin-v2-section-head" : ""}>
          <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Core counters</h2>
        </div>
        <div className="gc-admin-grid-3">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Masters</div>
            <div className="gc-admin-stat-value">{mastersCount}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Services</div>
            <div className="gc-admin-stat-value">{servicesCount}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Bookings (loaded)</div>
            <div className="gc-admin-stat-value">{bookings.length}</div>
          </div>
        </div>
      </section>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Booking Status</h2>
        <div className="gc-admin-grid-4">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Pending</div>
            <div className="gc-admin-stat-value">{stats.pending}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Confirmed</div>
            <div className="gc-admin-stat-value">{stats.confirmed}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Completed</div>
            <div className="gc-admin-stat-value">{stats.completed}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Cancelled</div>
            <div className="gc-admin-stat-value">{stats.cancelled}</div>
          </div>
        </div>
      </section>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Sections</h2>
        <ul className="gc-admin-links">
          <li>
            <a href="/admin/masters">Masters</a>
          </li>
          <li>
            <a href="/admin/services">Services</a>
          </li>
          <li>
            <a href="/admin/master-translations">Master Translations</a>
          </li>
          <li>
            <a href="/admin/service-translations">Service Translations</a>
          </li>
          <li>
            <a href="/admin/master-services">Master Services</a>
          </li>
          <li>
            <a href="/admin/working-hours">Working Hours</a>
          </li>
          <li>
            <a href="/admin/exceptions">Schedule Exceptions</a>
          </li>
          <li>
            <a href="/admin/bookings">Bookings</a>
          </li>
          <li>
            <a href="/admin/settings">Tenant Settings</a>
          </li>
          <li>
            <a href="/admin/notifications">Notification Deliveries</a>
          </li>
        </ul>
      </section>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Integrations Status</h2>
        <div className="gc-admin-grid-4">
          {(
            [
              ["redis", integrations?.redis],
              ["sentry", integrations?.sentry],
              ["stripe", integrations?.stripe],
              ["openai", integrations?.openai],
              ["whatsapp", integrations?.whatsapp],
              ["telegram", integrations?.telegram],
              ["email", integrations?.email]
            ] as Array<[string, boolean | undefined]>
          ).map(([name, enabled]) => (
            <div key={name} className="gc-card gc-status-card-small">
              <div className="gc-status-name">{name}</div>
              <div className="gc-status-value">
                <span className="gc-status-chip" data-tone={enabled ? "success" : "error"}>
                  {enabled ? "configured" : "missing"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
