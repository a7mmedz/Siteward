import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router';
import { useState } from 'react';
import { db } from '../db/db';
import { useAuth } from '../auth/AuthProvider';
import { repo } from '../sync';
import type { LocalInspection, Site } from '../lib/types';

export type InspectionFilter = {
  siteId?: string;
  status?: LocalInspection['status'];
  /** Only records needing the user's attention (conflict or rejected). */
  attention?: boolean;
};

/** Visible (not locally deleted) inspections, newest first. `undefined` while loading. */
export function useInspections({ siteId, status, attention }: InspectionFilter = {}) {
  return useLiveQuery(async () => {
    const all = await db.inspections.orderBy('updatedAt').reverse().toArray();
    return all.filter(
      (i) =>
        !i.deletedAt &&
        (!siteId || i.siteId === siteId) &&
        (!status || i.status === status) &&
        (!attention || i.syncState === 'conflict' || i.syncState === 'error'),
    );
  }, [siteId, status, attention]);
}

export function useSitesById() {
  return useLiveQuery(async () => {
    const sites = await db.sites.toArray();
    return new Map(sites.map((s) => [s.id, s]));
  }, []);
}

/** Creates an inspection from the cached template and opens it. Works offline. */
export function useCreateInspection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const template = useLiveQuery(() => db.getMeta('template'), []);
  const [busy, setBusy] = useState(false);

  async function create(site: Site) {
    if (!user || !template) return;
    setBusy(true);
    try {
      const record = await repo.createInspection(site, user, template);
      navigate(`/inspections/${record.id}`);
    } finally {
      setBusy(false);
    }
  }

  return { create, busy, ready: !!template && !!user };
}
