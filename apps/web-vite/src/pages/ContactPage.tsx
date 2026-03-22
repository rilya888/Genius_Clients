import { Link } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";
import { useRevealOnScroll } from "../shared/hooks/useRevealOnScroll";

export function ContactPage() {
  const { t } = useI18n();
  const shellRef = useRevealOnScroll<HTMLElement>();

  return (
    <section ref={shellRef} className="section page-shell reveal-on-scroll">
      <h1>{t("contact.title")}</h1>
      <p>{t("contact.subtitle")}</p>
      <div className="settings-grid" style={{ marginTop: "1rem" }}>
        <article className="settings-card card-hover">
          <h3>{t("contact.enterpriseTitle")}</h3>
          <p>{t("contact.enterpriseText")}</p>
          <p>
            <strong>Email:</strong> admin@geniusclients.info
          </p>
          <p>
            <strong>WhatsApp:</strong> +39 000 000 0000
          </p>
          <p>
            <strong>Telegram:</strong> @geniusclients_admin
          </p>
        </article>
        <article className="settings-card card-hover">
          <h3>{t("contact.nextStepsTitle")}</h3>
          <ol>
            <li>{t("contact.step1")}</li>
            <li>{t("contact.step2")}</li>
            <li>{t("contact.step3")}</li>
          </ol>
          <Link className="btn btn-primary" to="/register">
            {t("contact.backToStart")}
          </Link>
        </article>
      </div>
    </section>
  );
}

