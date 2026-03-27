import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";
import { me } from "../api/authApi";
import { getAdminScope } from "../api/adminApi";
import { ApiHttpError } from "../api/http";
import { clearSession, ensureAccessToken } from "../auth/session";

export const roles = ["owner", "admin", "operator", "account_admin", "salon_admin", "manager"] as const;

type Role = (typeof roles)[number];

type ScopeContextValue = {
  accountId: string;
  salonId: string;
  accounts: Array<{ id: string; name: string; slug?: string }>;
  salons: Array<{ id: string; accountId: string; name: string; isPrimary?: boolean }>;
  capabilities: { multiSalon: boolean };
  tenantId: string | null;
  tenantTimezone: string;
  userEmail: string | null;
  hydrated: boolean;
  role: Role;
  setAccountId: (value: string) => void;
  setSalonId: (value: string) => void;
  setRole: (value: Role) => void;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  const [accountId, setAccountId] = useState("current");
  const [salonId, setSalonId] = useState("default");
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; slug?: string }>>([]);
  const [salons, setSalons] = useState<Array<{ id: string; accountId: string; name: string; isPrimary?: boolean }>>(
    []
  );
  const [capabilities, setCapabilities] = useState<{ multiSalon: boolean }>({ multiSalon: false });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantTimezone, setTenantTimezone] = useState("Europe/Rome");
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [role, setRole] = useState<Role>("owner");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const accessToken = await ensureAccessToken();
        if (!accessToken) {
          if (!cancelled) {
            setHydrated(true);
          }
          return;
        }
        const [profile, scope] = await Promise.all([me(accessToken), getAdminScope()]);
        if (cancelled) {
          return;
        }
        setTenantId(profile.tenantId);
        setUserEmail(profile.email);
        setAccounts([
          {
            id: scope.account.id,
            name: scope.account.name,
            slug: scope.account.slug
          }
        ]);
        setTenantTimezone(scope.account.timezone || "Europe/Rome");
        setSalons(scope.salons);
        setCapabilities(scope.capabilities);
        setAccountId(scope.account.id);
        setSalonId(scope.salons[0]?.id ?? "default");
        const normalizedRole = roles.includes(profile.role as Role) ? (profile.role as Role) : "owner";
        setRole(normalizedRole);
      } catch (error) {
        if (error instanceof ApiHttpError && error.status === 401) {
          clearSession();
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const value = useMemo(
    () => ({
      accountId,
      salonId,
      accounts,
      salons,
      capabilities,
      tenantId,
      tenantTimezone,
      userEmail,
      hydrated,
      role,
      setAccountId,
      setSalonId,
      setRole
    }),
    [accountId, salonId, accounts, salons, capabilities, tenantId, tenantTimezone, userEmail, hydrated, role]
  );

  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScopeContext() {
  const value = useContext(ScopeContext);
  if (!value) {
    throw new Error("useScopeContext must be used inside ScopeProvider");
  }
  return value;
}
