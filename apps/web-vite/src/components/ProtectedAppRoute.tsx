import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { me } from "../shared/api/authApi";
import { clearSession, ensureAccessToken } from "../shared/auth/session";

export function ProtectedAppRoute() {
  const [state, setState] = useState<"checking" | "authorized" | "unauthorized">("checking");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const accessToken = await ensureAccessToken();
      if (!accessToken) {
        if (!cancelled) {
          setState("unauthorized");
        }
        return;
      }
      try {
        await me(accessToken);
        if (!cancelled) {
          setState("authorized");
        }
      } catch {
        clearSession();
        if (!cancelled) {
          setState("unauthorized");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return null;
  }
  if (state === "unauthorized") {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
