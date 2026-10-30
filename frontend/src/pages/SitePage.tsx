import { Navigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useCreateInspection, useInspections } from '../data/hooks';
import { InspectionList } from '../components/InspectionList';
import { ClipboardIcon, PlusIcon } from '../components/icons';
import { EmptyState, ListSkeleton, PageHeader } from '../components/ui';

export function SitePage() {
  const { siteId = '' } = useParams();
  const site = useLiveQuery(() => db.sites.get(siteId).then((s) => s ?? null), [siteId]);
  const inspections = useInspections({ siteId });
  const { create, busy, ready } = useCreateInspection();

  if (site === null) return <Navigate to="/" replace />;

  return (
    <section>
      <PageHeader
        back={{ to: '/', label: 'Sites' }}
        title={site?.name ?? '…'}
        subtitle={site?.address}
        actions={
          site && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => void create(site)}
              disabled={!ready || busy}
            >
              <PlusIcon size={18} />
              New inspection
            </button>
          )
        }
      />
      {!ready && site && (
        <p className="mb-3 text-sm text-muted">
          The checklist downloads on your first sync. Connect once to create inspections.
        </p>
      )}
      {!inspections ? (
        <ListSkeleton label="Loading inspections" />
      ) : inspections.length === 0 ? (
        <EmptyState icon={<ClipboardIcon size={32} />} title="No inspections at this site yet">
          Start one with <strong>New inspection</strong>. It works without signal.
        </EmptyState>
      ) : (
        <InspectionList inspections={inspections} showSite={false} />
      )}
    </section>
  );
}
