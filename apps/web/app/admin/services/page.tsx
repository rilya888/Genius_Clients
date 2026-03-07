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
      <h1 className="gc-admin-title">Services</h1>
      <p>
        <a href="/admin/service-translations">Open service translations</a>
      </p>
      <div className="gc-services-create-grid">
        <input
          className="gc-input"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <input
          className="gc-input"
          placeholder="Duration"
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(e.target.value)}
        />
        <input
          className="gc-input"
          placeholder="Price cents"
          value={priceCents}
          onChange={(e) => setPriceCents(e.target.value)}
        />
        <input
          className="gc-input"
          placeholder="Sort order"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
        <button className="gc-action-btn" onClick={() => void createService()}>
          Create
        </button>
      </div>
      <p className="gc-muted-line">{status}</p>
      <div className="gc-admin-table-wrap">
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
          </tbody>
        </table>
      </div>
    </main>
  );
}
