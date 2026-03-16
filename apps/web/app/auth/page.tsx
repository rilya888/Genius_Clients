"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { resolveLocale, t, type SupportedLocale } from "@genius/i18n";
import { parseLocaleCookie, setUiLocaleCookie } from "../../lib/ui-locale";
import { isUiV2Enabled, isUiV3Enabled } from "../../lib/ui-flags";

type SessionInfo = {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
};

type StatusTone = "neutral" | "error" | "success";
type AuthMode = "login" | "register" | "forgot" | "reset" | "verify";

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
  data?: {
    verificationTokenPreview?: string;
  };
};

const AUTH_MODES: AuthMode[] = ["login", "register", "forgot", "reset", "verify"];

function modeLabel(mode: AuthMode): string {
  if (mode === "login") {
    return "Login";
  }
  if (mode === "register") {
    return "Register";
  }
  if (mode === "forgot") {
    return "Forgot";
  }
  if (mode === "reset") {
    return "Reset";
  }
  return "Verify";
}

async function postJson(path: string, body: Record<string, unknown>): Promise<{ response: Response; payload: ApiErrorPayload | null }> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  return { response, payload };
}

export default function AuthPage() {
  const uiV2Enabled = isUiV2Enabled();
  const uiV3Enabled = isUiV3Enabled();
  const modernUiEnabled = uiV3Enabled || uiV2Enabled;
  const searchParams = useSearchParams();

  const [uiLocale, setUiLocale] = useState<SupportedLocale>("it");
  const [mode, setMode] = useState<AuthMode>("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");

  const [forgotEmail, setForgotEmail] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  const [verificationEmail, setVerificationEmail] = useState("");
  const [verificationToken, setVerificationToken] = useState("");

  const [status, setStatus] = useState<string>("");
  const [statusTone, setStatusTone] = useState<StatusTone>("neutral");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const requestedFromQuery = searchParams.get("locale");
    const requestedFromCookie = parseLocaleCookie(document.cookie);

    setUiLocale(
      resolveLocale({
        requested: requestedFromQuery ?? requestedFromCookie ?? window.navigator.language.toLowerCase(),
        tenantDefault: "it"
      })
    );

    const modeFromQuery = searchParams.get("mode");
    if (modeFromQuery && AUTH_MODES.includes(modeFromQuery as AuthMode)) {
      setMode(modeFromQuery as AuthMode);
    }

    const tokenFromQuery = searchParams.get("token");
    if (tokenFromQuery) {
      setResetToken(tokenFromQuery);
    }

    const emailFromQuery = searchParams.get("email");
    if (emailFromQuery) {
      setEmail(emailFromQuery);
      setForgotEmail(emailFromQuery);
      setVerificationEmail(emailFromQuery);
    }
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
    if (mode === "login") {
      return email.trim().length > 0 && password.length > 0;
    }
    if (mode === "register") {
      return email.trim().length > 0 && password.length > 0 && businessName.trim().length > 0;
    }
    if (mode === "forgot") {
      return forgotEmail.trim().length > 0;
    }
    if (mode === "reset") {
      return resetToken.trim().length > 0 && resetPassword.length > 0;
    }
    return verificationToken.trim().length > 0 || verificationEmail.trim().length > 0;
  }, [businessName, email, forgotEmail, mode, password, resetPassword, resetToken, verificationEmail, verificationToken]);

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

  async function loadProfileAndRedirect() {
    const meResponse = await fetch("/api/auth/me", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin"
    });
    const mePayload = await meResponse.json().catch(() => null);

    if (!meResponse.ok) {
      setErrorStatus(t("auth.profileLoadFailed", { locale: uiLocale }));
      return;
    }

    setSession(mePayload?.data as SessionInfo);
    setSuccessStatus(t("auth.authenticated", { locale: uiLocale }));
    window.location.href = "/admin";
  }

  async function submit() {
    if (!canSubmit || submitting) {
      return;
    }

    setSubmitting(true);
    setNeutralStatus(t("auth.submitting", { locale: uiLocale }));

    try {
      if (mode === "login") {
        const { response, payload } = await postJson("/api/auth/login", { email, password });
        if (!response.ok) {
          setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
          return;
        }
        await loadProfileAndRedirect();
        return;
      }

      if (mode === "register") {
        const { response, payload } = await postJson("/api/auth/register", {
          email,
          password,
          businessName,
          slug: slug || undefined
        });
        if (!response.ok) {
          setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
          return;
        }
        await loadProfileAndRedirect();
        return;
      }

      if (mode === "forgot") {
        const { response, payload } = await postJson("/api/auth/forgot-password", {
          email: forgotEmail.trim()
        });
        if (!response.ok) {
          setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
          return;
        }
        setSuccessStatus("Password reset instructions were sent if the email exists.");
        return;
      }

      if (mode === "reset") {
        const { response, payload } = await postJson("/api/auth/reset-password", {
          token: resetToken.trim(),
          password: resetPassword
        });
        if (!response.ok) {
          setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
          return;
        }
        setSuccessStatus("Password updated. You can now log in.");
        setMode("login");
        return;
      }

      const { response, payload } = await postJson("/api/auth/verify-email", {
        token: verificationToken.trim()
      });
      if (!response.ok) {
        setErrorStatus(payload?.error?.message ?? t("common.errors.generic", { locale: uiLocale }));
        return;
      }
      setSuccessStatus(t("auth.emailVerified", { locale: uiLocale }));
    } catch {
      setErrorStatus(t("common.errors.generic", { locale: uiLocale }));
    } finally {
      setSubmitting(false);
    }
  }

  async function requestEmailVerification() {
    if (!verificationEmail.trim() || submitting) {
      return;
    }

    setSubmitting(true);
    setNeutralStatus(t("auth.submitting", { locale: uiLocale }));

    try {
      const { response, payload } = await postJson("/api/auth/request-email-verification", {
        email: verificationEmail.trim()
      });
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
    } catch {
      setErrorStatus(t("common.errors.generic", { locale: uiLocale }));
    } finally {
      setSubmitting(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    setSuccessStatus(t("auth.loggedOut", { locale: uiLocale }));
  }

  if (checkingSession) {
    return (
      <main className="gc-auth-page">
        <p className="gc-status-text gc-mt-0">Checking session...</p>
      </main>
    );
  }

  return (
    <main className={`gc-auth-page${modernUiEnabled ? " gc-auth-page-v2" : ""}`}>
      <h1 className="gc-auth-title">{t("auth.title", { locale: uiLocale })}</h1>
      {modernUiEnabled ? (
        <p className="gc-auth-subtitle gc-v2-fade-up">
          Secure authentication gateway for tenant onboarding and operator access.
        </p>
      ) : null}

      <section className={modernUiEnabled ? "gc-auth-layout" : ""}>
        {modernUiEnabled ? (
          <aside className="gc-card gc-auth-intro-card gc-v2-fade-up">
            <h2 className="gc-auth-intro-title">Auth workflow</h2>
            <p className="gc-auth-intro-text">
              One place for sign-in, tenant onboarding, password recovery, and email verification.
            </p>
            <ul className="gc-auth-points">
              <li>Session-safe auth through BFF routes</li>
              <li>Forgot/reset password fully connected to backend</li>
              <li>Email verification request + token confirmation</li>
            </ul>
            <div className="gc-auth-intro-metrics">
              <div>
                <strong>IT/EN</strong>
                <span>locale-aware copy</span>
              </div>
              <div>
                <strong>CSRF/session</strong>
                <span>same security model</span>
              </div>
            </div>
          </aside>
        ) : null}

        <div className={`gc-auth-main${modernUiEnabled ? " gc-v2-fade-up gc-v2-fade-up-delay-1" : ""}`}>
          <div className={`gc-auth-toolbar${modernUiEnabled ? " gc-auth-toolbar-v2 gc-auth-toolbar-grid" : ""}`}>
            {AUTH_MODES.map((authMode) => (
              <button
                key={authMode}
                className="gc-pill-btn"
                onClick={() => setMode(authMode)}
                disabled={mode === authMode || submitting}
              >
                {modeLabel(authMode)}
              </button>
            ))}
            <button className="gc-pill-btn" onClick={logout} disabled={submitting}>
              {t("auth.logout", { locale: uiLocale })}
            </button>
          </div>

          <div className="gc-card gc-form-card">
            {(mode === "login" || mode === "register") ? (
              <>
                <label className="gc-form-label">
                  {t("auth.email", { locale: uiLocale })}
                  <input className="gc-form-input" value={email} onChange={(e) => setEmail(e.target.value)} />
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
              </>
            ) : null}

            {mode === "forgot" ? (
              <>
                <label className="gc-form-label">
                  {t("auth.email", { locale: uiLocale })}
                  <input
                    className="gc-form-input"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                </label>
                <p className="gc-auth-hint">We will send a reset link if this account exists.</p>
              </>
            ) : null}

            {mode === "reset" ? (
              <>
                <label className="gc-form-label">
                  Reset token
                  <input
                    className="gc-form-input"
                    value={resetToken}
                    onChange={(e) => setResetToken(e.target.value)}
                  />
                </label>
                <label className="gc-form-label">
                  New password
                  <input
                    className="gc-form-input"
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                  />
                </label>
              </>
            ) : null}

            {mode === "verify" ? (
              <>
                <label className="gc-form-label">
                  {t("auth.email", { locale: uiLocale })}
                  <input
                    className="gc-form-input"
                    value={verificationEmail}
                    onChange={(e) => setVerificationEmail(e.target.value)}
                  />
                </label>
                <button
                  className="gc-primary-btn"
                  onClick={requestEmailVerification}
                  disabled={!verificationEmail.trim() || submitting}
                >
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
              </>
            ) : null}

            {mode !== "verify" ? (
              <button className="gc-primary-btn" disabled={!canSubmit || submitting} onClick={submit}>
                {submitting ? "Submitting..." : modeLabel(mode)}
              </button>
            ) : (
              <button
                className="gc-primary-btn"
                disabled={!verificationToken.trim() || submitting}
                onClick={submit}
              >
                {submitting ? "Submitting..." : t("auth.verifyEmail", { locale: uiLocale })}
              </button>
            )}
          </div>

          <p className={`gc-status-text gc-status-${statusTone}`} role="status" aria-live="polite">
            {status}
          </p>
          {session ? <pre className="gc-debug-box">{JSON.stringify(session, null, 2)}</pre> : null}
        </div>
      </section>
    </main>
  );
}
