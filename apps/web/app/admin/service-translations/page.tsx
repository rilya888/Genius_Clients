"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";
import { isUiV2Enabled } from "../../../lib/ui-flags";

type Service = { id: string; displayName: string };
type Item = {
  serviceId: string;
  locale: "it" | "en";
  displayName: string;
  description: string | null;
};
type StatusTone = "neutral" | "error" | "success";

export default function ServiceTranslationsPage() {
  const uiV2Enabled = isUiV2Enabled();
  const [services, setServices] = useState<Service[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [locale, setLocale] = useState<"it" | "en">("it");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  async function load() {
    const [servicesResult, translationsResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Service[] } }>("/api/admin/services"),
      fetchJsonWithSessionRetry<{ data?: { items?: Item[] } }>("/api/admin/service-translations")
    ]);
    if (!servicesResult.response.ok || !translationsResult.response.ok) {
      setStatus("Failed to load service translations");
      setStatusTone("error");
      return;
    }
    setServices(servicesResult.payload?.data?.items ?? []);
    setItems(translationsResult.payload?.data?.items ?? []);
    setStatus("");
    setStatusTone("neutral");
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
      setStatusTone("error");
      return;
    }
    setStatus("Translation saved");
    setStatusTone("success");
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
      setStatusTone("error");
      return;
    }
    setStatus("Translation deleted");
    setStatusTone("success");
    await load();
  }

  const serviceNameById = Object.fromEntries(services.map((item) => [item.id, item.displayName]));
  const summary = {
    total: items.length,
    it: items.filter((item) => item.locale === "it").length,
    en: items.filter((item) => item.locale === "en").length
  };

  return (
    <main className={`gc-admin-page${uiV2Enabled ? " gc-admin-page-v2" : ""}`}>
      <h1 className="gc-admin-title">Service Translations</h1>
      <p className="gc-admin-subtitle">Manage localized names and descriptions for IT/EN services.</p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <div className="gc-translations-create-grid">
          <div className="gc-field">
            <span className="gc-field-label">Service</span>
            <select className="gc-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Select service</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Locale</span>
            <select className="gc-select" value={locale} onChange={(e) => setLocale(e.target.value as "it" | "en")}>
              <option value="it">it</option>
              <option value="en">en</option>
            </select>
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Display name</span>
            <input
              className="gc-input"
              placeholder="Localized service name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Description (optional)</span>
            <input
              className="gc-input"
              placeholder="Localized description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <button className="gc-action-btn" onClick={() => void upsert()}>
            Save
          </button>
        </div>
      </section>

      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Locale summary</h2>
        <div className="gc-admin-grid-3">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Total translations</div>
            <div className="gc-admin-stat-value">{summary.total}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Italian (it)</div>
            <div className="gc-admin-stat-value">{summary.it}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">English (en)</div>
            <div className="gc-admin-stat-value">{summary.en}</div>
          </div>
        </div>
      </section>

      <div className={`gc-admin-table-wrap${uiV2Enabled ? " gc-admin-table-wrap-v2" : ""}`}>
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Locale</th>
              <th>Display Name</th>
              <th>Description</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.serviceId}-${item.locale}`}>
                <td>{serviceNameById[item.serviceId] ?? item.serviceId}</td>
                <td>{item.locale}</td>
                <td>{item.displayName}</td>
                <td>{item.description ?? "-"}</td>
                <td>
                  <button className="gc-pill-btn" onClick={() => void remove(item.serviceId, item.locale)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="gc-empty-cell" colSpan={5}>
                  No service translations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
