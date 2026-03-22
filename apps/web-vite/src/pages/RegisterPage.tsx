import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { register } from "../shared/api/authApi";
import { formatApiError } from "../shared/api/formatApiError";
import { ApiHttpError } from "../shared/api/http";
import { useI18n } from "../shared/i18n/I18nProvider";
import { saveSession } from "../shared/auth/session";
import { buildTenantAppUrl } from "../shared/routing/tenant-host";

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const privacyPolicyVersion = "v1";

  return (
    <section className="section auth-shell">
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const businessName = String(formData.get("businessName") ?? "");
          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");
          const privacyAccepted = formData.get("privacyAccepted") === "on";
          setPending(true);
          setMessage(null);
          setNotice(null);
          setError(null);

          register({ businessName, email, password, privacyAccepted, privacyVersion: privacyPolicyVersion })
            .then((data) => {
              saveSession(data);
              setMessage(t("auth.registerSuccess"));
              setNotice(data.whatsappSetupNotice);
              const targetUrl = typeof data.slug === "string" ? buildTenantAppUrl(data.slug) : "/app";
              setTimeout(() => {
                if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
                  window.location.assign(targetUrl);
                  return;
                }
                navigate(targetUrl);
              }, 150);
            })
            .catch((apiError) => {
              setError(formatRegisterError(apiError, t));
            })
            .finally(() => setPending(false));
        }}
      >
        <h1>{t("auth.registerTitle")}</h1>
        <label>
          {t("auth.business")}
          <input name="businessName" type="text" required placeholder={t("auth.placeholder.business")} />
        </label>
        <label>
          {t("auth.email")}
          <input name="email" type="email" required placeholder={t("auth.placeholder.emailBusiness")} />
        </label>
        <label>
          {t("auth.password")}
          <input name="password" type="password" required minLength={6} placeholder={t("auth.placeholder.password")} />
        </label>
        <label>
          <input name="privacyAccepted" type="checkbox" required />
          {" "}
          {t("auth.privacyConsent")}
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? t("auth.loading") : t("auth.submitRegister")}
        </button>
        {message ? <p>{message}</p> : null}
        {notice ? <p className="status-muted">{notice}</p> : null}
        {error ? <p className="status-error">{error}</p> : null}
      </form>
    </section>
  );
}

function formatRegisterError(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiHttpError) {
    const reason = extractApiReason(error.details);
    if (
      reason === "Password must contain at least one special character" ||
      reason === "password_special_character_required"
    ) {
      return withRequestId(t("auth.register.passwordSpecialRequired"), error.requestId);
    }
    if (reason === "Password must be at least 6 characters long") {
      return withRequestId(t("auth.register.passwordMinLength"), error.requestId);
    }
    if (reason === "email_already_exists") {
      return withRequestId(t("auth.register.emailExists"), error.requestId);
    }
    if (reason === "privacy_consent_required") {
      return withRequestId(t("auth.register.privacyRequired"), error.requestId);
    }
    if (reason === "invalid_turnstile_token") {
      return withRequestId(t("auth.register.turnstileInvalid"), error.requestId);
    }
  }
  return formatApiError(error, t("auth.registerFailed"));
}

function extractApiReason(details: unknown) {
  if (!details || typeof details !== "object") {
    return null;
  }
  const source = details as Record<string, unknown>;
  return typeof source.reason === "string" ? source.reason : null;
}

function withRequestId(message: string, requestId: string | null) {
  return requestId ? `${message} (requestId: ${requestId})` : message;
}
