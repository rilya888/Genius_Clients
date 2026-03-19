"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ApiResponse<T> = {
  data?: T;
  error?: { code: string; message: string };
};

export default function SuperAdminLoginPage() {
  const router = useRouter();
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    setStatus("");

    try {
      const response = await fetch("/api/super-admin/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": "super-admin"
        },
        body: JSON.stringify({ secret })
      });
      const payload = (await response.json().catch(() => ({}))) as ApiResponse<{ ok: boolean }>;
      if (!response.ok) {
        setStatus(payload.error?.message ?? "Login failed");
        return;
      }

      router.push("/super-admin");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="gc-auth-page">
      <h1 className="gc-auth-title">Super Admin Login</h1>
      <section className="gc-card gc-form-card">
        <label className="gc-form-label">
          Secret
          <input
            className="gc-form-input"
            placeholder="SUPER_ADMIN_LOGIN_SECRET"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="gc-primary-btn" onClick={() => void login()} disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
          <span>{status}</span>
        </div>
      </section>
    </main>
  );
}
