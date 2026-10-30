import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { InspectionStatus, SyncState } from '../lib/types';
import { AlertIcon, CheckIcon, ChevronLeftIcon, RefreshIcon } from './icons';

const syncStyles: Record<SyncState, { label: string; className: string; dot: string }> = {
  synced: { label: 'Synced', className: 'text-ok-ink', dot: 'bg-ok' },
  pending: { label: 'Pending', className: 'text-warn-ink', dot: 'bg-warn' },
  conflict: { label: 'Conflict', className: 'text-bad-ink', dot: 'bg-bad' },
  error: { label: 'Not saved', className: 'text-bad-ink', dot: 'bg-bad' },
};

/** Per-record sync state: colour dot + text, never colour alone. */
export function SyncBadge({ state }: { state: SyncState }) {
  const s = syncStyles[state];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-semibold ${s.className}`}
      data-testid="sync-badge"
    >
      {state === 'synced' ? (
        <CheckIcon size={14} strokeWidth={2.5} />
      ) : state === 'pending' ? (
        <RefreshIcon size={13} />
      ) : (
        <AlertIcon size={14} />
      )}
      {s.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: InspectionStatus }) {
  return status === 'submitted' ? (
    <span className="inline-flex items-center rounded-sm bg-primary px-1.5 py-0.5 text-xs font-semibold text-on-primary">
      Submitted
    </span>
  ) : (
    <span className="inline-flex items-center rounded-sm border border-line px-1.5 py-0.5 text-xs font-semibold text-muted">
      Draft
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5">
      {back && (
        <Link
          to={back.to}
          className="-ml-1 mb-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary hover:underline"
        >
          <ChevronLeftIcon size={16} />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-balance">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="card flex flex-col items-center border-dashed px-6 py-10 text-center"
    >
      <div className="mb-3 text-muted">{icon}</div>
      <h2 className="font-semibold">{title}</h2>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card h-[72px] animate-pulse bg-surface-2" />
      ))}
    </div>
  );
}

export function Notice({
  tone,
  title,
  children,
  actions,
}: {
  tone: 'bad' | 'warn' | 'info';
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const styles = {
    bad: 'border-bad/50 bg-bad-tint text-bad-ink',
    warn: 'border-warn/50 bg-warn-tint text-warn-ink',
    info: 'border-line bg-surface-2 text-ink',
  }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-md border p-3 ${styles}`}>
      <div className="flex gap-2">
        <AlertIcon size={18} className="mt-px shrink-0" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">{title}</p>
          {children && <div className="mt-0.5">{children}</div>}
          {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}

export function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
