"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";
import { isUiV2Enabled } from "../../lib/ui-flags";

type SessionInfo = {
  email?: string;
  role?: string;
};

export function SessionGate({ children }: { children: ReactNode }) {
  const uiV2Enabled = isUiV2Enabled();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const navItems = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/masters", label: "Masters" },
    { href: "/admin/services", label: "Services" },
    { href: "/admin/master-services", label: "Master Services" },
    { href: "/admin/working-hours", label: "Working Hours" },
    { href: "/admin/exceptions", label: "Exceptions" },
    { href: "/admin/bookings", label: "Bookings" },
    { href: "/admin/settings", label: "Settings" },
    { href: "/admin/notifications", label: "Notifications" },
    { href: "/admin/master-translations", label: "Master Translations" },
    { href: "/admin/service-translations", label: "Service Translations" }
  ];

  useEffect(() => {
    let mounted = true;

    async function verifySession() {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin"
        });
        const payload = await response.json().catch(() => null);
        if (!mounted) {
          return;
        }

        if (!response.ok) {
          window.location.href = "/auth";
          return;
        }

        setSession(payload?.data ?? null);
        setLoading(false);
      } catch {
        if (!mounted) {
          return;
        }
        window.location.href = "/auth";
      }
    }

    void verifySession();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <main className="gc-admin-shell gc-session-check">
        <p className="gc-session-line">Checking session...</p>
      </main>
    );
  }

  return (
    <div className={uiV2Enabled ? "gc-admin-v2-root" : ""}>
      <div className={`gc-admin-shell gc-session-toolbar${uiV2Enabled ? " gc-session-toolbar-v2 gc-session-toolbar-v3" : ""}`}>
        {uiV2Enabled ? (
          <div className="gc-session-head">
            <div className="gc-session-brand">
              <strong>Genius Clients</strong>
              <span>Admin workspace</span>
            </div>
            <div className="gc-session-user">
              <span className="gc-session-user-avatar">
                {(session?.email ?? "U").slice(0, 1).toUpperCase()}
              </span>
              <span className="gc-session-user-meta">
                {session?.email ?? "unknown"} ({session?.role ?? "unknown"})
              </span>
            </div>
          </div>
        ) : (
          <span>
            {session?.email ?? "unknown"} ({session?.role ?? "unknown"})
          </span>
        )}
        <LogoutButton />
      </div>
      {uiV2Enabled ? (
        <div className="gc-admin-shell gc-admin-v2-intro gc-v2-fade-up">
          <div>
            <strong>Operations Control</strong>
            <p>Manage bookings, schedules, services, notifications, and tenant settings in one workspace.</p>
          </div>
          <div className="gc-admin-v2-intro-badges">
            <span>Tenant-aware</span>
            <span>Session-secure</span>
            <span>Realtime-ready</span>
          </div>
        </div>
      ) : null}
      {uiV2Enabled ? (
        <div className="gc-admin-layout gc-admin-layout-v2">
          <aside className="gc-admin-sidebar gc-admin-sidebar-v2">
            <label className="gc-admin-mobile-nav">
              <span className="gc-field-label">Jump to section</span>
              <select
                className="gc-select"
                value={pathname}
                onChange={(event) => {
                  window.location.href = event.target.value;
                }}
              >
                {navItems.map((item) => (
                  <option key={item.href} value={item.href}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <ul className="gc-admin-sidebar-list">
              {navItems.map((item) => {
                const active =
                  item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      className={`gc-admin-sidebar-link${active ? " gc-v2-fade-up" : ""}`}
                      href={item.href}
                      data-active={active}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>
          <div className="gc-admin-content gc-admin-content-v2">{children}</div>
        </div>
      ) : (
        <div className="gc-admin-shell">{children}</div>
      )}
    </div>
  );
}
