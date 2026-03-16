import { useState } from "react";
import { useI18n } from "../shared/i18n/I18nProvider";
import { forgotPassword } from "../shared/api/authApi";

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  return (
    <section className="section auth-shell">
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const email = String(formData.get("email") ?? "");
          setPending(true);
          setMessage(null);
          setIsError(false);
          forgotPassword({ email })
            .then(() => {
              setMessage(t("auth.forgot.success"));
              setIsError(false);
            })
            .catch(() => {
              setMessage(t("auth.forgot.failed"));
              setIsError(true);
            })
            .finally(() => setPending(false));
        }}
      >
        <h1>{t("auth.forgotTitle")}</h1>
        <label>
          {t("auth.email")}
          <input name="email" type="email" required placeholder={t("auth.placeholder.email")} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? t("auth.forgot.sending") : t("auth.forgot.send")}
        </button>
        {message ? <p className={isError ? "status-error" : "status-success"}>{message}</p> : null}
      </form>
    </section>
  );
}
