import { useState } from "react";
import { api, setToken } from "../services/api";
import type { AuthUser } from "../types";

interface LoginFormProps {
  onLogin: (user: AuthUser) => void;
}

export default function LoginForm({ onLogin }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const { token, roles } = await api.login(email, password);
      setToken(token);
      onLogin({ email, roles });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor="login-email">Email</label>
        <input
          id="login-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <button type="submit" className="btn-primary">
        Log in
      </button>
    </form>
  );
}
