import { Link } from 'react-router';
import type { LocalInspection, Site } from '../lib/types';
import { useAuth } from '../auth/AuthProvider';
import { ChevronRightIcon } from './icons';
import { StatusBadge, SyncBadge, formatDate } from './ui';

function progress(i: LocalInspection) {
  const answered = i.items.filter((it) => it.result !== null).length;
  const failed = i.items.filter((it) => it.result === 'fail').length;
  return { answered, total: i.items.length, failed };
}

export function InspectionList({
  inspections,
  sites,
  showSite = true,
}: {
  inspections: LocalInspection[];
  sites?: Map<string, Site>;
  showSite?: boolean;
}) {
  const { user } = useAuth();
  return (
    <ul className="card divide-y divide-line overflow-hidden" aria-label="Inspections">
      {inspections.map((i) => {
        const p = progress(i);
        const href =
          i.syncState === 'conflict' ? `/inspections/${i.id}/conflict` : `/inspections/${i.id}`;
        return (
          <li key={i.id}>
            <Link
              to={href}
              className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2"
              data-testid="inspection-row"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-semibold">{i.title}</span>
                  <StatusBadge status={i.status} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  {showSite && sites?.get(i.siteId) && <span>{sites.get(i.siteId)!.name}</span>}
                  {user?.role === 'supervisor' && <span>{i.inspectorName}</span>}
                  <span>
                    {p.answered}/{p.total} checked
                    {p.failed > 0 && (
                      <span className="font-semibold text-bad-ink"> · {p.failed} failed</span>
                    )}
                  </span>
                  <span>{formatDate(i.updatedAt)}</span>
                </div>
              </div>
              <SyncBadge state={i.syncState} />
              <ChevronRightIcon size={18} className="shrink-0 text-muted" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
