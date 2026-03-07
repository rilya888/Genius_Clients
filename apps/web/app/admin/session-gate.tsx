"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LogoutButton } from "./logout-button";

type SessionInfo = {
  email?: string;
  role?: string;
};

export function SessionGate({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionInfo | null>(null);

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
      <main style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
        <p style={{ color: "#4b5563", margin: 0 }}>Checking session...</p>
      </main>
    );
  }

  return (
    <div>
      <div
        style={{
          maxWidth: 1080,
          margin: "12px auto 0",
          padding: "0 24px",
          color: "#4b5563",
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <span>
          {session?.email ?? "unknown"} ({session?.role ?? "unknown"})
        </span>
        <LogoutButton />
      </div>
      {children}
    </div>
  );
}
