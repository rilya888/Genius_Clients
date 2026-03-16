import { Link } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <section className="section page-shell">
      <h1>{t("notFound.title")}</h1>
      <p>{t("notFound.subtitle")}</p>
      <Link className="btn btn-primary" to="/">
        {t("notFound.cta")}
      </Link>
    </section>
  );
}
