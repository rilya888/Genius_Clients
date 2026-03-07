"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { t } from "@genius/i18n";

export default function BookingSuccessPage() {
  const searchParams = useSearchParams();
  const localeParam = searchParams.get("locale");
  const locale = localeParam === "en" ? "en" : "it";
  const bookingId = searchParams.get("bookingId");

  return (
    <main className="gc-system-page">
      <section className="gc-card gc-system-card">
        <h1 className="gc-system-title">{t("public.booking.successTitle", { locale })}</h1>
        <p className="gc-system-text">{t("public.booking.successText", { locale })}</p>
        {bookingId ? (
          <p className="gc-system-text">
            {t("public.booking.created", { locale, params: { bookingId } })}
          </p>
        ) : null}
        <div className="gc-home-actions">
          <Link href="/public/book" className="gc-btn gc-btn-primary">
            {t("public.booking.bookAnother", { locale })}
          </Link>
          <Link href="/" className="gc-btn gc-btn-secondary">
            {t("public.booking.backHome", { locale })}
          </Link>
        </div>
      </section>
    </main>
  );
}
