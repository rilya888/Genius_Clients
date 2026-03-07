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
    setEditing((prev) => {
      const current = prev[id];
      if (!current) {
        return prev;
      }
      return { ...prev, [id]: { ...current, ...patch } };
    });
  }

  return (
    <main className="gc-admin-page">
      <h1 className="gc-admin-title">Masters</h1>
      <p>
        <a href="/admin/master-translations">Open master translations</a>
      </p>
      <div className="gc-admin-filters">
        <input
          className="gc-input"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <button className="gc-action-btn" onClick={() => void createMaster()}>
          Create
        </button>
        <button className="gc-action-btn" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p className="gc-muted-line">{status}</p>
      <div className="gc-admin-table-wrap">
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.displayName ?? item.displayName}
                    onChange={(e) => updateEdit(item.id, { displayName: e.target.value })}
                  />
                </td>
                <td>
                  <label className="gc-consent gc-mt-0">
                    <input
                      type="checkbox"
                      checked={editing[item.id]?.isActive ?? item.isActive}
                      onChange={(e) => updateEdit(item.id, { isActive: e.target.checked })}
                    />
                    active
                  </label>
                </td>
                <td>
                  <div className="gc-inline-actions">
                    <button className="gc-pill-btn" onClick={() => void saveMaster(item.id)}>
                      Save
                    </button>
                    {item.isActive ? (
                      <button className="gc-pill-btn" onClick={() => void deactivateMaster(item.id)}>
                        Deactivate
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
