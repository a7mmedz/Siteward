import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useEngineStatus } from '../sync';
import { useCreateInspection } from '../data/hooks';
import { ChevronRightIcon, MapPinIcon, PlusIcon } from '../components/icons';
import { EmptyState, ListSkeleton, PageHeader } from '../components/ui';

export function SitesPage() {
  const sites = useLiveQuery(() => db.sites.orderBy('name').toArray(), []);
  const counts = useLiveQuery(async () => {
    const map = new Map<string, { draft: number; submitted: number }>();
    await db.inspections.each((i) => {
      if (i.deletedAt) return;
      const c = map.get(i.siteId) ?? { draft: 0, submitted: 0 };
      c[i.status]++;
      map.set(i.siteId, c);
    });
    return map;
  }, []);
  const { phase } = useEngineStatus();
  const { create, busy, ready } = useCreateInspection();

  return (
    <section>
      <PageHeader title="Sites" subtitle="Pick a site to start or continue an inspection." />
      {!sites ? (
        <ListSkeleton label="Loading sites" />
      ) : sites.length === 0 ? (
        <EmptyState icon={<MapPinIcon size={32} />} title="No sites on this device yet">
          {phase === 'syncing'
            ? 'Downloading sites…'
            : 'Sites download on your first sync. Connect to the internet and tap Sync now.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2" aria-label="Sites">
          {sites.map((site) => {
            const c = counts?.get(site.id);
            return (
              <li key={site.id} className="card flex items-stretch overflow-hidden">
                <Link
                  to={`/sites/${site.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <MapPinIcon size={20} className="shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{site.name}</div>
                    <div className="truncate text-sm text-muted">{site.address}</div>
                    {c && (
                      <div className="mt-1 text-xs text-muted">
                        {c.draft} draft · {c.submitted} submitted
                      </div>
                    )}
                  </div>
                  <ChevronRightIcon size={18} className="shrink-0 text-muted" />
                </Link>
                <button
                  type="button"
                  className="flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-l border-line text-xs font-semibold text-primary hover:bg-surface-2 disabled:opacity-40"
                  onClick={() => void create(site)}
                  disabled={!ready || busy}
                  aria-label={`New inspection at ${site.name}`}
                >
                  <PlusIcon size={20} />
                  New
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
