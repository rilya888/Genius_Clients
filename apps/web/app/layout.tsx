import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Genius Clients",
  description: "Multi-tenant booking platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
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
        </header>
        {children}
      </body>
    </html>
  );
}
