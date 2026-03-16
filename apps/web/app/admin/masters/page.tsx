"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";
import { isUiV2Enabled } from "../../../lib/ui-flags";

type MasterItem = {
  id: string;
  displayName: string;
  isActive: boolean;
};
type StatusTone = "neutral" | "error" | "success";

export default function MastersPage() {
  const uiV2Enabled = isUiV2Enabled();
  const [items, setItems] = useState<MasterItem[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [editing, setEditing] = useState<Record<string, { displayName: string; isActive: boolean }>>({});
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  async function load() {
    const { response, payload } = await fetchJsonWithSessionRetry<{ data?: { items?: MasterItem[] }; error?: { message?: string } }>(
      "/api/admin/masters"
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to load masters");
      setStatusTone("error");
      return;
    }

    const nextItems = payload?.data?.items ?? [];
    setItems(nextItems);
    const nextEditing: Record<string, { displayName: string; isActive: boolean }> = {};
    for (const item of nextItems as MasterItem[]) {
      nextEditing[item.id] = { displayName: item.displayName, isActive: item.isActive };
    }
    setEditing(nextEditing);
    setStatus("");
    setStatusTone("neutral");
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
      setStatusTone("error");
      return;
    }
    setDisplayName("");
    setStatus("Master created");
    setStatusTone("success");
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
      setStatusTone("error");
      return;
    }
    setStatus("Master updated");
    setStatusTone("success");
    await load();
  }

  async function deactivateMaster(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/masters/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to deactivate master");
      setStatusTone("error");
      return;
    }
    setStatus("Master deactivated");
    setStatusTone("success");
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
    <main className={`gc-admin-page${uiV2Enabled ? " gc-admin-page-v2" : ""}`}>
      <h1 className="gc-admin-title">Masters</h1>
      <p className="gc-admin-subtitle">Manage specialists, visibility state, and naming consistency.</p>
      <p className="gc-admin-link-line">
        <a href="/admin/master-translations">Open master translations</a>
      </p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <div className={`gc-admin-filters${uiV2Enabled ? " gc-admin-filters-v2" : ""}`}>
          <div className="gc-field">
            <span className="gc-field-label">Master display name</span>
            <input
              className="gc-input"
              placeholder="e.g. Maria Rossi"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <button className="gc-action-btn" onClick={() => void createMaster()}>
            Create
          </button>
          <button className="gc-action-btn" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </section>
      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>
      <div className={`gc-admin-table-wrap${uiV2Enabled ? " gc-admin-table-wrap-v2" : ""}`}>
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
            {items.length === 0 ? (
              <tr>
                <td className="gc-empty-cell" colSpan={3}>
                  No masters yet. Create your first specialist above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
