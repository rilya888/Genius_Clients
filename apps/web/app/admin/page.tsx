"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../lib/client-api";
import { isUiV2Enabled } from "../../lib/ui-flags";

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";
type Booking = {
  id: string;
  clientName: string;
  startAt: string;
  status: BookingStatus;
};
type IntegrationsStatus = {
  redis: boolean;
  sentry: boolean;
  stripe: boolean;
  openai: boolean;
  whatsapp: boolean;
  whatsappTemplates?: {
    reminder24h?: boolean;
    reminder2h?: boolean;
    adminBookingCreated?: boolean;
  };
  telegram: boolean;
  email: boolean;
};

type OpsHealthResponse = {
  botHealthUrl: string | null;
  workerHealthUrl: string | null;
  bot: {
    status: "ok" | "error" | "not_configured";
    httpStatus?: number | null;
    data?: {
      status?: string;
      service?: string;
      stats?: Record<string, number>;
    } | null;
    error?: string;
  };
  worker: {
    status: "ok" | "error" | "not_configured";
    httpStatus?: number | null;
    data?: {
      status?: string;
      service?: string;
      delivery?: {
        stats?: { sent?: number; failed?: number; processed?: number };
      };
      templates?: {
        reminder24hConfigured?: boolean;
        reminder2hConfigured?: boolean;
        adminBookingConfigured?: boolean;
      };
    } | null;
    error?: string;
  };
};
type OpsKpiResponse = {
  bookingStatus: {
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    total: number;
  };
  deliveryStatus: {
    queued: number;
    sent: number;
    failed: number;
    deadLetter: number;
    total: number;
  };
  completionRate: number;
  notificationFailureRate: number;
  generatedAt: string;
  conversational?: {
    source?: string;
    dayKey?: string | null;
    unknownIntentHandled?: number;
    handoffEscalations?: number;
    fallbackTextHandled?: number;
    complaintSignalsDetected?: number;
    complaintHandoffs?: number;
    complaintToHandoffLatencyAvgMs?: number;
  };
};
type StatusTone = "neutral" | "error";

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

