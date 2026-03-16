"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";
import { getTimeOptions, WEEKDAY_OPTIONS } from "../../../lib/schedule-options";
import { isUiV2Enabled } from "../../../lib/ui-flags";

type Master = { id: string; displayName: string };
type WorkingHourItem = {
  id: string;
  masterId: string | null;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  isActive: boolean;
};
type StatusTone = "neutral" | "error" | "success";

export default function WorkingHoursPage() {
  const uiV2Enabled = isUiV2Enabled();
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
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");

  async function load() {
    const [mastersResult, hoursResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Master[] } }>("/api/admin/masters"),
      fetchJsonWithSessionRetry<{ data?: { items?: WorkingHourItem[] } }>("/api/admin/working-hours")
    ]);
    if (!mastersResult.response.ok || !hoursResult.response.ok) {
      setStatus("Failed to load working hours");
      setStatusTone("error");
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
    setStatus("");
    setStatusTone("neutral");
  }

  useEffect(() => {
    void load();
  }, []);

  async function createWorkingHours() {
    if (Number(startMinute) >= Number(endMinute)) {
      setStatus("Start time must be earlier than end time");
      setStatusTone("error");
      return;
    }
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
      setStatusTone("error");
      return;
    }
    setStatus("Working hours created");
    setStatusTone("success");
    await load();
  }

  async function saveWorkingHours(id: string) {
    const edit = editing[id];
    if (!edit) {
      return;
    }
    if (Number(edit.startMinute) >= Number(edit.endMinute)) {
      setStatus("Start time must be earlier than end time");
      setStatusTone("error");
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
      setStatusTone("error");
      return;
    }
    setStatus("Working hours updated");
    setStatusTone("success");
    await load();
  }

  async function removeWorkingHours(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/working-hours/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to delete working hours");
      setStatusTone("error");
      return;
    }
    setStatus("Working hours deleted");
    setStatusTone("success");
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

  const summary = {
    total: items.length,
    global: items.filter((item) => item.masterId === null).length,
    active: items.filter((item) => item.isActive).length
  };

  return (
    <main className={`gc-admin-page${uiV2Enabled ? " gc-admin-page-v2" : ""}`}>
      <h1 className="gc-admin-title">Working Hours</h1>
      <p className="gc-admin-subtitle">Define recurring availability by master and weekday.</p>
      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <div className="gc-working-hours-create-grid">
          <div className="gc-field">
            <span className="gc-field-label">Master scope</span>
            <select className="gc-select" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
              <option value="">Global (all masters)</option>
              {masters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Day of week</span>
            <select className="gc-select" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
              {WEEKDAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="gc-field">
            <span className="gc-field-label">Start time</span>
            <select className="gc-select" value={startMinute} onChange={(e) => setStartMinute(e.target.value)}>
              {getTimeOptions(startMinute).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="gc-field">
            <span className="gc-field-label">End time</span>
            <select className="gc-select" value={endMinute} onChange={(e) => setEndMinute(e.target.value)}>
              {getTimeOptions(endMinute).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button className="gc-action-btn" onClick={() => void createWorkingHours()}>
            Create
          </button>
        </div>
      </section>

      <p className={`gc-muted-line gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>

      <section className={uiV2Enabled ? "gc-admin-v2-section" : ""}>
        <h2 className={uiV2Enabled ? "gc-admin-v2-section-title" : "gc-admin-section"}>Coverage summary</h2>
        <div className="gc-admin-grid-3">
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Total rules</div>
            <div className="gc-admin-stat-value">{summary.total}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Global rules</div>
            <div className="gc-admin-stat-value">{summary.global}</div>
          </div>
          <div className="gc-card gc-admin-stat">
            <div className="gc-admin-stat-label">Active</div>
            <div className="gc-admin-stat-value">{summary.active}</div>
          </div>
        </div>
      </section>

      <div className={`gc-admin-table-wrap${uiV2Enabled ? " gc-admin-table-wrap-v2" : ""}`}>
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
                  <select
                    className="gc-select"
                    value={editing[item.id]?.dayOfWeek ?? String(item.dayOfWeek)}
                    onChange={(e) => updateEdit(item.id, { dayOfWeek: e.target.value })}
                  >
                    {WEEKDAY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="gc-select"
                    value={editing[item.id]?.startMinute ?? String(item.startMinute)}
                    onChange={(e) => updateEdit(item.id, { startMinute: e.target.value })}
                  >
                    {getTimeOptions(editing[item.id]?.startMinute ?? String(item.startMinute)).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    className="gc-select"
                    value={editing[item.id]?.endMinute ?? String(item.endMinute)}
                    onChange={(e) => updateEdit(item.id, { endMinute: e.target.value })}
                  >
                    {getTimeOptions(editing[item.id]?.endMinute ?? String(item.endMinute)).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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
            {items.length === 0 ? (
              <tr>
                <td className="gc-empty-cell" colSpan={6}>
                  No working hours defined yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
