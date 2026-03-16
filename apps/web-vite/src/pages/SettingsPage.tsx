import { Link } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";

export function SettingsPage() {
  const { t } = useI18n();

  return (
    <section className="page-shell">
      <h1>{t("settings.title")}</h1>
      <div className="settings-grid">
        <article className="settings-card card-hover">
          <h3>{t("settings.faq.title")}</h3>
          <p>{t("settings.faq.description")}</p>
          <Link className="btn btn-primary" to="/app/settings/faq">
            {t("settings.faq.cta")}
          </Link>
        </article>
        <article className="settings-card card-hover">
          <h3>{t("settings.privacy.title")}</h3>
          <p>{t("settings.privacy.description")}</p>
          <Link className="btn btn-ghost" to="/app/settings/privacy">
            {t("settings.privacy.cta")}
          </Link>
        </article>
        <article className="settings-card card-hover">
          <h3>{t("settings.notifications.title")}</h3>
          <p>{t("settings.notifications.description")}</p>
          <Link className="btn btn-primary" to="/app/settings/notifications">
            {t("settings.notifications.cta")}
          </Link>
        </article>
      </div>
    </section>
  );
}
