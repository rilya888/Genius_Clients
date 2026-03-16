"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";
import { isUiV2Enabled } from "../../../lib/ui-flags";

type Master = { id: string; displayName: string };
type Item = {
  masterId: string;
  locale: "it" | "en";
  displayName: string;
  bio: string | null;
};
type StatusTone = "neutral" | "error" | "success";

export default function MasterTranslationsPage() {
  const uiV2Enabled = isUiV2Enabled();
  const [masters, setMasters] = useState<Master[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [masterId, setMasterId] = useState("");
  const [locale, setLocale] = useState<"it" | "en">("it");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  async function load() {
    const [mastersResult, translationsResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Master[] } }>("/api/admin/masters"),
      fetchJsonWithSessionRetry<{ data?: { items?: Item[] } }>("/api/admin/master-translations")
    ]);
    if (!mastersResult.response.ok || !translationsResult.response.ok) {
      setStatus("Failed to load master translations");
      setStatusTone("error");
      return;
    }
    setMasters(mastersResult.payload?.data?.items ?? []);
    setItems(translationsResult.payload?.data?.items ?? []);
    setStatus("");
    setStatusTone("neutral");
  }

  useEffect(() => {
    void load();
  }, []);

  async function upsert() {
    if (!masterId || !displayName.trim()) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/master-translations",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterId,
        locale,
        displayName: displayName.trim(),
        bio: bio || null
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

  async function remove(masterIdParam: string, localeParam: "it" | "en") {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/master-translations/${masterIdParam}?locale=${encodeURIComponent(localeParam)}`,
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

  const masterNameById = Object.fromEntries(masters.map((item) => [item.id, item.displayName]));

  return (
    <main className={`gc-admin-page${uiV2Enabled ? " gc-admin-page-v2" : ""}`}>
      <h1 className="gc-admin-title">Master Translations</h1>
      <p className="gc-admin-subtitle">Manage localized names and bios for IT/EN master profiles.</p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <div className="gc-translations-create-grid">
          <div className="gc-field">
            <span className="gc-field-label">Master</span>
            <select className="gc-select" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
              <option value="">Select master</option>
              {masters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
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
              placeholder="Localized master name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Bio (optional)</span>
            <input className="gc-input" placeholder="Short bio" value={bio} onChange={(e) => setBio(e.target.value)} />
          </div>
          <button className="gc-action-btn" onClick={() => void upsert()}>
            Save
          </button>
        </div>
      </section>

      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>

      <div className={`gc-admin-table-wrap${uiV2Enabled ? " gc-admin-table-wrap-v2" : ""}`}>
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Master</th>
              <th>Locale</th>
              <th>Display Name</th>
              <th>Bio</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={`${item.masterId}-${item.locale}`}>
                <td>{masterNameById[item.masterId] ?? item.masterId}</td>
                <td>{item.locale}</td>
                <td>{item.displayName}</td>
                <td>{item.bio ?? "-"}</td>
                <td>
                  <button className="gc-pill-btn" onClick={() => void remove(item.masterId, item.locale)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="gc-empty-cell" colSpan={5}>
                  No master translations yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
