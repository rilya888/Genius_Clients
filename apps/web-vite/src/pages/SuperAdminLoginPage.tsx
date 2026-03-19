import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminRequest } from "../shared/api/superAdminApi";

export function SuperAdminLoginPage() {
  const navigate = useNavigate();
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="section auth-shell">
      <form
        className="auth-card"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);

          superAdminRequest<{ ok: boolean }>("/api/v1/super-admin/auth/login", {
            method: "POST",
            body: JSON.stringify({ secret })
          })
            .then((result) => {
              if (!result.ok) {
                setError(result.error?.message ?? "Super admin login failed");
                return;
              }
              navigate("/super-admin", { replace: true });
            })
            .catch((requestError) => {
              setError(requestError instanceof Error ? requestError.message : "Super admin login failed");
            })
            .finally(() => setPending(false));
        }}
      >
        <h1>Super Admin Login</h1>
        <label>
          Secret
          <input
            name="secret"
            type="password"
            required
            placeholder="SUPER_ADMIN_LOGIN_SECRET"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
          />
        </label>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </button>
        {error ? <p className="status-error">{error}</p> : null}
      </form>
    </section>
  );
}
