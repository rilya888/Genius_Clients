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
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Schedule Exceptions</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 140px 140px 1fr auto", gap: 8, marginBottom: 8 }}>
        <select value={masterId} onChange={(e) => setMasterId(e.target.value)}>
          <option value="">Global (all masters)</option>
          {masters.map((item) => (
            <option key={item.id} value={item.id}>
              {item.displayName}
            </option>
          ))}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input placeholder="Start min" value={startMinute} onChange={(e) => setStartMinute(e.target.value)} />
        <input placeholder="End min" value={endMinute} onChange={(e) => setEndMinute(e.target.value)} />
        <input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <button onClick={() => void createException()}>Create</button>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <input type="checkbox" checked={isClosed} onChange={(e) => setIsClosed(e.target.checked)} />
        Closed day
      </label>
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
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Master</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Date</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Closed</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Start</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>End</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Note</th>
            <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #e5e7eb" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <select
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
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  type="date"
                  value={editing[item.id]?.date ?? item.date}
                  onChange={(e) => updateEdit(item.id, { date: e.target.value })}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  type="checkbox"
                  checked={editing[item.id]?.isClosed ?? item.isClosed}
                  onChange={(e) => updateEdit(item.id, { isClosed: e.target.checked })}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  value={editing[item.id]?.startMinute ?? ""}
                  onChange={(e) => updateEdit(item.id, { startMinute: e.target.value })}
                  style={{ width: 90 }}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  value={editing[item.id]?.endMinute ?? ""}
                  onChange={(e) => updateEdit(item.id, { endMinute: e.target.value })}
                  style={{ width: 90 }}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>
                <input
                  value={editing[item.id]?.note ?? ""}
                  onChange={(e) => updateEdit(item.id, { note: e.target.value })}
                  style={{ width: "100%" }}
                />
              </td>
              <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", display: "flex", gap: 8 }}>
                <button onClick={() => void saveException(item.id)}>Save</button>
                <button onClick={() => void removeException(item.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
