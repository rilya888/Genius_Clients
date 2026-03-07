"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type MasterItem = {
  id: string;
  displayName: string;
  isActive: boolean;
};

export default function MastersPage() {
  const [items, setItems] = useState<MasterItem[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [editing, setEditing] = useState<Record<string, { displayName: string; isActive: boolean }>>({});
  const [status, setStatus] = useState("");

  async function load() {
    const { response, payload } = await fetchJsonWithSessionRetry<{ data?: { items?: MasterItem[] }; error?: { message?: string } }>(
      "/api/admin/masters"
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to load masters");
      return;
    }

    const nextItems = payload?.data?.items ?? [];
    setItems(nextItems);
    const nextEditing: Record<string, { displayName: string; isActive: boolean }> = {};
    for (const item of nextItems as MasterItem[]) {
      nextEditing[item.id] = { displayName: item.displayName, isActive: item.isActive };
    }
    setEditing(nextEditing);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createMaster() {
    if (!displayName.trim()) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/masters",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: displayName.trim() })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to create master");
      return;
    }
    setDisplayName("");
    setStatus("Master created");
    await load();
  }

  async function saveMaster(id: string) {
    const edit = editing[id];
    if (!edit?.displayName.trim()) {
      return;
    }

    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/masters/${id}`,
      {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: edit.displayName.trim(),
        isActive: edit.isActive
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to update master");
      return;
    }
    setStatus("Master updated");
    await load();
  }

  async function deactivateMaster(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/masters/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to deactivate master");
      return;
    }
    setStatus("Master deactivated");
    await load();
  }

  function updateEdit(id: string, patch: Partial<{ displayName: string; isActive: boolean }>) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Masters</h1>
      <p>
        <a href="/admin/master-translations">Open master translations</a>
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <button onClick={() => void createMaster()}>Create</button>
        <button onClick={() => void load()}>Refresh</button>
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
                <button onClick={() => void saveMaster(item.id)}>Save</button>
                {item.isActive ? <button onClick={() => void deactivateMaster(item.id)}>Deactivate</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
