import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useScopeContext } from "../shared/hooks/useScopeContext";
import { logout } from "../shared/api/authApi";
import { getBillingSubscription, listAdminBookings } from "../shared/api/adminApi";
import { clearSession, getRefreshToken, isEmailVerifiedFlagSet } from "../shared/auth/session";

export function AppLayout() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { accountId, salonId, accounts, salons, capabilities, role, setAccountId, setSalonId } =
    useScopeContext();

  const availableSalons = useMemo(() => salons.filter((item) => item.accountId === accountId), [salons, accountId]);
  const selectedAccount = useMemo(() => accounts.find((item) => item.id === accountId), [accounts, accountId]);
  const selectedSalon = useMemo(() => salons.find((item) => item.id === salonId), [salons, salonId]);
  const [newBookingToastCount, setNewBookingToastCount] = useState(0);
  const [isEmailVerified, setIsEmailVerified] = useState(true);
  const [billingState, setBillingState] = useState<"ok" | "past_due_warning" | "read_only" | "hard_locked" | null>(
    null
  );
  const [billingDaysPastDue, setBillingDaysPastDue] = useState(0);
  const knownPendingBookingIdsRef = useRef<Set<string>>(new Set());
  const isPendingPollInitializedRef = useRef(false);

  async function handleLogout() {
    try {
      await logout(getRefreshToken());
    } finally {
      clearSession();
      navigate("/login", { replace: true });
    }
  }

  useEffect(() => {
    setIsEmailVerified(isEmailVerifiedFlagSet());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollBillingState() {
      try {
        const summary = await getBillingSubscription();
        if (cancelled) {
          return;
        }
        setBillingState(summary.billingState);
        setBillingDaysPastDue(summary.daysPastDue);
      } catch {
        if (cancelled) {
          return;
        }
      }
    }

    void pollBillingState();
    const timer = window.setInterval(() => {
      void pollBillingState();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollPendingBookings() {
      try {
        const items = await listAdminBookings({ status: "pending" });
        if (cancelled) {
          return;
        }

        const currentIds = new Set(items.map((item) => item.id));
        const previousIds = knownPendingBookingIdsRef.current;

        if (isPendingPollInitializedRef.current) {
          const freshCount = Array.from(currentIds).filter((id) => !previousIds.has(id)).length;
          if (freshCount > 0) {
            setNewBookingToastCount((prev) => prev + freshCount);
          }
        }

        knownPendingBookingIdsRef.current = currentIds;
        isPendingPollInitializedRef.current = true;
      } catch {
        // Ignore background polling failures to keep layout stable.
      }
    }

    void pollPendingBookings();
    const timer = window.setInterval(() => {
      void pollPendingBookings();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <LinkLikeBrand label={t("app.brand")} />
        <div className="scope-panel">
          <label>
            {t("app.scope.account")}
            <select
              value={accountId}
              disabled={accounts.length <= 1}
              onChange={(event) => {
                const nextAccountId = event.target.value;
                setAccountId(nextAccountId);
                const nextSalon = salons.find((item) => item.accountId === nextAccountId);
                setSalonId(nextSalon?.id ?? "");
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
            <select value={salonId} disabled={!capabilities.multiSalon || availableSalons.length <= 1} onChange={(event) => setSalonId(event.target.value)}>
              {availableSalons.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            {t("app.scope.role")}
            <input value={t(`app.role.${role}`)} disabled readOnly />
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
        <button className="btn btn-secondary" type="button" onClick={handleLogout}>
          {t("app.logout")}
        </button>
      </aside>
      <main className="admin-main">
        {!isEmailVerified ? (
          <div className="status-muted" role="status" aria-live="polite">
            {t("auth.emailVerificationReadOnlyNotice")}
          </div>
        ) : null}
        {newBookingToastCount > 0 ? (
          <div className="status-success" role="status" aria-live="polite">
            {t("admin.notifications.newBookingsToastPrefix")} {newBookingToastCount}
            {" · "}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setNewBookingToastCount(0);
                navigate("/app/bookings");
              }}
            >
              {t("admin.notifications.newBookingsToastAction")}
            </button>
          </div>
        ) : null}
        {billingState === "past_due_warning" ? (
          <div className="status-error" role="status" aria-live="polite">
            {t("app.billing.pastDueWarning")} {billingDaysPastDue}
          </div>
        ) : null}
        {billingState === "read_only" ? (
          <div className="status-muted" role="status" aria-live="polite">
            {t("app.billing.readOnly")}
          </div>
        ) : null}
        {billingState === "hard_locked" ? (
          <div className="status-error" role="status" aria-live="polite">
            {t("app.billing.hardLock")}
          </div>
        ) : null}
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

function LinkLikeBrand({ label }: { label: string }) {
  return (
    <div className="admin-brand">
      <img className="admin-brand-mark" src="/branding/logo-mark.svg" alt="" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
