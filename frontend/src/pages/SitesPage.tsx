import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

export function SitesPage() {
  const sites = useLiveQuery(() => db.sites.orderBy('name').toArray(), []);
  return (
    <section>
      <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
      <ul className="mt-4 space-y-2">
        {sites?.map((s) => (
          <li key={s.id} className="card p-4">
            <div className="font-semibold">{s.name}</div>
            <div className="text-sm text-muted">{s.address}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
