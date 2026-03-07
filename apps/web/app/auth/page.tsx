"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveLocale, t, type SupportedLocale } from "@genius/i18n";
import { parseLocaleCookie, setUiLocaleCookie } from "../../lib/ui-locale";

type SessionInfo = {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
};

export default function AuthPage() {
  const [uiLocale, setUiLocale] = useState<SupportedLocale>("it");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [status, setStatus] = useState<string>("");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const requestedFromQuery = new URLSearchParams(window.location.search).get("locale");
    const requestedFromCookie = parseLocaleCookie(document.cookie);
    setUiLocale(
      resolveLocale({
        requested: requestedFromQuery ?? requestedFromCookie ?? window.navigator.language.toLowerCase(),
        tenantDefault: "it"
      })
    );
  }, []);

  useEffect(() => {
    setUiLocaleCookie(uiLocale);
  }, [uiLocale]);

  useEffect(() => {
    let mounted = true;

    async function loadSession() {
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

        if (response.ok) {
          setSession(payload?.data as SessionInfo);
          window.location.href = "/admin";
          return;
        }

        setCheckingSession(false);
      } catch {
        if (!mounted) {
          return;
        }
        setCheckingSession(false);
      }
    }

    void loadSession();
    return () => {
      mounted = false;
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!email || !password) {
      return false;
    }
    if (mode === "register" && !businessName) {
      return false;
    }
    return true;
  }, [businessName, email, mode, password]);

  async function submit() {
    setStatus(t("auth.submitting", { locale: uiLocale }));
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      mode === "login"
        ? { email, password }
        : { email, password, businessName, slug: slug || undefined };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();

    if (!response.ok) {
      setStatus(payload?.error?.message ?? "Request failed");
      return;
    }

    const meResponse = await fetch("/api/auth/me");
    const mePayload = await meResponse.json();
    if (meResponse.ok) {
      setSession(mePayload.data as SessionInfo);
      setStatus(t("auth.authenticated", { locale: uiLocale }));
      window.location.href = "/admin";
      return;
    }

    setStatus(t("auth.profileLoadFailed", { locale: uiLocale }));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    setStatus(t("auth.loggedOut", { locale: uiLocale }));
  }

  async function requestEmailVerification() {
    const response = await fetch("/api/auth/request-email-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verificationEmail || email || undefined })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
      return;
    }

    const preview = payload?.data?.verificationTokenPreview;
    setStatus(
      preview
        ? `${t("auth.verificationRequested", { locale: uiLocale })}: ${String(preview)}`
        : t("auth.verificationRequested", { locale: uiLocale })
    );
  }

  async function verifyEmail() {
    if (!verificationToken.trim()) {
      return;
    }

    const response = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: verificationToken.trim() })
    });
    const payload = await response.json();
    if (!response.ok) {
      setStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
      return;
    }

    setStatus(t("auth.emailVerified", { locale: uiLocale }));
  }

  if (checkingSession) {
    return (
      <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
        <p style={{ color: "#374151", marginTop: 0 }}>Checking session...</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>{t("auth.title", { locale: uiLocale })}</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setMode("login")} disabled={mode === "login"}>
          {t("auth.login", { locale: uiLocale })}
        </button>
        <button onClick={() => setMode("register")} disabled={mode === "register"}>
          {t("auth.register", { locale: uiLocale })}
        </button>
        <button onClick={logout}>{t("auth.logout", { locale: uiLocale })}</button>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10
        }}
      >
        <label>
          {t("auth.email", { locale: uiLocale })}
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          {t("auth.password", { locale: uiLocale })}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        {mode === "register" ? (
          <>
            <label>
              {t("auth.businessName", { locale: uiLocale })}
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                style={{ width: "100%" }}
              />
            </label>
            <label>
              {t("auth.slugOptional", { locale: uiLocale })}
              <input value={slug} onChange={(e) => setSlug(e.target.value)} style={{ width: "100%" }} />
            </label>
          </>
        ) : null}

        <button disabled={!canSubmit} onClick={submit}>
          {mode === "login"
            ? t("auth.login", { locale: uiLocale })
            : t("auth.register", { locale: uiLocale })}
        </button>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: 8,
          padding: 16,
          display: "grid",
          gap: 10,
          marginTop: 12
        }}
      >
        <label>
          {t("auth.email", { locale: uiLocale })}
          <input
            value={verificationEmail}
            onChange={(e) => setVerificationEmail(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button onClick={requestEmailVerification}>
          {t("auth.requestVerification", { locale: uiLocale })}
        </button>

        <label>
          {t("auth.verificationToken", { locale: uiLocale })}
          <input
            value={verificationToken}
            onChange={(e) => setVerificationToken(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>
        <button onClick={verifyEmail}>{t("auth.verifyEmail", { locale: uiLocale })}</button>
      </div>

      <p style={{ color: "#374151", marginTop: 12 }}>{status}</p>
      {session ? (
        <pre
          style={{
            background: "#111827",
            color: "#f9fafb",
            borderRadius: 8,
            padding: 12,
            overflowX: "auto"
          }}
        >
          {JSON.stringify(session, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}
