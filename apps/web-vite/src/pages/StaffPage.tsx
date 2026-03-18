import { useEffect, useState } from "react";
import { listAdminMasters } from "../shared/api/adminApi";
import { formatApiError } from "../shared/api/formatApiError";
import { EmptyState, ErrorState, LoadingState } from "../components/ui/AsyncState";
import { useI18n } from "../shared/i18n/I18nProvider";

type StaffItem = {
  id: string;
  displayName: string;
  isActive: boolean;
};

export function StaffPage() {
  const { t } = useI18n();
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
    data: StaffItem[];
  }>({ pending: true, error: null, data: [] });

  useEffect(() => {
    let cancelled = false;
    listAdminMasters()
      .then((items) => {
        if (!cancelled) {
          setState({ pending: false, error: null, data: items });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ pending: false, error: formatApiError(error, t("admin.staff.loadFailed")), data: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page-shell">
      <h1>{t("admin.staff.title")}</h1>
      {state.pending ? <LoadingState text={t("admin.staff.loading")} /> : null}
      {state.error ? <ErrorState text={state.error} /> : null}
      {!state.pending && !state.error && state.data.length === 0 ? (
        <EmptyState title={t("admin.staff.emptyTitle")} description={t("admin.staff.emptyDescription")} />
      ) : null}

      {state.data.length > 0 ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>{t("admin.staff.colId")}</th>
                <th>{t("admin.staff.colName")}</th>
                <th>{t("admin.staff.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {state.data.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.displayName}</td>
                  <td>{item.isActive ? t("common.status.active") : t("common.status.inactive")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
