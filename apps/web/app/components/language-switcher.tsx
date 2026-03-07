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
    <div className="gc-language-switcher">
      <button
        type="button"
        onClick={() => applyLocale("it")}
        disabled={currentLocale === "it"}
        className="gc-lang-btn"
        aria-pressed={currentLocale === "it"}
      >
        IT
      </button>
      <button
        type="button"
        onClick={() => applyLocale("en")}
        disabled={currentLocale === "en"}
        className="gc-lang-btn"
        aria-pressed={currentLocale === "en"}
      >
        EN
      </button>
    </div>
  );
}
