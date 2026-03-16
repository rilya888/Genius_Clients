"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type StatusTone = "neutral" | "error" | "success";

export default function TenantSettingsPage() {
  const [role, setRole] = useState<string>("");
  const [defaultLocale, setDefaultLocale] = useState<"it" | "en">("it");
  const [timezone, setTimezone] = useState("Europe/Rome");
  const [bookingHorizonDays, setBookingHorizonDays] = useState("30");
  const [bookingMinAdvanceMinutes, setBookingMinAdvanceMinutes] = useState("0");
  const [bookingBufferMinutes, setBookingBufferMinutes] = useState("0");
  const [adminNotificationEmail, setAdminNotificationEmail] = useState("");
  const [adminNotificationWhatsappE164, setAdminNotificationWhatsappE164] = useState("");
  const [openaiEnabled, setOpenaiEnabled] = useState(true);
  const [openaiModel, setOpenaiModel] = useState("gpt-5-mini");
  const [humanHandoffEnabled, setHumanHandoffEnabled] = useState(true);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  useEffect(() => {
    async function load() {
      const [meResult, settingsResult] = await Promise.all([
        fetchJsonWithSessionRetry<{ data?: { role?: string }; error?: { message?: string } }>("/api/auth/me"),
        fetchJsonWithSessionRetry<{
          data?: {
            defaultLocale?: "it" | "en";
            timezone?: string;
            bookingHorizonDays?: number;
            bookingMinAdvanceMinutes?: number;
            bookingBufferMinutes?: number;
            adminNotificationEmail?: string | null;
            adminNotificationWhatsappE164?: string | null;
            openaiEnabled?: boolean;
            openaiModel?: string;
            humanHandoffEnabled?: boolean;
          };
          error?: { message?: string };
        }>("/api/admin/tenant-settings")
      ]);
      if (!meResult.response.ok) {
        setStatus(meResult.payload?.error?.message ?? "Failed to load session");
        setStatusTone("error");
        return;
      }
      if (!settingsResult.response.ok) {
        setStatus(settingsResult.payload?.error?.message ?? "Failed to load settings");
        setStatusTone("error");
        return;
      }

      setRole(meResult.payload?.data?.role ?? "");

      const data = settingsResult.payload?.data;
      setDefaultLocale(data?.defaultLocale === "en" ? "en" : "it");
      setTimezone(data?.timezone ?? "Europe/Rome");
      setBookingHorizonDays(String(data?.bookingHorizonDays ?? 30));
      setBookingMinAdvanceMinutes(String(data?.bookingMinAdvanceMinutes ?? 0));
      setBookingBufferMinutes(String(data?.bookingBufferMinutes ?? 0));
      setAdminNotificationEmail(data?.adminNotificationEmail ?? "");
      setAdminNotificationWhatsappE164(data?.adminNotificationWhatsappE164 ?? "");
      setOpenaiEnabled(data?.openaiEnabled ?? true);
      setOpenaiModel(data?.openaiModel ?? "gpt-5-mini");
      setHumanHandoffEnabled(data?.humanHandoffEnabled ?? true);
      setStatus("");
      setStatusTone("neutral");
    }

    void load();
  }, []);

  async function save() {
    if (role !== "owner") {
      setStatus("Only owner can update tenant settings");
      setStatusTone("error");
      return;
    }

    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/tenant-settings",
      {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        defaultLocale,
        timezone,
        bookingHorizonDays: Number(bookingHorizonDays),
        bookingMinAdvanceMinutes: Number(bookingMinAdvanceMinutes),
        bookingBufferMinutes: Number(bookingBufferMinutes),
        adminNotificationEmail: adminNotificationEmail || null,
        adminNotificationWhatsappE164: adminNotificationWhatsappE164 || null,
        openaiEnabled,
        openaiModel,
        humanHandoffEnabled
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to save settings");
      setStatusTone("error");
      return;
    }

    setStatus("Settings saved");
    setStatusTone("success");
  }

  return (
    <main className="gc-settings-page">
      <h1 className="gc-admin-title">Tenant Settings</h1>
      <p className="gc-admin-subtitle">Configure locale, scheduling constraints, and AI notification behavior.</p>
      {role && role !== "owner" ? (
        <p className="gc-warning-text">Current role: {role}. Settings update requires owner role.</p>
      ) : null}
      <div className="gc-card gc-form-card">
        <label className="gc-form-label">
          Default Locale
          <select
            className="gc-select"
            value={defaultLocale}
            onChange={(e) => setDefaultLocale(e.target.value as "it" | "en")}
          >
            <option value="it">it</option>
            <option value="en">en</option>
          </select>
        </label>

        <label className="gc-form-label">
          Timezone
          <input className="gc-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </label>

        <label className="gc-form-label">
          Booking Horizon Days
          <input
            className="gc-input"
            value={bookingHorizonDays}
            onChange={(e) => setBookingHorizonDays(e.target.value)}
          />
        </label>

        <label className="gc-form-label">
          Min Advance Minutes
          <input
            className="gc-input"
            value={bookingMinAdvanceMinutes}
            onChange={(e) => setBookingMinAdvanceMinutes(e.target.value)}
          />
        </label>

        <label className="gc-form-label">
          Buffer Minutes
          <input
            className="gc-input"
            value={bookingBufferMinutes}
            onChange={(e) => setBookingBufferMinutes(e.target.value)}
          />
        </label>

        <label className="gc-form-label">
          Admin Notification Email
          <input
            className="gc-input"
            value={adminNotificationEmail}
            onChange={(e) => setAdminNotificationEmail(e.target.value)}
          />
        </label>

        <label className="gc-form-label">
          Admin WhatsApp E.164
          <input
            className="gc-input"
            value={adminNotificationWhatsappE164}
            onChange={(e) => setAdminNotificationWhatsappE164(e.target.value)}
          />
        </label>

        <label className="gc-form-label">
          OpenAI Enabled
          <select
            className="gc-select"
            value={openaiEnabled ? "true" : "false"}
            onChange={(e) => setOpenaiEnabled(e.target.value === "true")}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>

        <label className="gc-form-label">
          OpenAI Model
          <input className="gc-input" value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} />
        </label>

        <label className="gc-form-label">
          Human Handoff Enabled
          <select
            className="gc-select"
            value={humanHandoffEnabled ? "true" : "false"}
            onChange={(e) => setHumanHandoffEnabled(e.target.value === "true")}
          >
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>

        <button className="gc-action-btn" onClick={save} disabled={role !== "owner"}>
          Save
        </button>
      </div>

      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>
    </main>
  );
}
