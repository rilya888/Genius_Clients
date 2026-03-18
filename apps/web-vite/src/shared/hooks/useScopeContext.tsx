import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { me } from "../api/authApi";
import { clearSession, ensureAccessToken } from "../auth/session";

export const roles = ["owner", "admin", "operator", "account_admin", "salon_admin", "manager"] as const;

type Role = (typeof roles)[number];

type ScopeContextValue = {
  accountId: string;
  salonId: string;
  tenantId: string | null;
  userEmail: string | null;
  hydrated: boolean;
  role: Role;
  setAccountId: (value: string) => void;
  setSalonId: (value: string) => void;
  setRole: (value: Role) => void;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: PropsWithChildren) {
  const [accountId, setAccountId] = useState("current");
  const [salonId, setSalonId] = useState("default");
  const [tenantId, setTenantId] = useState<string | null>(null);
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
        const profile = await me(accessToken);
        if (cancelled) {
          return;
        }
        setTenantId(profile.tenantId);
        setUserEmail(profile.email);
        setAccountId(profile.tenantId);
        const normalizedRole = roles.includes(profile.role as Role) ? (profile.role as Role) : "owner";
        setRole(normalizedRole);
      } catch {
        clearSession();
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({
      accountId,
      salonId,
      tenantId,
      userEmail,
      hydrated,
      role,
      setAccountId,
      setSalonId,
      setRole
    }),
    [accountId, salonId, tenantId, userEmail, hydrated, role]
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
