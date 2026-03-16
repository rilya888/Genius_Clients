"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resolveLocale, t, type SupportedLocale } from "@genius/i18n";
import { parseLocaleCookie, setUiLocaleCookie } from "../../lib/ui-locale";
import { isUiV2Enabled } from "../../lib/ui-flags";

type SessionInfo = {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
};
type StatusTone = "neutral" | "error" | "success";

export default function AuthPage() {
  const uiV2Enabled = isUiV2Enabled();
  const searchParams = useSearchParams();
  const [uiLocale, setUiLocale] = useState<SupportedLocale>("it");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [status, setStatus] = useState<string>("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const requestedFromQuery = searchParams.get("locale");
    const requestedFromCookie = parseLocaleCookie(document.cookie);
    setUiLocale(
      resolveLocale({
        requested: requestedFromQuery ?? requestedFromCookie ?? window.navigator.language.toLowerCase(),
        tenantDefault: "it"
      })
    );
  }, [searchParams]);

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

  function setNeutralStatus(message: string) {
    setStatus(message);
    setStatusTone("neutral");
  }

  function setErrorStatus(message: string) {
    setStatus(message);
    setStatusTone("error");
  }

  function setSuccessStatus(message: string) {
    setStatus(message);
    setStatusTone("success");
  }

  async function submit() {
    setNeutralStatus(t("auth.submitting", { locale: uiLocale }));
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      mode === "login"
        ? { email, password }
        : { email, password, businessName, slug: slug || undefined };

    let response: Response;
    let payload: any = null;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      payload = await response.json().catch(() => null);
    } catch {
      setErrorStatus(t("common.errors.generic", { locale: uiLocale }));
      return;
    }

    if (!response.ok) {
      setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
      return;
    }

    const meResponse = await fetch("/api/auth/me");
    const mePayload = await meResponse.json();
    if (meResponse.ok) {
      setSession(mePayload.data as SessionInfo);
      setSuccessStatus(t("auth.authenticated", { locale: uiLocale }));
      window.location.href = "/admin";
      return;
    }

    setErrorStatus(t("auth.profileLoadFailed", { locale: uiLocale }));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    setSuccessStatus(t("auth.loggedOut", { locale: uiLocale }));
  }

  async function requestEmailVerification() {
    const response = await fetch("/api/auth/request-email-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: verificationEmail || email || undefined })
    });
    const payload = await response.json();
    if (!response.ok) {
      setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
      return;
    }

    const preview = payload?.data?.verificationTokenPreview;
    setSuccessStatus(
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
      setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
      return;
    }

    setSuccessStatus(t("auth.emailVerified", { locale: uiLocale }));
  }

  if (checkingSession) {
    return (
      <main className="gc-auth-page">
        <p className="gc-status-text gc-mt-0">
          Checking session...
        </p>
      </main>
    );
  }

  return (
    <main className={`gc-auth-page${uiV2Enabled ? " gc-auth-page-v2" : ""}`}>
      <h1 className="gc-auth-title">{t("auth.title", { locale: uiLocale })}</h1>
      {uiV2Enabled ? (
        <p className="gc-auth-subtitle gc-v2-fade-up">
          Secure authentication gateway for tenant onboarding and operator access.
        </p>
      ) : null}

      <section className={uiV2Enabled ? "gc-auth-layout" : ""}>
        {uiV2Enabled ? (
          <aside className="gc-card gc-auth-intro-card gc-v2-fade-up">
            <h2 className="gc-auth-intro-title">Access and onboarding</h2>
            <p className="gc-auth-intro-text">
              Use login for existing operators or create a new tenant account to initialize your
              business workspace.
            </p>
            <ul className="gc-auth-points">
              <li>Session-based authentication via BFF routes</li>
              <li>Tenant-aware onboarding with optional slug</li>
              <li>Email verification flow for account trust</li>
            </ul>
            <div className="gc-auth-intro-metrics">
              <div>
                <strong>IT/EN</strong>
                <span>locale-aware onboarding</span>
              </div>
              <div>
                <strong>BFF</strong>
                <span>session-safe auth flow</span>
              </div>
            </div>
          </aside>
        ) : null}

        <div className={`gc-auth-main${uiV2Enabled ? " gc-v2-fade-up gc-v2-fade-up-delay-1" : ""}`}>
          <div className={`gc-auth-toolbar${uiV2Enabled ? " gc-auth-toolbar-v2" : ""}`}>
            <button className="gc-pill-btn" onClick={() => setMode("login")} disabled={mode === "login"}>
              {t("auth.login", { locale: uiLocale })}
            </button>
            <button
              className="gc-pill-btn"
              onClick={() => setMode("register")}
              disabled={mode === "register"}
            >
              {t("auth.register", { locale: uiLocale })}
            </button>
            <button className="gc-pill-btn" onClick={logout}>
              {t("auth.logout", { locale: uiLocale })}
            </button>
          </div>

          <div className="gc-card gc-form-card">
            <label className="gc-form-label">
              {t("auth.email", { locale: uiLocale })}
              <input
                className="gc-form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="gc-form-label">
              {t("auth.password", { locale: uiLocale })}
              <input
                className="gc-form-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {mode === "register" ? (
              <>
                <label className="gc-form-label">
                  {t("auth.businessName", { locale: uiLocale })}
                  <input
                    className="gc-form-input"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                </label>
                <label className="gc-form-label">
                  {t("auth.slugOptional", { locale: uiLocale })}
                  <input className="gc-form-input" value={slug} onChange={(e) => setSlug(e.target.value)} />
                </label>
              </>
            ) : null}

            <button className="gc-primary-btn" disabled={!canSubmit} onClick={submit}>
              {mode === "login"
                ? t("auth.login", { locale: uiLocale })
                : t("auth.register", { locale: uiLocale })}
            </button>
          </div>

          <div className="gc-card gc-form-card gc-mt-12">
            <label className="gc-form-label">
              {t("auth.email", { locale: uiLocale })}
              <input
                className="gc-form-input"
                value={verificationEmail}
                onChange={(e) => setVerificationEmail(e.target.value)}
              />
            </label>
            <button className="gc-primary-btn" onClick={requestEmailVerification}>
              {t("auth.requestVerification", { locale: uiLocale })}
            </button>

            <label className="gc-form-label">
              {t("auth.verificationToken", { locale: uiLocale })}
              <input
                className="gc-form-input"
                value={verificationToken}
                onChange={(e) => setVerificationToken(e.target.value)}
              />
            </label>
            <button className="gc-primary-btn" onClick={verifyEmail}>
              {t("auth.verifyEmail", { locale: uiLocale })}
            </button>
          </div>

          <p className={`gc-status-text gc-status-${statusTone}`} role="status" aria-live="polite">{status}</p>
          {session ? (
            <pre className="gc-debug-box">
              {JSON.stringify(session, null, 2)}
            </pre>
          ) : null}
        </div>
      </section>
    </main>
  );
}
