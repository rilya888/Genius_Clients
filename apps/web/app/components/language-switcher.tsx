"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type SupportedLocale } from "@genius/i18n";
import { setUiLocaleCookie } from "../../lib/ui-locale";

type Props = {
  locale: SupportedLocale;
};

export function LanguageSwitcher({ locale }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocale = (() => {
    const queryLocale = searchParams.get("locale");
    if (queryLocale === "it" || queryLocale === "en") {
      return queryLocale;
    }
    return locale;
  })();

  function applyLocale(nextLocale: SupportedLocale) {
    if (nextLocale === currentLocale) {
      return;
    }

    setUiLocaleCookie(nextLocale);

    const params = new URLSearchParams(searchParams.toString());
    params.set("locale", nextLocale);
    const suffix = params.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  }

  return (
    <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
      <button
        type="button"
        onClick={() => applyLocale("it")}
        disabled={currentLocale === "it"}
        style={{
          border: "1px solid #d1d5db",
          background: currentLocale === "it" ? "#e5e7eb" : "#ffffff",
          color: "#111827",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          padding: "4px 8px",
          cursor: currentLocale === "it" ? "default" : "pointer"
        }}
      >
        IT
      </button>
      <button
        type="button"
        onClick={() => applyLocale("en")}
        disabled={currentLocale === "en"}
        style={{
          border: "1px solid #d1d5db",
          background: currentLocale === "en" ? "#e5e7eb" : "#ffffff",
          color: "#111827",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          padding: "4px 8px",
          cursor: currentLocale === "en" ? "default" : "pointer"
        }}
      >
        EN
      </button>
    </div>
  );
}
