import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useI18n } from "../shared/i18n/I18nProvider";
import { MarketingFooter } from "./MarketingFooter";

export function MainLayout() {
  const { locale, setLocale, t } = useI18n();
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMobileMenu = () => setMobileNavOpen(false);

  return (
    <div className="site-shell">
      <header className={`site-header ${isScrolled ? "is-scrolled" : ""}`}>
        <Link className="brand" to="/">
          <span className="brand-dot" />
          {t("app.brand")}
        </Link>
        <button
          type="button"
          className="mobile-menu-toggle"
          onClick={() => setMobileNavOpen((value) => !value)}
          aria-expanded={mobileNavOpen}
          aria-label={mobileNavOpen ? t("nav.close") : t("nav.menu")}
        >
          {mobileNavOpen ? "×" : "☰"}
        </button>
        <nav className="site-nav" data-open={mobileNavOpen}>
          <NavLink to="/" onClick={closeMobileMenu}>
            {t("nav.product")}
          </NavLink>
          <NavLink to="/book" onClick={closeMobileMenu}>
            {t("nav.booking")}
          </NavLink>
          <NavLink to="/pricing" onClick={closeMobileMenu}>
            {t("nav.pricing")}
          </NavLink>
          <NavLink to="/faq" onClick={closeMobileMenu}>
            {t("nav.faq")}
          </NavLink>
        </nav>
        <div className="site-header-actions" data-open={mobileNavOpen}>
          <div className="lang-switch">
            <button type="button" onClick={() => setLocale("en")} data-active={locale === "en"}>
              EN
            </button>
            <button type="button" onClick={() => setLocale("it")} data-active={locale === "it"}>
              IT
            </button>
          </div>
          <Link className="btn btn-ghost" to="/login" onClick={closeMobileMenu}>
            {t("nav.login")}
          </Link>
          <Link className="btn btn-primary" to="/register" onClick={closeMobileMenu}>
            {t("nav.register")}
          </Link>
        </div>
      </header>
      <Outlet />
      <MarketingFooter />
    </div>
  );
}
