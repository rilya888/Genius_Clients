"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type Master = { id: string; displayName: string };
type Service = { id: string; displayName: string };
type MasterServiceItem = {
  id: string;
  masterId: string;
  serviceId: string;
  durationMinutesOverride: number | null;
};

export default function MasterServicesPage() {
  const [masters, setMasters] = useState<Master[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [items, setItems] = useState<MasterServiceItem[]>([]);
  const [editing, setEditing] = useState<Record<string, { masterId: string; serviceId: string; duration: string }>>(
    {}
  );
  const [masterId, setMasterId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [durationOverride, setDurationOverride] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const [mastersResult, servicesResult, linksResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Master[] } }>("/api/admin/masters"),
      fetchJsonWithSessionRetry<{ data?: { items?: Service[] } }>("/api/admin/services"),
      fetchJsonWithSessionRetry<{ data?: { items?: MasterServiceItem[] } }>("/api/admin/master-services")
    ]);
    if (!mastersResult.response.ok || !servicesResult.response.ok || !linksResult.response.ok) {
      setStatus("Failed to load master-services data");
      return;
    }

    const nextItems = linksResult.payload?.data?.items ?? [];
    setMasters(mastersResult.payload?.data?.items ?? []);
    setServices(servicesResult.payload?.data?.items ?? []);
    setItems(nextItems);

    const nextEditing: Record<string, { masterId: string; serviceId: string; duration: string }> = {};
    for (const item of nextItems as MasterServiceItem[]) {
      nextEditing[item.id] = {
        masterId: item.masterId,
        serviceId: item.serviceId,
        duration: item.durationMinutesOverride === null ? "" : String(item.durationMinutesOverride)
      };
    }
    setEditing(nextEditing);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createLink() {
    if (!masterId || !serviceId) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/master-services",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterId,
        serviceId,
        durationMinutesOverride: durationOverride ? Number(durationOverride) : undefined
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to create link");
      return;
    }
    setStatus("Link created");
    await load();
  }

  async function saveLink(id: string) {
    const edit = editing[id];
    if (!edit || !edit.masterId || !edit.serviceId) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/master-services/${id}`,
      {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterId: edit.masterId,
        serviceId: edit.serviceId,
        durationMinutesOverride: edit.duration ? Number(edit.duration) : null
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to update link");
      return;
    }
    setStatus("Link updated");
    await load();
  }

  async function removeLink(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/master-services/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to delete link");
      return;
    }
    setStatus("Link deleted");
    await load();
  }

  function updateEdit(id: string, patch: Partial<{ masterId: string; serviceId: string; duration: string }>) {
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
      <h1 className="gc-admin-title">Master Services</h1>
      <div className="gc-master-services-create-grid">
        <select className="gc-select" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">Select master</option>
          {masters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
        <select className="gc-select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          <option value="">Select service</option>
          {services.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
        <input
          className="gc-input"
          placeholder="Override min"
          value={durationOverride}
          onChange={(e) => setDurationOverride(e.target.value)}
        />
        <button className="gc-action-btn" onClick={() => void createLink()}>
          Create Link
        </button>
      </div>
      <p className="gc-muted-line">{status}</p>
      <div className="gc-admin-table-wrap">
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Master</th>
              <th>Service</th>
              <th>Override</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <select
                    className="gc-select"
                    value={editing[item.id]?.masterId ?? item.masterId}
                    onChange={(e) => updateEdit(item.id, { masterId: e.target.value })}
                  >
                    {masters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="gc-select"
                    value={editing[item.id]?.serviceId ?? item.serviceId}
                    onChange={(e) => updateEdit(item.id, { serviceId: e.target.value })}
                  >
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.duration ?? ""}
                    onChange={(e) => updateEdit(item.id, { duration: e.target.value })}
                  />
                </td>
                <td>
                  <div className="gc-inline-actions">
                    <button className="gc-pill-btn" onClick={() => void saveLink(item.id)}>
                      Save
                    </button>
                    <button className="gc-pill-btn" onClick={() => void removeLink(item.id)}>
                      Delete
                    </button>
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
