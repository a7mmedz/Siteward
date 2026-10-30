import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useInspections, useSitesById, type InspectionFilter } from '../data/hooks';
import { InspectionList } from '../components/InspectionList';
import { ClipboardIcon } from '../components/icons';
import { EmptyState, ListSkeleton, PageHeader } from '../components/ui';
import { useSyncCounts } from '../sync';

const tabs = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'attention', label: 'Needs attention' },
] as const;

type TabKey = (typeof tabs)[number]['key'];

export function InspectionsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('sync') === 'attention' ? 'attention' : params.get('status');
  const tab: TabKey = tabs.some((t) => t.key === raw) ? (raw as TabKey) : 'all';
  const filter: InspectionFilter =
    tab === 'attention' ? { attention: true } : tab === 'all' ? {} : { status: tab };
  const inspections = useInspections(filter);
  const sites = useSitesById();
  const { conflicts, errors } = useSyncCounts();

  const select = (key: TabKey) =>
    setParams(key === 'all' ? {} : key === 'attention' ? { sync: 'attention' } : { status: key }, {
      replace: true,
    });

  return (
    <section>
      <PageHeader
        title="Inspections"
        subtitle={
          user?.role === 'supervisor' ? 'All inspectors’ inspections.' : 'Your inspections.'
        }
      />
      <div
        role="tablist"
        aria-label="Filter by status"
        className="mb-4 flex gap-1 overflow-x-auto rounded-md border border-line bg-surface p-1"
      >
        {tabs.map((t) => {
          const badge = t.key === 'attention' ? conflicts + errors : 0;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => select(t.key)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-sm px-3 text-sm font-semibold ${
                tab === t.key ? 'bg-primary text-on-primary' : 'text-muted hover:text-ink'
              }`}
            >
              {t.label}
              {badge > 0 && (
                <span className="rounded-sm bg-bad px-1.5 text-xs text-white">{badge}</span>
              )}
            </button>
          );
        })}
      </div>
      {!inspections ? (
        <ListSkeleton label="Loading inspections" />
      ) : inspections.length === 0 ? (
        <EmptyState
          icon={<ClipboardIcon size={32} />}
          title={tab === 'attention' ? 'Nothing needs attention' : 'No inspections here'}
        >
          {tab === 'attention' ? (
            'Conflicts and rejected changes show up here.'
          ) : (
            <>
              Pick a site on the{' '}
              <Link to="/" className="font-semibold text-primary underline">
                Sites
              </Link>{' '}
              tab to start an inspection.
            </>
          )}
        </EmptyState>
      ) : (
        <InspectionList inspections={inspections} sites={sites} />
      )}
    </section>
  );
}
