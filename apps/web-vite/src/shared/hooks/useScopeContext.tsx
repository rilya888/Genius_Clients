import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";

export const roles = ["owner", "account_admin", "salon_admin", "manager", "operator"] as const;

type Role = (typeof roles)[number];

type ScopeContextValue = {
  accountId: string;
  salonId: string;
  role: Role;
  setAccountId: (value: string) => void;
  setSalonId: (value: string) => void;
  setRole: (value: Role) => void;
};

const ScopeContext = createContext<ScopeContextValue | null>(null);

export function ScopeProvider({ children }: PropsWithChildren) {
  const [accountId, setAccountId] = useState("acc_1");
  const [salonId, setSalonId] = useState("sal_1");
  const [role, setRole] = useState<Role>("owner");

  const value = useMemo(
    () => ({
      accountId,
      salonId,
      role,
      setAccountId,
      setSalonId,
      setRole
    }),
    [accountId, salonId, role]
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
