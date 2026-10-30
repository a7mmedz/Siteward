import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { db } from '../db/db';
import { tokenStore } from '../lib/api';
import type { User } from '../lib/types';
import { api, engine } from '../sync';

type AuthContextValue = {
  /** `loading` only while reading the cached session from IndexedDB on boot. */
  status: 'loading' | 'signed-out' | 'signed-in';
  user: User | null;
  /** The server rejected the token (expired). Local data is kept; sign in again to sync. */
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Boot: a cached user + token means signed in, even with no network (AC3).
  useEffect(() => {
    let cancelled = false;
    void db.getMeta('user').then((cached) => {
      if (cancelled) return;
      if (cached && tokenStore.get()) {
        setUser(cached);
        setStatus('signed-in');
      } else {
        setStatus('signed-out');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status !== 'signed-in') return;
    const unsubscribe = engine.status.subscribe(() => {
      setSessionExpired(engine.status.get().phase === 'auth');
    });
    engine.start();
    return () => {
      unsubscribe();
      engine.stop();
    };
  }, [status]);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email, password);
      const cached = await db.getMeta('user');
      // Another person on this device: their local copy must not leak into this session.
      if (cached && cached.id !== result.user.id) await db.clearAll();
      tokenStore.set(result.token);
      await db.setMeta('user', result.user);
      setUser(result.user);
      setSessionExpired(false);
      if (status === 'signed-in') {
        // Re-login after expiry: the engine is already running, kick it.
        void engine.syncNow({ manual: true });
      }
      setStatus('signed-in');
    },
    [status],
  );

  const logout = useCallback(async () => {
    engine.stop();
    tokenStore.clear();
    await db.clearAll();
    setUser(null);
    setSessionExpired(false);
    setStatus('signed-out');
  }, []);

  const value = useMemo(
    () => ({ status, user, sessionExpired, login, logout }),
    [status, user, sessionExpired, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
