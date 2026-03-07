import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { resolveLocale } from "@genius/i18n";
import { LanguageSwitcher } from "./components/language-switcher";
import { parseLocaleCookie } from "../lib/ui-locale";
import "./globals.css";

export const metadata: Metadata = {
  title: "Genius Clients",
  description: "Multi-tenant booking platform"
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const locale = resolveLocale({
    requested: parseLocaleCookie(cookieStore.toString()),
    fallback: "it"
  });

  return (
    <html lang={locale}>
      <body>
        <header className="gc-shell-header">
          <Link href="/" className="gc-brand-link">
            <span className="gc-brand-mark" aria-hidden />
            <span>Genius Clients</span>
          </Link>
          <nav className="gc-nav">
            <Link href="/auth" className="gc-nav-link">
              Auth
            </Link>
            <Link href="/admin" className="gc-nav-link">
              Admin
            </Link>
            <Link href="/public/book" className="gc-nav-link">
              Public Book
            </Link>
          </nav>
          <LanguageSwitcher locale={locale} />
        </header>
        {children}
      </body>
    </html>
  );
}