export default function AdminPage() {
  const uiV2Enabled = isUiV2Enabled();
  const [mastersCount, setMastersCount] = useState(0);
  const [servicesCount, setServicesCount] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [opsHealth, setOpsHealth] = useState<OpsHealthResponse | null>(null);
  const [opsKpi, setOpsKpi] = useState<OpsKpiResponse | null>(null);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  useEffect(() => {
    async function load() {
      const [mastersResult, servicesResult, bookingsResult, integrationsResult, opsResult, kpiResult] = await Promise.all([
        fetchJsonWithSessionRetry<{ data?: { items?: unknown[] } }>("/api/admin/masters"),
        fetchJsonWithSessionRetry<{ data?: { items?: unknown[] } }>("/api/admin/services"),
        fetchJsonWithSessionRetry<{ data?: { items?: Booking[] } }>("/api/admin/bookings?limit=200"),
        fetchJsonWithSessionRetry<{ data?: IntegrationsStatus }>("/api/admin/integrations/status"),
        fetchJsonWithSessionRetry<{ data?: OpsHealthResponse }>("/api/admin/ops/health"),
        fetchJsonWithSessionRetry<{ data?: OpsKpiResponse }>("/api/admin/ops/kpi")
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
      if (opsResult.response.ok && opsResult.payload?.data) {
        setOpsHealth(opsResult.payload.data);
      }
      if (kpiResult.response.ok && kpiResult.payload?.data) {
        setOpsKpi(kpiResult.payload.data);
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

  const quickActions = [
    { href: "/admin/bookings", label: "Manage bookings", note: "Confirm, complete, cancel" },
    { href: "/admin/services", label: "Edit services", note: "Catalog, pricing, sort order" },
    { href: "/admin/working-hours", label: "Update schedule", note: "Hours, exceptions, overrides" },
    { href: "/admin/settings", label: "Tenant settings", note: "Locale, AI, notifications" }
  ];

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
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Quick actions</h2>
        <div className="gc-admin-quick-grid">
          {quickActions.map((action) => (
            <a key={action.href} href={action.href} className="gc-card gc-admin-quick-card">
              <strong>{action.label}</strong>
              <span>{action.note}</span>
            </a>
          ))}
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
              ["wa_template_reminder_24h", integrations?.whatsappTemplates?.reminder24h],
              ["wa_template_reminder_2h", integrations?.whatsappTemplates?.reminder2h],
              ["wa_template_admin_booking", integrations?.whatsappTemplates?.adminBookingCreated],
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

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Bot & Worker Health</h2>
        <div className="gc-admin-grid-3">
          <div className="gc-card gc-status-card-small">
            <div className="gc-status-name">bot health</div>
            <div className="gc-status-value">
              <span className="gc-status-chip" data-tone={opsHealth?.bot?.status === "ok" ? "success" : "error"}>
                {opsHealth?.bot?.status ?? "unknown"}
              </span>
            </div>
            <div className="gc-muted-line">
              ai: {opsHealth?.bot?.data?.stats?.aiHandled ?? 0} · det:{" "}
              {opsHealth?.bot?.data?.stats?.deterministicHandled ?? 0}
            </div>
            <div className="gc-muted-line">
              unknown: {opsHealth?.bot?.data?.stats?.unknownIntentHandled ?? 0} · handoff:{" "}
              {opsHealth?.bot?.data?.stats?.handoffEscalations ?? 0}
            </div>
            <div className="gc-muted-line">
              complaints: {opsHealth?.bot?.data?.stats?.complaintSignalsDetected ?? 0} · c-handoff:{" "}
              {opsHealth?.bot?.data?.stats?.complaintHandoffs ?? 0}
            </div>
          </div>
          <div className="gc-card gc-status-card-small">
            <div className="gc-status-name">worker health</div>
            <div className="gc-status-value">
              <span className="gc-status-chip" data-tone={opsHealth?.worker?.status === "ok" ? "success" : "error"}>
                {opsHealth?.worker?.status ?? "unknown"}
              </span>
            </div>
            <div className="gc-muted-line">
              sent: {opsHealth?.worker?.data?.delivery?.stats?.sent ?? 0} · failed:{" "}
              {opsHealth?.worker?.data?.delivery?.stats?.failed ?? 0}
            </div>
          </div>
          <div className="gc-card gc-status-card-small">
            <div className="gc-status-name">worker templates</div>
            <div className="gc-muted-line">
              24h: {opsHealth?.worker?.data?.templates?.reminder24hConfigured ? "on" : "off"}
            </div>
            <div className="gc-muted-line">
              2h: {opsHealth?.worker?.data?.templates?.reminder2hConfigured ? "on" : "off"}
            </div>
            <div className="gc-muted-line">
              admin: {opsHealth?.worker?.data?.templates?.adminBookingConfigured ? "on" : "off"}
            </div>
          </div>
        </div>
      </section>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Ops KPI</h2>
        <div className="gc-admin-grid-4">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Completion Rate</div>
            <div className="gc-admin-stat-value">{Math.round((opsKpi?.completionRate ?? 0) * 100)}%</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Notification Failure</div>
            <div className="gc-admin-stat-value">{Math.round((opsKpi?.notificationFailureRate ?? 0) * 100)}%</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Booked Total</div>
            <div className="gc-admin-stat-value">{opsKpi?.bookingStatus?.total ?? 0}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Notifications Total</div>
            <div className="gc-admin-stat-value">{opsKpi?.deliveryStatus?.total ?? 0}</div>
          </div>
        </div>
        <div className="gc-admin-grid-3" style={{ marginTop: 12 }}>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Unknown (day)</div>
            <div className="gc-admin-stat-value">{opsKpi?.conversational?.unknownIntentHandled ?? 0}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Handoffs (day)</div>
            <div className="gc-admin-stat-value">{opsKpi?.conversational?.handoffEscalations ?? 0}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Fallback (day)</div>
            <div className="gc-admin-stat-value">{opsKpi?.conversational?.fallbackTextHandled ?? 0}</div>
          </div>
        </div>
        <div className="gc-admin-grid-3" style={{ marginTop: 12 }}>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Complaints (day)</div>
            <div className="gc-admin-stat-value">{opsKpi?.conversational?.complaintSignalsDetected ?? 0}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Complaint Handoffs</div>
            <div className="gc-admin-stat-value">{opsKpi?.conversational?.complaintHandoffs ?? 0}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Complaint→Handoff Avg</div>
            <div className="gc-admin-stat-value">
              {Math.round((opsKpi?.conversational?.complaintToHandoffLatencyAvgMs ?? 0) / 1000)}s
            </div>
          </div>
        </div>
      </section>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Today focus</h2>
        <div className="gc-admin-grid-3">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Pending approvals</div>
            <div className="gc-admin-stat-value">{opsKpi?.bookingStatus?.pending ?? stats.pending}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Deliveries queued</div>
            <div className="gc-admin-stat-value">{opsKpi?.deliveryStatus?.queued ?? 0}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Dead letter entries</div>
            <div className="gc-admin-stat-value">{opsKpi?.deliveryStatus?.deadLetter ?? 0}</div>
          </div>
        </div>
      </section>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Recent bookings</h2>
        <div className="gc-admin-recent-list">
          {bookings.slice(0, 6).map((item) => (
            <article key={item.id} className="gc-card gc-admin-recent-item">
              <div className="gc-admin-recent-main">
                <strong>{item.clientName}</strong>
                <span>{new Date(item.startAt).toLocaleString()}</span>
              </div>
              <span className="gc-status-chip" data-tone={bookingStatusTone(item.status)}>
                {item.status}
              </span>
            </article>
          ))}
          {bookings.length === 0 ? (
            <p className="gc-muted-line">No bookings loaded yet.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
