"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";
import { isUiV2Enabled } from "../../../lib/ui-flags";

type ServiceItem = {
  id: string;
  displayName: string;
  durationMinutes: number;
  priceCents: number | null;
  sortOrder: number;
  isActive: boolean;
};
type StatusTone = "neutral" | "error" | "success";

export default function ServicesPage() {
  const uiV2Enabled = isUiV2Enabled();
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
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  async function load() {
    const { response, payload } = await fetchJsonWithSessionRetry<{
      data?: { items?: ServiceItem[] };
      error?: { message?: string };
    }>("/api/admin/services");
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to load services");
      setStatusTone("error");
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
    setStatus("");
    setStatusTone("neutral");
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
      setStatusTone("error");
      return;
    }
    setDisplayName("");
    setPriceCents("");
    setStatus("Service created");
    setStatusTone("success");
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
      setStatusTone("error");
      return;
    }
    setStatus("Service updated");
    setStatusTone("success");
    await load();
  }

  async function deactivateService(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/services/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to deactivate service");
      setStatusTone("error");
      return;
    }
    setStatus("Service deactivated");
    setStatusTone("success");
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
    setEditing((prev) => {
      const current = prev[id];
      if (!current) {
        return prev;
      }
      return { ...prev, [id]: { ...current, ...patch } };
    });
  }

  const summary = {
    total: items.length,
    active: items.filter((item) => item.isActive).length,
    inactive: items.filter((item) => !item.isActive).length
  };

  return (
    <main className={`gc-admin-page${uiV2Enabled ? " gc-admin-page-v2" : ""}`}>
      <h1 className="gc-admin-title">Services</h1>
      <p className="gc-admin-subtitle">Manage service catalog, duration, and commercial ordering.</p>
      <p className="gc-admin-link-line">
        <a href="/admin/service-translations">Open service translations</a>
      </p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <div className={`gc-services-create-grid${uiV2Enabled ? " gc-services-create-grid-v2" : ""}`}>
          <div className="gc-field">
            <span className="gc-field-label">Service display name</span>
            <input
              className="gc-input"
              placeholder="e.g. Haircut"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Duration (minutes)</span>
            <input
              className="gc-input"
              placeholder="e.g. 60"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
            />
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Price (cents, optional)</span>
            <input
              className="gc-input"
              placeholder="e.g. 2500"
              value={priceCents}
              onChange={(e) => setPriceCents(e.target.value)}
            />
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Sort order</span>
            <input
              className="gc-input"
              placeholder="e.g. 0"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
          <button className="gc-action-btn" onClick={() => void createService()}>
            Create
          </button>
        </div>
      </section>
      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Catalog summary</h2>
        <div className="gc-admin-grid-3">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Total services</div>
            <div className="gc-admin-stat-value">{summary.total}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Active</div>
            <div className="gc-admin-stat-value">{summary.active}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Inactive</div>
            <div className="gc-admin-stat-value">{summary.inactive}</div>
          </div>
        </div>
      </section>
      <div className={`gc-admin-table-wrap${uiV2Enabled ? " gc-admin-table-wrap-v2" : ""}`}>
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Duration</th>
              <th>Price</th>
              <th>Sort</th>
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
                  <input
                    className="gc-input"
                    value={editing[item.id]?.durationMinutes ?? String(item.durationMinutes)}
                    onChange={(e) => updateEdit(item.id, { durationMinutes: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.priceCents ?? ""}
                    onChange={(e) => updateEdit(item.id, { priceCents: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.sortOrder ?? String(item.sortOrder)}
                    onChange={(e) => updateEdit(item.id, { sortOrder: e.target.value })}
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
                    <button className="gc-pill-btn" onClick={() => void saveService(item.id)}>
                      Save
                    </button>
                    {item.isActive ? (
                      <button className="gc-pill-btn" onClick={() => void deactivateService(item.id)}>
                        Deactivate
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="gc-empty-cell" colSpan={6}>
                  No services yet. Create your first service above.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
