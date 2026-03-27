import { Link } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";
import { buildTenantScopedPath, resolveCurrentTenantSlug } from "../shared/routing/tenant-host";

export function BackToDashboardAction() {
  const { t } = useI18n();
  const currentTenantSlug = resolveCurrentTenantSlug();
  const href = currentTenantSlug ? buildTenantScopedPath(currentTenantSlug, "/app") : "/app";

  return (
    <div className="back-dashboard-action">
      <Link className="btn btn-secondary" to={href}>
        {t("app.backToDashboard")}
      </Link>
    </div>
  );
}

