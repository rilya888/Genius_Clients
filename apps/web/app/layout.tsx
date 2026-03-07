import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { resolveLocale } from "@genius/i18n";
import { LanguageSwitcher } from "./components/language-switcher";
import { parseLocaleCookie } from "../lib/ui-locale";

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
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#f6f7fb" }}>
        <header
          style={{
            borderBottom: "1px solid #e5e7eb",
            background: "#ffffff",
            padding: "12px 20px",
            display: "flex",
            gap: 12,
            alignItems: "center"
          }}
        >
          <a href="/" style={{ textDecoration: "none", color: "#111827", fontWeight: 700 }}>
            Genius Clients
          </a>
          <a href="/auth" style={{ textDecoration: "none", color: "#374151", fontSize: 14 }}>
            Auth
          </a>
          <a href="/admin" style={{ textDecoration: "none", color: "#374151", fontSize: 14 }}>
            Admin
          </a>
          <a href="/public/book" style={{ textDecoration: "none", color: "#374151", fontSize: 14 }}>
            Public Book
          </a>
          <LanguageSwitcher locale={locale} />
        </header>
        {children}
      </body>
    </html>
  );
}
