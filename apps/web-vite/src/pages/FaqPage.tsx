import { useI18n } from "../shared/i18n/I18nProvider";
import { useRevealOnScroll } from "../shared/hooks/useRevealOnScroll";

export function FaqPage() {
  const { t } = useI18n();
  const shellRef = useRevealOnScroll<HTMLElement>();

  const items = [
    { q: t("faq.item1.q"), a: t("faq.item1.a") },
    { q: t("faq.item2.q"), a: t("faq.item2.a") },
    { q: t("faq.item3.q"), a: t("faq.item3.a") }
  ];

  return (
    <section ref={shellRef} className="section page-shell reveal-on-scroll">
      <h1>{t("faq.pageTitle")}</h1>
      <div className="faq-list">
        {items.map((item) => (
          <details key={item.q} className="faq-item card-hover" open={items[0]?.q === item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
