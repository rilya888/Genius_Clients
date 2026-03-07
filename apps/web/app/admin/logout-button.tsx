"use client";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth";
  }

  return (
    <button className="gc-pill-btn" onClick={logout}>
      Logout
    </button>
  );
}
