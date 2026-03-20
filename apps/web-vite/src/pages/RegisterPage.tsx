import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { register } from "../shared/api/authApi";
import { formatApiError } from "../shared/api/formatApiError";
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
              setError(formatApiError(apiError, t("auth.registerFailed")));
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
