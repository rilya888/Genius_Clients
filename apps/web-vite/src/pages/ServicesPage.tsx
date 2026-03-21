import { FormEvent, useEffect, useState } from "react";
import {
  createAdminService,
  deleteAdminService,
  getServiceMasterMappings,
  listAdminMasters,
  listAdminServices,
  updateAdminService,
  updateServiceMasterMappings
} from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { Modal } from "../components/ui/Modal";
import { useI18n } from "../shared/i18n/I18nProvider";

type ServiceItem = {
  id: string;
  displayName: string;
  durationMinutes: number;
  priceCents: number | null;
  sortOrder: number;
  isActive: boolean;
};

type EditorState = {
  mode: "create" | "edit";
  id: string | null;
  displayName: string;
  durationMinutes: string;
  price: string;
  sortOrder: string;
  isActive: boolean;
  masterIds: string[];
};

function createEmptyEditor(sortOrder = 0): EditorState {
  return {
    mode: "create",
    id: null,
    displayName: "",
    durationMinutes: "30",
    price: "",
    sortOrder: String(sortOrder),
    isActive: true,
    masterIds: []
  };
}

export function ServicesPage() {
  const { t } = useI18n();
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    data: ServiceItem[];
  }>({
    pending: true,
    error: null,
    data: []
  });
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [availableMasters, setAvailableMasters] = useState<Array<{ id: string; displayName: string }>>([]);

  async function loadServices() {
    setState((prev) => ({ ...prev, pending: true, error: null }));
    try {
      const items = await listAdminServices();
      setState({
        pending: false,
        error: null,
        data: items.map((item) => ({
          id: item.id,
          displayName: item.displayName,
          durationMinutes: item.durationMinutes,
          priceCents: item.priceCents,
          sortOrder: item.sortOrder,
          isActive: item.isActive
        }))
      });
    } catch (error) {
      setState({ pending: false, error: formatApiError(error, t("services.loadFailed")), data: [] });
    }
  }

  useEffect(() => {
    void loadServices();
    listAdminMasters()
      .then((items) => {
        setAvailableMasters(items.filter((item) => item.isActive).map((item) => ({ id: item.id, displayName: item.displayName })));
      })
      .catch(() => {
        setAvailableMasters([]);
      });
  }, []);

  function openCreate() {
    const maxSortOrder = state.data.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    setEditor(createEmptyEditor(maxSortOrder + 10));
    setMessage(null);
  }

  async function openEdit(service: ServiceItem) {
    let masterIds: string[] = [];
    try {
      const mapping = await getServiceMasterMappings(service.id);
      masterIds = mapping.masterIds;
    } catch {
      masterIds = [];
    }
    setEditor({
      mode: "edit",
      id: service.id,
      displayName: service.displayName,
      durationMinutes: String(service.durationMinutes),
      price: service.priceCents === null ? "" : String(service.priceCents / 100),
      sortOrder: String(service.sortOrder),
      isActive: service.isActive,
      masterIds
    });
    setMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) {
      return;
    }

    const displayName = editor.displayName.trim();
    const durationMinutes = Number(editor.durationMinutes);
    const sortOrder = Number(editor.sortOrder);
    const priceCents = editor.price.trim() === "" ? null : Math.round(Number(editor.price) * 100);

    if (!displayName || !Number.isInteger(durationMinutes) || durationMinutes <= 0 || !Number.isInteger(sortOrder)) {
      setIsError(true);
      setMessage(t("services.validationError"));
      return;
    }
    if (priceCents !== null && (!Number.isFinite(priceCents) || priceCents < 0)) {
      setIsError(true);
      setMessage(t("services.validationError"));
      return;
    }
    if (editor.isActive && editor.masterIds.length === 0) {
      setIsError(true);
      setMessage(t("services.masterRequiredForActive"));
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      if (editor.mode === "create") {
        await createAdminService({
          displayName,
          durationMinutes,
          priceCents,
          sortOrder,
          isActive: editor.isActive,
          masterIds: editor.masterIds
        });
        setIsError(false);
        setMessage(t("services.createSuccess"));
      } else if (editor.id) {
        await updateAdminService({
          id: editor.id,
          displayName,
          durationMinutes,
          priceCents,
          sortOrder,
          isActive: editor.isActive
        });
        await updateServiceMasterMappings({
          serviceId: editor.id,
          masterIds: editor.masterIds
        });
        setIsError(false);
        setMessage(t("services.updateSuccess"));
      }

      await loadServices();
      setEditor(null);
    } catch (error) {
      setIsError(true);
      setMessage(formatApiError(error, t("services.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editor || editor.mode !== "edit" || !editor.id) {
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await deleteAdminService(editor.id);
      setIsError(false);
      setMessage(t("services.deleteSuccess"));
      await loadServices();
      setEditor(null);
    } catch (error) {
      setIsError(true);
      setMessage(formatApiError(error, t("services.deleteFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-shell">
      <div className="inline-actions">
        <h1>{t("services.title")}</h1>
        <button className="btn btn-primary" type="button" onClick={openCreate}>
          {t("services.add")}
        </button>
      </div>

      {state.pending ? <LoadingState text={t("services.loading")} /> : null}
      {state.error ? <ErrorState text={state.error} /> : null}
      {message ? <p className={isError ? "status-error" : "status-success"}>{message}</p> : null}

      {!state.pending && !state.error && state.data.length === 0 ? (
        <EmptyState title={t("services.emptyTitle")} description={t("services.emptyDescription")} />
      ) : null}

      <div className="feature-grid">
        {state.data.map((service) => (
          <article className="service-card card-hover" key={service.id}>
            <h3>{service.displayName}</h3>
            <p>{service.durationMinutes}m</p>
            <p>{service.priceCents ? `€${(service.priceCents / 100).toFixed(2)}` : t("services.priceUnset")}</p>
            <p>{service.isActive ? t("common.status.active") : t("common.status.inactive")}</p>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                void openEdit(service);
              }}
            >
              {t("common.action.edit")}
            </button>
          </article>
        ))}
      </div>

      {editor ? (
        <Modal title={editor.mode === "create" ? t("services.createTitle") : t("services.editTitle")} onClose={() => setEditor(null)}>
          <form onSubmit={handleSubmit} className="auth-card">
            <label>
              {t("services.fieldName")}
              <input
                value={editor.displayName}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, displayName: event.target.value } : prev))}
                required
              />
            </label>
            <label>
              {t("services.fieldDuration")}
              <input
                type="number"
                min={1}
                value={editor.durationMinutes}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, durationMinutes: event.target.value } : prev))}
                required
              />
            </label>
            <label>
              {t("services.fieldPrice")}
              <input
                type="number"
                min={0}
                step="0.01"
                value={editor.price}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, price: event.target.value } : prev))}
              />
            </label>
            <label>
              {t("services.fieldSortOrder")}
              <input
                type="number"
                value={editor.sortOrder}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, sortOrder: event.target.value } : prev))}
                required
              />
            </label>
            <label>
              {t("admin.staff.colStatus")}
              <select
                value={editor.isActive ? "active" : "inactive"}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, isActive: event.target.value === "active" } : prev))}
              >
                <option value="active">{t("common.status.active")}</option>
                <option value="inactive">{t("common.status.inactive")}</option>
              </select>
            </label>
            <label>
              {t("services.fieldMasters")}
              <div className="table-shell" style={{ display: "grid", gap: "0.35rem", maxHeight: "180px", overflow: "auto" }}>
                {availableMasters.map((master) => (
                  <label key={master.id}>
                    <input
                      type="checkbox"
                      checked={editor.masterIds.includes(master.id)}
                      onChange={(event) => {
                        setEditor((prev) => {
                          if (!prev) {
                            return prev;
                          }
                          if (event.target.checked) {
                            return { ...prev, masterIds: [...prev.masterIds, master.id] };
                          }
                          return { ...prev, masterIds: prev.masterIds.filter((id) => id !== master.id) };
                        });
                      }}
                    />
                    {master.displayName}
                  </label>
                ))}
              </div>
            </label>
            <div className="inline-actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? t("auth.loading") : t("common.action.save")}
              </button>
              {editor.mode === "edit" ? (
                <button className="btn btn-ghost" type="button" onClick={handleDelete} disabled={saving}>
                  {t("common.action.delete")}
                </button>
              ) : null}
              <button className="btn btn-ghost" type="button" onClick={() => setEditor(null)} disabled={saving}>
                {t("common.action.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
