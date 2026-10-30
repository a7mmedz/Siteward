import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../db/db';
import { ApiError } from '../lib/api';
import { loginSchema } from '../data/validation';
import { Logo } from '../components/Logo';
import { AlertIcon } from '../components/icons';
import { OfflineBanner } from '../components/Layout';

type Errors = { email?: string; password?: string; form?: string };

export function LoginPage() {
  const { status, sessionExpired, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const reauth = params.get('reauth') === '1' || sessionExpired;

  const cachedUser = useLiveQuery(() => db.getMeta('user'), []);
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [discardConfirmed, setDiscardConfirmed] = useState(false);

  useEffect(() => {
    if (cachedUser && !email) setEmail(cachedUser.email);
    // Only prefill once when the cached user loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedUser]);

  if (status === 'signed-in' && !reauth) return <Navigate to="/" replace />;

  const switchingUser =
    !!cachedUser && pending > 0 && email.trim().toLowerCase() !== cachedUser.email;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as 'email' | 'password';
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    if (switchingUser && !discardConfirmed) {
      setErrors({ form: 'confirm-discard' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await login(parsed.data.email, parsed.data.password);
      navigate('/', { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.kind === 'network'
            ? 'Signing in needs a connection. Connect to the internet and try again.'
            : err.body.message
          : 'Something went wrong. Try again.';
      setErrors({ form: message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <OfflineBanner />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Logo className="mb-6" />
          <h1 className="text-2xl font-bold tracking-tight">
            {reauth ? 'Sign in again to sync' : 'Sign in'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {reauth
              ? 'Your session expired. Your unsynced work is safe on this device.'
              : 'Field inspections that work without signal.'}
          </p>

          <form onSubmit={onSubmit} noValidate className="card mt-6 space-y-4 p-5">
            {errors.form && errors.form !== 'confirm-discard' && (
              <div
                role="alert"
                className="flex gap-2 rounded-md border border-bad/40 bg-bad-tint p-3 text-sm text-bad-ink"
              >
                <AlertIcon size={18} className="mt-px shrink-0" />
                <span>{errors.form}</span>
              </div>
            )}
            <div>
              <label htmlFor="email" className="field-label">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                className="field-input"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setDiscardConfirmed(false);
                }}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <p id="email-error" className="field-error">
                  {errors.email}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="password" className="field-label">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors.password}
                aria-describedby={errors.password ? 'password-error' : undefined}
              />
              {errors.password && (
                <p id="password-error" className="field-error">
                  {errors.password}
                </p>
              )}
            </div>
            {switchingUser && (
              <div
                role={errors.form === 'confirm-discard' ? 'alert' : undefined}
                className="rounded-md border border-warn/50 bg-warn-tint p-3 text-sm text-warn-ink"
              >
                <p>
                  This device has {pending} unsynced {pending === 1 ? 'change' : 'changes'} from{' '}
                  <strong>{cachedUser.email}</strong>. Signing in as someone else discards them.
                </p>
                <label className="mt-2 flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={discardConfirmed}
                    onChange={(e) => setDiscardConfirmed(e.target.checked)}
                  />
                  Discard them and continue
                </label>
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="mt-4 text-xs text-muted">
            After your first sign-in, Siteward keeps working offline on this device.
          </p>
        </div>
      </main>
    </div>
  );
}
