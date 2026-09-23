import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api.ts';

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Wrong password. Check HELM_OWNER_PASSWORD in your .env.'
          : err instanceof ApiError
            ? err.message
            : 'Can’t reach the Helm server. Is it running?',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-form" onSubmit={submit}>
        <h1 className="wordmark wordmark-large">Helm</h1>
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy || !password}>
          Sign in
        </button>
      </form>
    </main>
  );
}
