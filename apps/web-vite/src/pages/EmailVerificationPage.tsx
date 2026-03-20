import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";
import { requestEmailVerification, verifyEmail } from "../shared/api/authApi";

export function EmailVerificationPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const [pendingRequest, setPendingRequest] = useState(false);
  const [pendingVerify, setPendingVerify] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const tokenFromUrl = searchParams.get("token") ?? "";
  const emailFromUrl = searchParams.get("email") ?? "";

  return (
    <section className="section auth-shell">
      <div className="auth-card">
        <h1>{t("auth.verificationTitle")}</h1>

        <form
          className="auth-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const email = String(formData.get("email") ?? "");
            setPendingRequest(true);
            setMessage(null);
            setIsError(false);
            requestEmailVerification({ email })
              .then(() => {
                setMessage(t("auth.verify.requestSuccess"));
                setIsError(false);
              })
              .catch(() => {
                setMessage(t("auth.verify.requestFailed"));
                setIsError(true);
              })
              .finally(() => setPendingRequest(false));
          }}
        >
          <label>
            {t("auth.email")}
            <input name="email" type="email" required defaultValue={emailFromUrl} placeholder={t("auth.placeholder.email")} />
          </label>
          <button className="btn btn-ghost" type="submit" disabled={pendingRequest}>
            {pendingRequest ? t("auth.verify.requestPending") : t("auth.verify.request")}
          </button>
        </form>

        <form
          className="auth-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const token = String(formData.get("token") ?? "");
            setPendingVerify(true);
            setMessage(null);
            setIsError(false);
            verifyEmail({ token })
              .then(() => {
                setMessage(t("auth.verify.success"));
                setIsError(false);
              })
              .catch(() => {
                setMessage(t("auth.verify.failed"));
                setIsError(true);
              })
              .finally(() => setPendingVerify(false));
          }}
        >
          <label>
            {t("auth.token")}
            <input name="token" type="text" required defaultValue={tokenFromUrl} placeholder={t("auth.placeholder.token")} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={pendingVerify}>
            {pendingVerify ? t("auth.verify.pending") : t("auth.verify.verify")}
          </button>
        </form>

        {message ? <p className={isError ? "status-error" : "status-success"}>{message}</p> : null}
      </div>
    </section>
  );
}
