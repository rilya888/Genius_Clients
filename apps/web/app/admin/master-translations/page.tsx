"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type Master = { id: string; displayName: string };
type Item = {
  masterId: string;
  locale: "it" | "en";
  displayName: string;
  bio: string | null;
};

export default function MasterTranslationsPage() {
  const [masters, setMasters] = useState<Master[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [masterId, setMasterId] = useState("");
  const [locale, setLocale] = useState<"it" | "en">("it");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const [mastersResult, translationsResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Master[] } }>("/api/admin/masters"),
      fetchJsonWithSessionRetry<{ data?: { items?: Item[] } }>("/api/admin/master-translations")
    ]);
    if (!mastersResult.response.ok || !translationsResult.response.ok) {
      setStatus("Failed to load master translations");
      return;
    }
    setMasters(mastersResult.payload?.data?.items ?? []);
    setItems(translationsResult.payload?.data?.items ?? []);
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
      return;
    }
    setStatus("Translation saved");
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
      return;
    }
    setStatus("Translation deleted");
    await load();
  }

  const masterNameById = Object.fromEntries(masters.map((item) => [item.id, item.displayName]));

  return (
    <main className="gc-admin-page">
      <h1 className="gc-admin-title">Master Translations</h1>
      <div className="gc-translations-create-grid">
        <select className="gc-select" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">Select master</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <select className="gc-select" value={locale} onChange={(e) => setLocale(e.target.value as "it" | "en")}>
          <option value="it">it</option>
          <option value="en">en</option>
        </select>
        <input
          className="gc-input"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input className="gc-input" placeholder="Bio" value={bio} onChange={(e) => setBio(e.target.value)} />
        <button className="gc-action-btn" onClick={() => void upsert()}>
          Save
        </button>
      </div>

      <p className="gc-muted-line">{status}</p>

      <div className="gc-admin-table-wrap">
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
          </tbody>
        </table>
      </div>
    </main>
  );
}
