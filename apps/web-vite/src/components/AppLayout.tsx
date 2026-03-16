import { NavLink, Outlet } from "react-router-dom";
import { useMemo } from "react";
import { useI18n } from "../shared/i18n/I18nProvider";
import { roles, useScopeContext } from "../shared/hooks/useScopeContext";

const accounts = [
  { id: "acc_1", name: "Genius Group" },
  { id: "acc_2", name: "Studio Holding" }
];

const salons = [
  { id: "sal_1", accountId: "acc_1", name: "Milano Downtown" },
  { id: "sal_2", accountId: "acc_1", name: "Roma Centro" },
  { id: "sal_3", accountId: "acc_2", name: "Torino Aura" }
];

export function AppLayout() {
  const { t } = useI18n();
  const { accountId, salonId, role, setAccountId, setSalonId, setRole } = useScopeContext();

  const availableSalons = useMemo(() => salons.filter((item) => item.accountId === accountId), [accountId]);
  const selectedAccount = useMemo(() => accounts.find((item) => item.id === accountId), [accountId]);
  const selectedSalon = useMemo(() => salons.find((item) => item.id === salonId), [salonId]);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <h2>{t("app.brand")}</h2>
        <div className="scope-panel">
          <label>
            {t("app.scope.account")}
            <select
              value={accountId}
              onChange={(event) => {
                const nextAccountId = event.target.value;
                setAccountId(nextAccountId);
                const firstSalon = salons.find((item) => item.accountId === nextAccountId);
                setSalonId(firstSalon?.id ?? "");
              }}
            >
              {accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("app.scope.salon")}
            <select value={salonId} onChange={(event) => setSalonId(event.target.value)}>
              {availableSalons.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("app.scope.role")}
            <select value={role} onChange={(event) => setRole(event.target.value as (typeof roles)[number])}>
              {roles.map((item) => (
                <option key={item} value={item}>
                  {t(`app.role.${item}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <nav>
          <NavLink to="/app">{t("app.dashboard")}</NavLink>
          <NavLink to="/app/bookings">{t("app.bookings")}</NavLink>
          <NavLink to="/app/services">{t("app.services")}</NavLink>
          <NavLink to="/app/staff">{t("app.staff")}</NavLink>
          <NavLink to="/app/schedule">{t("app.schedule")}</NavLink>
          <NavLink to="/app/settings">{t("app.settings")}</NavLink>
          <NavLink to="/app/settings/faq">{t("app.faqSettings")}</NavLink>
          <NavLink to="/app/settings/privacy">{t("app.privacy")}</NavLink>
          <NavLink to="/app/settings/notifications">{t("app.notifications")}</NavLink>
        </nav>
      </aside>
      <main className="admin-main">
        <div className="scope-indicator">
          <span>
            {t("app.scope.account")}: {selectedAccount?.name ?? t("app.scope.notSelected")}
          </span>
          <span>
            {t("app.scope.salon")}: {selectedSalon?.name ?? t("app.scope.notSelected")}
          </span>
          <span>
            {t("app.scope.role")}: {t(`app.role.${role}`)}
          </span>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
