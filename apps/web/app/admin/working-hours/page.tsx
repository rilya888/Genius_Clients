"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type Master = { id: string; displayName: string };
type WorkingHourItem = {
  id: string;
  masterId: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
};

export default function WorkingHoursPage() {
  const [masters, setMasters] = useState<Master[]>([]);
  const [items, setItems] = useState<WorkingHourItem[]>([]);
  const [editing, setEditing] = useState<
    Record<string, { masterId: string; dayOfWeek: string; startMinute: string; endMinute: string; isActive: boolean }>
  >({});
  const [masterId, setMasterId] = useState("");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startMinute, setStartMinute] = useState("540");
  const [endMinute, setEndMinute] = useState("1020");
  const [status, setStatus] = useState("");

  async function load() {
    const [mastersResult, hoursResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Master[] } }>("/api/admin/masters"),
      fetchJsonWithSessionRetry<{ data?: { items?: WorkingHourItem[] } }>("/api/admin/working-hours")
    ]);
    if (!mastersResult.response.ok || !hoursResult.response.ok) {
      setStatus("Failed to load working hours");
      return;
    }

    const nextItems = hoursResult.payload?.data?.items ?? [];
    setMasters(mastersResult.payload?.data?.items ?? []);
    setItems(nextItems);
    const nextEditing: Record<
      string,
      { masterId: string; dayOfWeek: string; startMinute: string; endMinute: string; isActive: boolean }
    > = {};
    for (const item of nextItems as WorkingHourItem[]) {
      nextEditing[item.id] = {
        masterId: item.masterId ?? "",
        dayOfWeek: String(item.dayOfWeek),
        startMinute: String(item.startMinute),
        endMinute: String(item.endMinute),
        isActive: item.isActive
      };
    }
    setEditing(nextEditing);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createWorkingHours() {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/working-hours",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterId: masterId || undefined,
        dayOfWeek: Number(dayOfWeek),
        startMinute: Number(startMinute),
        endMinute: Number(endMinute)
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to create working hours");
      return;
    }
    setStatus("Working hours created");
    await load();
  }

  async function saveWorkingHours(id: string) {
    const edit = editing[id];
    if (!edit) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/working-hours/${id}`,
      {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterId: edit.masterId || null,
        dayOfWeek: Number(edit.dayOfWeek),
        startMinute: Number(edit.startMinute),
        endMinute: Number(edit.endMinute),
        isActive: edit.isActive
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to update working hours");
      return;
    }
    setStatus("Working hours updated");
    await load();
  }

  async function removeWorkingHours(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/working-hours/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to delete working hours");
      return;
    }
    setStatus("Working hours deleted");
    await load();
  }

  function updateEdit(
    id: string,
    patch: Partial<{ masterId: string; dayOfWeek: string; startMinute: string; endMinute: string; isActive: boolean }>
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
      <h1 className="gc-admin-title">Working Hours</h1>
      <div className="gc-working-hours-create-grid">
        <select className="gc-select" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">Global (all masters)</option>
          {masters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
        <input
          className="gc-input"
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(e.target.value)}
          placeholder="Day 0-6"
        />
        <input
          className="gc-input"
          value={startMinute}
          onChange={(e) => setStartMinute(e.target.value)}
          placeholder="Start min"
        />
        <input
          className="gc-input"
          value={endMinute}
          onChange={(e) => setEndMinute(e.target.value)}
          placeholder="End min"
        />
        <button className="gc-action-btn" onClick={() => void createWorkingHours()}>
          Create
        </button>
      </div>

      <p className="gc-muted-line">{status}</p>

      <div className="gc-admin-table-wrap">
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Master</th>
              <th>Day</th>
              <th>Start</th>
              <th>End</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <select
                    className="gc-select"
                    value={editing[item.id]?.masterId ?? ""}
                    onChange={(e) => updateEdit(item.id, { masterId: e.target.value })}
                  >
                    <option value="">GLOBAL</option>
                    {masters.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.dayOfWeek ?? String(item.dayOfWeek)}
                    onChange={(e) => updateEdit(item.id, { dayOfWeek: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.startMinute ?? String(item.startMinute)}
                    onChange={(e) => updateEdit(item.id, { startMinute: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.endMinute ?? String(item.endMinute)}
                    onChange={(e) => updateEdit(item.id, { endMinute: e.target.value })}
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
                    <button className="gc-pill-btn" onClick={() => void saveWorkingHours(item.id)}>
                      Save
                    </button>
                    <button className="gc-pill-btn" onClick={() => void removeWorkingHours(item.id)}>
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
