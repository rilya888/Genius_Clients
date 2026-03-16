import { useEffect, useState } from "react";
import { getTenantSettings, updateTenantFaqContent } from "../shared/api/adminApi";
import { useI18n } from "../shared/i18n/I18nProvider";

type FaqState = {
  it: {
    priceInfo: string;
    addressInfo: string;
    parkingInfo: string;
    workingHoursInfo: string;
  };
  en: {
    priceInfo: string;
    addressInfo: string;
    parkingInfo: string;
    workingHoursInfo: string;
  };
};

const emptyFaqState: FaqState = {
  it: { priceInfo: "", addressInfo: "", parkingInfo: "", workingHoursInfo: "" },
  en: { priceInfo: "", addressInfo: "", parkingInfo: "", workingHoursInfo: "" }
};

export function FaqSettingsPage() {
  const { t } = useI18n();
  const [state, setState] = useState({ pending: true, error: null as string | null, data: emptyFaqState });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getTenantSettings()
      .then((settings) => {
        if (cancelled) {
          return;
        }
        setState({
          pending: false,
          error: null,
          data: {
            it: {
              priceInfo: settings.faqContent?.it?.priceInfo ?? "",
              addressInfo: settings.faqContent?.it?.addressInfo ?? "",
              parkingInfo: settings.faqContent?.it?.parkingInfo ?? "",
              workingHoursInfo: settings.faqContent?.it?.workingHoursInfo ?? ""
            },
            en: {
              priceInfo: settings.faqContent?.en?.priceInfo ?? "",
              addressInfo: settings.faqContent?.en?.addressInfo ?? "",
              parkingInfo: settings.faqContent?.en?.parkingInfo ?? "",
              workingHoursInfo: settings.faqContent?.en?.workingHoursInfo ?? ""
            }
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ pending: false, error: t("faqSettings.loadFailed"), data: emptyFaqState });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await updateTenantFaqContent(state.data);
      setMessage(t("faqSettings.saved"));
    } catch {
      setMessage(t("faqSettings.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page-shell">
      <h1>{t("faqSettings.title")}</h1>
      {state.pending ? <p>{t("faqSettings.loading")}</p> : null}
      {state.error ? <p className="status-error">{state.error}</p> : null}

      <div className="faq-settings-grid">
        <article className="settings-card card-hover">
          <h3>{t("faqSettings.localeIt")}</h3>
          <label>
            {t("faqSettings.priceInfo")}
            <textarea
              value={state.data.it.priceInfo}
              onChange={(event) =>
                setState((prev) => ({ ...prev, data: { ...prev.data, it: { ...prev.data.it, priceInfo: event.target.value } } }))
              }
            />
          </label>
          <label>
            {t("faqSettings.addressInfo")}
            <textarea
              value={state.data.it.addressInfo}
              onChange={(event) =>
                setState((prev) => ({ ...prev, data: { ...prev.data, it: { ...prev.data.it, addressInfo: event.target.value } } }))
              }
            />
          </label>
          <label>
            {t("faqSettings.parkingInfo")}
            <textarea
              value={state.data.it.parkingInfo}
              onChange={(event) =>
                setState((prev) => ({ ...prev, data: { ...prev.data, it: { ...prev.data.it, parkingInfo: event.target.value } } }))
              }
            />
          </label>
          <label>
            {t("faqSettings.workingHoursInfo")}
            <textarea
              value={state.data.it.workingHoursInfo}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  data: { ...prev.data, it: { ...prev.data.it, workingHoursInfo: event.target.value } }
                }))
              }
            />
          </label>
        </article>

        <article className="settings-card card-hover">
          <h3>{t("faqSettings.localeEn")}</h3>
          <label>
            {t("faqSettings.priceInfo")}
            <textarea
              value={state.data.en.priceInfo}
              onChange={(event) =>
                setState((prev) => ({ ...prev, data: { ...prev.data, en: { ...prev.data.en, priceInfo: event.target.value } } }))
              }
            />
          </label>
          <label>
            {t("faqSettings.addressInfo")}
            <textarea
              value={state.data.en.addressInfo}
              onChange={(event) =>
                setState((prev) => ({ ...prev, data: { ...prev.data, en: { ...prev.data.en, addressInfo: event.target.value } } }))
              }
            />
          </label>
          <label>
            {t("faqSettings.parkingInfo")}
            <textarea
              value={state.data.en.parkingInfo}
              onChange={(event) =>
                setState((prev) => ({ ...prev, data: { ...prev.data, en: { ...prev.data.en, parkingInfo: event.target.value } } }))
              }
            />
          </label>
          <label>
            {t("faqSettings.workingHoursInfo")}
            <textarea
              value={state.data.en.workingHoursInfo}
              onChange={(event) =>
                setState((prev) => ({
                  ...prev,
                  data: { ...prev.data, en: { ...prev.data.en, workingHoursInfo: event.target.value } }
                }))
              }
            />
          </label>
        </article>
      </div>

      <div className="inline-actions">
        <button className="btn btn-primary" type="button" disabled={saving} onClick={save}>
          {saving ? t("faqSettings.saving") : t("faqSettings.save")}
        </button>
      </div>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
