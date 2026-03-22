import { Link } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";

export function MarketingFooter() {
  const { t } = useI18n();

  return (
    <footer className="section site-footer">
      <p>
        © {new Date().getFullYear()} {t("app.brand")}
      </p>
      <div>
        <Link to="/pricing">{t("nav.pricing")}</Link>
        <Link to="/faq">{t("nav.faq")}</Link>
        <Link to="/contact">{t("nav.contact")}</Link>
        <Link to="/book">{t("nav.booking")}</Link>
      </div>
    </footer>
  );
}
