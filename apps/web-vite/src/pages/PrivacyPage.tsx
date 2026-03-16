import { useState } from "react";
import { anonymizeBookings } from "../shared/api/adminApi";
import { useScopeContext } from "../shared/hooks/useScopeContext";
import { useI18n } from "../shared/i18n/I18nProvider";

export function PrivacyPage() {
  const { t } = useI18n();
  const { role } = useScopeContext();
  const [phoneE164, setPhoneE164] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function submit() {
    if (role !== "owner") {
      setMessage(t("admin.privacy.ownerOnly"));
      setIsError(true);
      return;
    }
    if (!phoneE164) {
      setMessage(t("admin.privacy.phoneRequired"));
      setIsError(true);
      return;
    }
    setPending(true);
    setMessage(null);
    setIsError(false);
    try {
      const result = await anonymizeBookings({ phoneE164, beforeDate: beforeDate || undefined });
      setMessage(`${t("admin.privacy.successPrefix")}: ${result.affected}`);
      setIsError(false);
    } catch {
      setMessage(t("admin.privacy.failed"));
      setIsError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="page-shell">
      <h1>{t("admin.privacy.title")}</h1>
      <p>{t("admin.privacy.subtitle")}</p>
      <div className="settings-card">
        <label>
          {t("booking.phone")}
          <input value={phoneE164} onChange={(event) => setPhoneE164(event.target.value)} placeholder={t("booking.placeholder.phone")} />
        </label>
        <label>
          {t("admin.privacy.beforeDateOptional")}
          <input type="date" value={beforeDate} onChange={(event) => setBeforeDate(event.target.value)} />
        </label>
        <button className="btn btn-primary" type="button" disabled={pending} onClick={submit}>
          {pending ? t("booking.submitting") : t("admin.privacy.action")}
        </button>
        {role !== "owner" ? <p className="status-muted">{t("admin.privacy.readOnly")}</p> : null}
      </div>
      {message ? <p className={isError ? "status-error" : "status-success"}>{message}</p> : null}
    </section>
  );
}
