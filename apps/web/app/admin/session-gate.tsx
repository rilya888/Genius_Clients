"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "./logout-button";

type SessionInfo = {
  email?: string;
  role?: string;
};

export function SessionGate({ children }: { children: ReactNode }) {
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
    <div>
      <div className="gc-admin-shell gc-session-toolbar">
        <span>
          {session?.email ?? "unknown"} ({session?.role ?? "unknown"})
        </span>
        <LogoutButton />
      </div>
      <div className="gc-admin-layout">
        <aside className="gc-admin-sidebar">
          <ul className="gc-admin-sidebar-list">
            {navItems.map((item) => {
              const active =
                item.href === "/admin" ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link className="gc-admin-sidebar-link" href={item.href} data-active={active}>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="gc-admin-content">{children}</div>
      </div>
    </div>
  );
}
