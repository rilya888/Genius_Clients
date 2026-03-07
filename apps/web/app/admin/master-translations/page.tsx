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
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Master Translations</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 1fr 1fr auto", gap: 8 }}>
        <select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">Select master</option>
          {masters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
        <select value={locale} onChange={(e) => setLocale(e.target.value as "it" | "en")}>
          <option value="it">it</option>
          <option value="en">en</option>
        </select>
        <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input placeholder="Bio" value={bio} onChange={(e) => setBio(e.target.value)} />
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
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Master</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Locale</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Display Name</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Bio</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }} />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={`${item.masterId}-${item.locale}`}>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                {masterNameById[item.masterId] ?? item.masterId}
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.locale}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.displayName}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{item.bio ?? "-"}</td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <button onClick={() => void remove(item.masterId, item.locale)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
