"use client";

import { useEffect, useState } from "react";
import { fetchJsonWithSessionRetry } from "../../../lib/client-api";

type Master = { id: string; displayName: string };
type ExceptionItem = {
  id: string;
  masterId: string | null;
  date: string;
  isClosed: boolean;
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
};

export default function ExceptionsPage() {
  const [masters, setMasters] = useState<Master[]>([]);
  const [items, setItems] = useState<ExceptionItem[]>([]);
  const [editing, setEditing] = useState<
    Record<
      string,
      {
        masterId: string;
        date: string;
        isClosed: boolean;
        startMinute: string;
        endMinute: string;
        note: string;
      }
    >
  >({});
  const [masterId, setMasterId] = useState("");
  const [date, setDate] = useState("");
  const [isClosed, setIsClosed] = useState(false);
  const [startMinute, setStartMinute] = useState("");
  const [endMinute, setEndMinute] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const [mastersResult, exceptionsResult] = await Promise.all([
      fetchJsonWithSessionRetry<{ data?: { items?: Master[] } }>("/api/admin/masters"),
      fetchJsonWithSessionRetry<{ data?: { items?: ExceptionItem[] } }>("/api/admin/exceptions")
    ]);
    if (!mastersResult.response.ok || !exceptionsResult.response.ok) {
      setStatus("Failed to load exceptions");
      return;
    }
    const nextItems = exceptionsResult.payload?.data?.items ?? [];
    setMasters(mastersResult.payload?.data?.items ?? []);
    setItems(nextItems);

    const nextEditing: Record<
      string,
      { masterId: string; date: string; isClosed: boolean; startMinute: string; endMinute: string; note: string }
    > = {};
    for (const item of nextItems as ExceptionItem[]) {
      nextEditing[item.id] = {
        masterId: item.masterId ?? "",
        date: item.date,
        isClosed: item.isClosed,
        startMinute: item.startMinute === null ? "" : String(item.startMinute),
        endMinute: item.endMinute === null ? "" : String(item.endMinute),
        note: item.note ?? ""
      };
    }
    setEditing(nextEditing);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createException() {
    if (!date) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      "/api/admin/exceptions",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterId: masterId || undefined,
        date,
        isClosed,
        startMinute: startMinute ? Number(startMinute) : undefined,
        endMinute: endMinute ? Number(endMinute) : undefined,
        note: note || undefined
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to create exception");
      return;
    }
    setStatus("Exception created");
    await load();
  }

  async function saveException(id: string) {
    const edit = editing[id];
    if (!edit || !edit.date) {
      return;
    }
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/exceptions/${id}`,
      {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        masterId: edit.masterId || null,
        date: edit.date,
        isClosed: edit.isClosed,
        startMinute: edit.startMinute ? Number(edit.startMinute) : null,
        endMinute: edit.endMinute ? Number(edit.endMinute) : null,
        note: edit.note || null
      })
      }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to update exception");
      return;
    }
    setStatus("Exception updated");
    await load();
  }

  async function removeException(id: string) {
    const { response, payload } = await fetchJsonWithSessionRetry<{ error?: { message?: string } }>(
      `/api/admin/exceptions/${id}`,
      { method: "DELETE" }
    );
    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Failed to delete exception");
      return;
    }
    setStatus("Exception deleted");
    await load();
  }

  function updateEdit(
    id: string,
    patch: Partial<{
      masterId: string;
      date: string;
      isClosed: boolean;
      startMinute: string;
      endMinute: string;
      note: string;
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
      <h1 className="gc-admin-title">Schedule Exceptions</h1>
      <div className="gc-exceptions-create-grid">
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
          <span className="gc-field-label">Exception date</span>
          <input className="gc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="gc-field">
          <span className="gc-field-label">Start minute (optional)</span>
          <input
            className="gc-input"
            placeholder="e.g. 540"
            value={startMinute}
            onChange={(e) => setStartMinute(e.target.value)}
          />
        </div>
        <div className="gc-field">
          <span className="gc-field-label">End minute (optional)</span>
          <input
            className="gc-input"
            placeholder="e.g. 1020"
            value={endMinute}
            onChange={(e) => setEndMinute(e.target.value)}
          />
        </div>
        <div className="gc-field">
          <span className="gc-field-label">Note (optional)</span>
          <input
            className="gc-input"
            placeholder="Reason or note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <button className="gc-action-btn" onClick={() => void createException()}>
          Create
        </button>
      </div>
      <label className="gc-consent gc-mb-12">
        <input type="checkbox" checked={isClosed} onChange={(e) => setIsClosed(e.target.checked)} />
        Closed day
      </label>
      <p className="gc-muted-line">{status}</p>

      <div className="gc-admin-table-wrap">
        <table className="gc-admin-table">
          <thead>
            <tr>
              <th>Master</th>
              <th>Date</th>
              <th>Closed</th>
              <th>Start</th>
              <th>End</th>
              <th>Note</th>
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
                    className="gc-date"
                    type="date"
                    value={editing[item.id]?.date ?? item.date}
                    onChange={(e) => updateEdit(item.id, { date: e.target.value })}
                  />
                </td>
                <td>
                  <label className="gc-consent gc-mt-0">
                    <input
                      type="checkbox"
                      checked={editing[item.id]?.isClosed ?? item.isClosed}
                      onChange={(e) => updateEdit(item.id, { isClosed: e.target.checked })}
                    />
                    closed
                  </label>
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.startMinute ?? ""}
                    onChange={(e) => updateEdit(item.id, { startMinute: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.endMinute ?? ""}
                    onChange={(e) => updateEdit(item.id, { endMinute: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="gc-input"
                    value={editing[item.id]?.note ?? ""}
                    onChange={(e) => updateEdit(item.id, { note: e.target.value })}
                  />
                </td>
                <td>
                  <div className="gc-inline-actions">
                    <button className="gc-pill-btn" onClick={() => void saveException(item.id)}>
                      Save
                    </button>
                    <button className="gc-pill-btn" onClick={() => void removeException(item.id)}>
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
