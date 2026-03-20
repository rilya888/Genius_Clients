import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { me } from "../shared/api/authApi";
import { clearSession, ensureAccessToken } from "../shared/auth/session";
import { buildTenantAppUrl, resolveCurrentTenantSlug } from "../shared/routing/tenant-host";

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
        const profile = await me(accessToken);
        const currentSlug = resolveCurrentTenantSlug();
        if (profile.slug) {
          const targetUrl = buildTenantAppUrl(profile.slug);
          const isAbsoluteTarget = targetUrl.startsWith("http://") || targetUrl.startsWith("https://");
          if (isAbsoluteTarget && currentSlug !== profile.slug) {
            window.location.assign(targetUrl);
            return;
          }
        }
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
