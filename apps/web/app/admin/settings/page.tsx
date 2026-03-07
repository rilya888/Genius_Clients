"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

export default function TenantSettingsPage() {
  const [role, setRole] = useState<string>("");
  const [defaultLocale, setDefaultLocale] = useState<"it" | "en">("it");
  const [timezone, setTimezone] = useState("Europe/Rome");
  const [bookingHorizonDays, setBookingHorizonDays] = useState("30");
  const [bookingMinAdvanceMinutes, setBookingMinAdvanceMinutes] = useState("60");
  const [bookingBufferMinutes, setBookingBufferMinutes] = useState("0");
  const [adminNotificationEmail, setAdminNotificationEmail] = useState("");
  const [status, setStatus] = useState("");

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
          };
          error?: { message?: string };
        }>("/api/admin/tenant-settings")
      ]);
      if (!meResult.response.ok) {
        setStatus(meResult.payload?.error?.message ?? "Failed to load session");
        return;
      }
      if (!settingsResult.response.ok) {
        setStatus(settingsResult.payload?.error?.message ?? "Failed to load settings");
        return;
      }

      setRole(meResult.payload?.data?.role ?? "");

      const data = settingsResult.payload?.data;
      setDefaultLocale(data?.defaultLocale === "en" ? "en" : "it");
      setTimezone(data?.timezone ?? "Europe/Rome");
      setBookingHorizonDays(String(data?.bookingHorizonDays ?? 30));
      setBookingMinAdvanceMinutes(String(data?.bookingMinAdvanceMinutes ?? 60));
      setBookingBufferMinutes(String(data?.bookingBufferMinutes ?? 0));
      setAdminNotificationEmail(data?.adminNotificationEmail ?? "");
    }

    void load();
  }, []);

  async function save() {
    if (role !== "owner") {
      setStatus("Only owner can update tenant settings");
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
        adminNotificationEmail: adminNotificationEmail || null
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to save settings");
      return;
    }

    setStatus("Settings saved");
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Tenant Settings</h1>
      {role && role !== "owner" ? (
        <p style={{ color: "#b45309" }}>Current role: {role}. Settings update requires owner role.</p>
      ) : null}
      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 12
        }}
      >
        <label>
          Default Locale
          <select value={defaultLocale} onChange={(e) => setDefaultLocale(e.target.value as "it" | "en")}>
            <option value="it">it</option>
            <option value="en">en</option>
          </select>
        </label>

        <label>
          Timezone
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ width: "100%" }} />
        </label>

        <label>
          Booking Horizon Days
          <input
            value={bookingHorizonDays}
            onChange={(e) => setBookingHorizonDays(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Min Advance Minutes
          <input
            value={bookingMinAdvanceMinutes}
            onChange={(e) => setBookingMinAdvanceMinutes(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Buffer Minutes
          <input
            value={bookingBufferMinutes}
            onChange={(e) => setBookingBufferMinutes(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Admin Notification Email
          <input
            value={adminNotificationEmail}
            onChange={(e) => setAdminNotificationEmail(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <button onClick={save} disabled={role !== "owner"}>
          Save
        </button>
      </div>

      <p style={{ color: "#4b5563", minHeight: 20 }}>{status}</p>
    </main>
  );
}
