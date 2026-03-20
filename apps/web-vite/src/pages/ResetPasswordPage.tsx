import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";
import { resetPassword } from "../shared/api/authApi";

export function ResetPasswordPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const tokenFromUrl = searchParams.get("token") ?? "";

  return (
    <section className="section auth-shell">
      <form
        className="auth-card"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const token = String(formData.get("token") ?? "");
          const password = String(formData.get("password") ?? "");
          setPending(true);
          setMessage(null);
          setIsError(false);
          resetPassword({ token, password })
            .then(() => {
              setMessage(t("auth.reset.success"));
              setIsError(false);
            })
            .catch(() => {
              setMessage(t("auth.reset.failed"));
              setIsError(true);
            })
            .finally(() => setPending(false));
        }}
      >
        <h1>{t("auth.resetTitle")}</h1>
        <label>
          {t("auth.reset.token")}
          <input name="token" type="text" required defaultValue={tokenFromUrl} placeholder={t("auth.placeholder.token")} />
        </label>
        <label>
          {t("auth.reset.newPassword")}
          <input name="password" type="password" required minLength={6} placeholder={t("auth.placeholder.password")} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? t("auth.reset.pending") : t("auth.reset.action")}
        </button>
        {message ? <p className={isError ? "status-error" : "status-success"}>{message}</p> : null}
      </form>
    </section>
  );
}
