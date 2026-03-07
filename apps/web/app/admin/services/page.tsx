"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type ServiceItem = {
  id: string;
  displayName: string;
  durationMinutes: number;
  priceCents: number | null;
  sortOrder: number;
  isActive: boolean;
};

export default function ServicesPage() {
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [priceCents, setPriceCents] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [editing, setEditing] = useState<
    Record<
      string,
      {
        displayName: string;
        durationMinutes: string;
        priceCents: string;
        sortOrder: string;
        isActive: boolean;
      }
    >
  >({});
  const [status, setStatus] = useState("");

  async function load() {
    const { response, payload } = await fetchJsonWithSessionRetry<{
      data?: { items?: ServiceItem[] };
      error?: { message?: string };
    }>("/api/admin/services");
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to load services");
      return;
    }

    const nextItems = payload?.data?.items ?? [];
    setItems(nextItems);
    const nextEditing: Record<
      string,
      { displayName: string; durationMinutes: string; priceCents: string; sortOrder: string; isActive: boolean }
    > = {};
    for (const item of nextItems as ServiceItem[]) {
      nextEditing[item.id] = {
        displayName: item.displayName,
        durationMinutes: String(item.durationMinutes),
        priceCents: item.priceCents === null ? "" : String(item.priceCents),
        sortOrder: String(item.sortOrder),
        isActive: item.isActive
      };
    }
    setEditing(nextEditing);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createService() {
    if (!displayName.trim()) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/services",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: displayName.trim(),
        durationMinutes: Number(durationMinutes),
        priceCents: priceCents ? Number(priceCents) : undefined,
        sortOrder: Number(sortOrder)
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to create service");
      return;
    }
    setDisplayName("");
    setPriceCents("");
    setStatus("Service created");
    await load();
  }

  async function saveService(id: string) {
    const edit = editing[id];
    if (!edit || !edit.displayName.trim()) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/services/${id}`,
      {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: edit.displayName.trim(),
        durationMinutes: Number(edit.durationMinutes),
        priceCents: edit.priceCents ? Number(edit.priceCents) : null,
        sortOrder: Number(edit.sortOrder),
        isActive: edit.isActive
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to update service");
      return;
    }
    setStatus("Service updated");
    await load();
  }

  async function deactivateService(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/services/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to deactivate service");
      return;
    }
    setStatus("Service deactivated");
    await load();
  }

  function updateEdit(
    id: string,
    patch: Partial<{
      displayName: string;
      durationMinutes: string;
      priceCents: string;
      sortOrder: string;
      isActive: boolean;
    }>
  ) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Services</h1>
      <p>
        <a href="/admin/service-translations">Open service translations</a>
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 120px 140px 120px auto",
          gap: 8,
          marginBottom: 12
        }}
      >
        <input
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          placeholder="Duration"
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(e.target.value)}
        />
        <input placeholder="Price cents" value={priceCents} onChange={(e) => setPriceCents(e.target.value)} />
        <input placeholder="Sort order" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <button onClick={() => void createService()}>Create</button>
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
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Name</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Duration</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Price</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Sort</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Active</th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb", padding: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  value={editing[item.id]?.displayName ?? item.displayName}
                  onChange={(e) => updateEdit(item.id, { displayName: e.target.value })}
                  style={{ width: "100%" }}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  value={editing[item.id]?.durationMinutes ?? String(item.durationMinutes)}
                  onChange={(e) => updateEdit(item.id, { durationMinutes: e.target.value })}
                  style={{ width: 90 }}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  value={editing[item.id]?.priceCents ?? ""}
                  onChange={(e) => updateEdit(item.id, { priceCents: e.target.value })}
                  style={{ width: 120 }}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  value={editing[item.id]?.sortOrder ?? String(item.sortOrder)}
                  onChange={(e) => updateEdit(item.id, { sortOrder: e.target.value })}
                  style={{ width: 90 }}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editing[item.id]?.isActive ?? item.isActive}
                    onChange={(e) => updateEdit(item.id, { isActive: e.target.checked })}
                  />
                  active
                </label>
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", display: "flex", gap: 8 }}>
                <button onClick={() => void saveService(item.id)}>Save</button>
                {item.isActive ? <button onClick={() => void deactivateService(item.id)}>Deactivate</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
