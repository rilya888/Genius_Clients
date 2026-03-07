"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../lib/client-api";

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

export default function AdminPage() {
  const [mastersCount, setMastersCount] = useState(0);
  const [servicesCount, setServicesCount] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  const [status, setStatus] = useState("");

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
        return;
      }

      setMastersCount((mastersResult.payload?.data?.items ?? []).length);
      setServicesCount((servicesResult.payload?.data?.items ?? []).length);
      setBookings(bookingsResult.payload?.data?.items ?? []);
      if (integrationsResult.response.ok && integrationsResult.payload?.data) {
        setIntegrations(integrationsResult.payload.data);
      }
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
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Admin Dashboard</h1>
      <p style={{ color: "#4b5563" }}>
        Quick links and live counters from `/api/v1/admin/*`.
      </p>
      <p style={{ color: "#4b5563", minHeight: 20 }}>{status}</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Masters</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{mastersCount}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Services</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{servicesCount}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Bookings (loaded)</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{bookings.length}</div>
        </div>
      </div>

      <h2 style={{ marginTop: 22 }}>Booking Status</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Pending</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.pending}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Confirmed</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.confirmed}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Completed</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.completed}</div>
        </div>
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14 }}>
          <div style={{ color: "#6b7280", fontSize: 13 }}>Cancelled</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stats.cancelled}</div>
        </div>
      </div>

      <h2 style={{ marginTop: 22 }}>Sections</h2>
      <ul>
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

      <h2 style={{ marginTop: 22 }}>Integrations Status</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
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
          <div
            key={name}
            style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10 }}
          >
            <div style={{ color: "#6b7280", fontSize: 12 }}>{name}</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{enabled ? "configured" : "missing"}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
