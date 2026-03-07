export default function HomePage() {
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Control Panel Bootstrap</h1>
      <p style={{ color: "#4b5563" }}>
        Basic admin and auth screens are available to validate backend flows.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <a href="/auth">Go to Auth</a>
        <a href="/admin">Go to Admin</a>
        <a href="/public/book">Go to Public Booking</a>
      </div>
    </main>
  );
}
