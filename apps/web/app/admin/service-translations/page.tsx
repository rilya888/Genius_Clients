"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type Service = { id: string; displayName: string };
type Item = {
  serviceId: string;
  locale: "it" | "en";
  displayName: string;
  description: string | null;
};

export default function ServiceTranslationsPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [locale, setLocale] = useState<"it" | "en">("it");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const [servicesResult, translationsResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Service[] } }>("/api/admin/services"),
      fetchJsonWithSessionRetry<{ data?: { items?: Item[] } }>("/api/admin/service-translations")
    ]);
    if (!servicesResult.response.ok || !translationsResult.response.ok) {
      setStatus("Failed to load service translations");
      return;
    }
    setServices(servicesResult.payload?.data?.items ?? []);
    setItems(translationsResult.payload?.data?.items ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function upsert() {
    if (!serviceId || !displayName.trim()) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/service-translations",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId,
        locale,
        displayName: displayName.trim(),
        description: description || null
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to upsert translation");
      return;
    }
    setStatus("Translation saved");
    await load();
  }

  async function remove(serviceIdParam: string, localeParam: "it" | "en") {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/service-translations/${serviceIdParam}?locale=${encodeURIComponent(localeParam)}`,
      {
        method: "DELETE"
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to delete translation");
      return;
    }
    setStatus("Translation deleted");
    await load();
  }

  const serviceNameById = Object.fromEntries(services.map((item) => [item.id, item.displayName]));

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Service Translations</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr 1fr auto", gap: 8 }}>
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Select service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
        <select value={locale} onChange={(e) => setLocale(e.target.value as "it" | "en")}>
          <option value="it">it</option>
          <option value="en">en</option>
        </select>
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <button onClick={() => void upsert()}>Save</button>
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
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Service</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Locale</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Display Name</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Description</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }} />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.serviceId}-${item.locale}`}>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                {serviceNameById[item.serviceId] ?? item.serviceId}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.locale}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.displayName}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.description ?? "-"}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <button onClick={() => void remove(item.serviceId, item.locale)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
