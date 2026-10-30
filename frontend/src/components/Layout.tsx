import { NavLink, Outlet } from 'react-router';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useEngineStatus, useSyncCounts } from '../sync';
import { Logo } from './Logo';
import { SyncIndicator } from './SyncIndicator';
import { ClipboardIcon, CloudOffIcon, LogOutIcon, MapPinIcon } from './icons';
import { DebugPanel } from './DebugPanel';
import { UpdatePrompt } from './UpdatePrompt';

const navItems = [
  { to: '/', label: 'Sites', icon: MapPinIcon, end: true },
  { to: '/inspections', label: 'Inspections', icon: ClipboardIcon, end: false },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${
    isActive ? 'bg-surface-2 text-primary' : 'text-muted hover:text-ink'
  }`;
}

export function OfflineBanner() {
  const { online } = useEngineStatus();
  const { pending } = useSyncCounts();
  if (online) return null;
  return (
    <div
      className="flex items-center justify-center gap-2 bg-banner px-4 py-2 text-center text-sm font-medium text-on-banner"
      data-testid="offline-banner"
    >
      <CloudOffIcon size={16} />
      <span>
        You’re offline. Changes are saved on this device
        {pending ? ` (${pending} waiting to sync)` : ''} and will sync when you reconnect.
      </span>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { pending } = useSyncCounts();
  const [confirming, setConfirming] = useState(false);
  if (!user) return null;

  const onSignOut = () => {
    if (pending > 0 && !confirming) {
      setConfirming(true);
      return;
    }
    void logout();
  };

  return (
    <div className="relative flex items-center gap-2">
      <div className="hidden text-right leading-tight sm:block">
        <div className="text-sm font-semibold">{user.name}</div>
        <div className="text-xs capitalize text-muted">{user.role}</div>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOutIcon size={18} />
      </button>
      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="signout-title"
          className="card absolute top-11 right-0 z-30 w-72 p-4 shadow-lg"
        >
          <p id="signout-title" className="text-sm font-semibold">
            {pending} unsynced {pending === 1 ? 'change' : 'changes'} will be lost
          </p>
          <p className="mt-1 text-sm text-muted">
            Signing out clears this device. Reconnect and sync first to keep them.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn-danger" onClick={() => void logout()}>
              Sign out anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Logo />
          <nav aria-label="Main" className="ml-4 hidden gap-1 md:flex">
            {navItems.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={navClass}>
                <n.icon size={18} />
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <SyncIndicator />
            <UserMenu />
          </div>
        </div>
        <OfflineBanner />
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-5 pb-24 md:pb-10">
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-2 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {navItems.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                isActive ? 'text-primary' : 'text-muted'
              }`
            }
          >
            <n.icon size={20} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <DebugPanel />
      <UpdatePrompt />
    </div>
  );
}
