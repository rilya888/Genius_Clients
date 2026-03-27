import { FormEvent, useEffect, useState } from "react";
import {
  createAdminMaster,
  deleteAdminMaster,
  getAdminMasterDeactivationCheck,
  listAdminMasters,
  updateAdminMaster
} from "../shared/api/adminApi";
import { ApiHttpError } from "../shared/api/http";
import { formatApiError } from "../shared/api/formatApiError";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { Modal } from "../components/ui/Modal";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useScopeContext } from "../shared/hooks/useScopeContext";
import { formatUiDateTime } from "../shared/i18n/dateTime";

type StaffItem = {
  id: string;
  displayName: string;
  isActive: boolean;
};

type EditorState = {
  mode: "create" | "edit";
  id: string | null;
  displayName: string;
  isActive: boolean;
};

export function StaffPage() {
  const { t } = useI18n();
  const { tenantTimezone } = useScopeContext();
  const [actionError, setActionError] = useState<string | null>(null);
  const [updatingMasterId, setUpdatingMasterId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    data: StaffItem[];
  }>({ pending: true, error: null, data: [] });

  async function loadMasters() {
    setState((prev) => ({ ...prev, pending: true, error: null }));
    setActionError(null);
    try {
      const items = await listAdminMasters();
      setState({ pending: false, error: null, data: items });
    } catch (error) {
      setState({ pending: false, error: formatApiError(error, t("admin.staff.loadFailed")), data: [] });
    }
  }

  useEffect(() => {
    void loadMasters();
  }, []);

  function openCreate() {
    setEditor({
      mode: "create",
      id: null,
      displayName: "",
      isActive: true
    });
    setActionError(null);
  }

  function openEdit(item: StaffItem) {
    setEditor({
      mode: "edit",
      id: item.id,
      displayName: item.displayName,
      isActive: item.isActive
    });
    setActionError(null);
  }

  async function handleStatusChange(item: StaffItem, nextActive: boolean) {
    setActionError(null);

    let forceDeactivate = false;
    if (!nextActive) {
      try {
        const impact = await getAdminMasterDeactivationCheck(item.id);
        if (impact.upcomingConfirmedCount > 0) {
          const nearestDate = impact.earliestStartAt
            ? formatUiDateTime(impact.earliestStartAt, tenantTimezone)
            : "-";
          const warningText =
            `${t("admin.staff.deactivationWarningPrefix")} ${impact.upcomingConfirmedCount}. ` +
            `${t("admin.staff.deactivationWarningNearest")} ${nearestDate}. ` +
            `${t("admin.staff.deactivationWarningSuffix")}`;
          if (!window.confirm(warningText)) {
            return;
          }
          forceDeactivate = true;
        }
      } catch (error) {
        setActionError(formatApiError(error, t("admin.staff.deactivationCheckFailed")));
        return;
      }
    }

    setUpdatingMasterId(item.id);
    const previous = state.data;
    setState((prev) => ({
      ...prev,
      data: prev.data.map((row) => (row.id === item.id ? { ...row, isActive: nextActive } : row))
    }));

    try {
      await updateAdminMaster({
        id: item.id,
        displayName: item.displayName,
        isActive: nextActive,
        forceDeactivate
      });
    } catch (error) {
      setState((prev) => ({ ...prev, data: previous }));
      setActionError(formatApiError(error, t("admin.staff.updateFailed")));
    } finally {
      setUpdatingMasterId(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) {
      return;
    }

    const displayName = editor.displayName.trim();
    if (!displayName) {
      setActionError(t("admin.staff.validationError"));
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      if (editor.mode === "create") {
        await createAdminMaster({
          displayName,
          isActive: editor.isActive
        });
      } else if (editor.id) {
        await updateAdminMaster({
          id: editor.id,
          displayName,
          isActive: editor.isActive
        });
      }
      await loadMasters();
      setEditor(null);
    } catch (error) {
      if (error instanceof ApiHttpError && error.code === "CONFLICT") {
        setActionError(t("admin.staff.duplicateName"));
      } else {
        setActionError(formatApiError(error, t("admin.staff.saveFailed")));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editor || editor.mode !== "edit" || !editor.id) {
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      await deleteAdminMaster(editor.id);
      await loadMasters();
      setEditor(null);
    } catch (error) {
      if (error instanceof ApiHttpError && error.code === "VALIDATION_ERROR") {
        setActionError(t("admin.staff.deleteBlockedByBookings"));
      } else {
        setActionError(formatApiError(error, t("admin.staff.deleteFailed")));
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-shell">
      <div className="inline-actions">
        <h1>{t("admin.staff.title")}</h1>
        <button className="btn btn-primary" type="button" onClick={openCreate}>
          {t("admin.staff.add")}
        </button>
      </div>

      {state.pending ? <LoadingState text={t("admin.staff.loading")} /> : null}
      {state.error ? <ErrorState text={state.error} /> : null}
      {actionError ? <ErrorState text={actionError} /> : null}
      {!state.pending && !state.error && state.data.length === 0 ? (
        <EmptyState title={t("admin.staff.emptyTitle")} description={t("admin.staff.emptyDescription")} />
      ) : null}

      {state.data.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("admin.staff.colName")}</th>
                <th>{t("admin.staff.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button className="btn btn-ghost" type="button" onClick={() => openEdit(item)}>
                      {item.displayName}
                    </button>
                  </td>
                  <td>
                    <select
                      value={item.isActive ? "active" : "inactive"}
                      disabled={updatingMasterId === item.id}
                      onChange={(event) => handleStatusChange(item, event.target.value === "active")}
                    >
                      <option value="active">{t("common.status.active")}</option>
                      <option value="inactive">{t("common.status.inactive")}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {editor ? (
        <Modal title={editor.mode === "create" ? t("admin.staff.createTitle") : t("admin.staff.editTitle")} onClose={() => setEditor(null)}>
          <form className="auth-card" onSubmit={handleSubmit}>
            <label>
              {t("admin.staff.colName")}
              <input
                value={editor.displayName}
                onChange={(event) => setEditor((prev) => (prev ? { ...prev, displayName: event.target.value } : prev))}
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
