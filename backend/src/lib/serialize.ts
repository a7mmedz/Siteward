import type { Inspection, Site } from '@prisma/client';
import type { ChecklistItem } from './validation.js';

export type InspectionDto = {
  id: string;
  siteId: string;
  inspectorId: string;
  inspectorName: string;
  title: string;
  notes: string;
  status: 'draft' | 'submitted';
  items: ChecklistItem[];
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type InspectionWithInspector = Inspection & { inspector: { name: string } };

export const withInspector = { inspector: { select: { name: true } } } as const;

export function toInspectionDto(row: InspectionWithInspector): InspectionDto {
  return {
    id: row.id,
    siteId: row.siteId,
    inspectorId: row.inspectorId,
    inspectorName: row.inspector.name,
    title: row.title,
    notes: row.notes,
    status: row.status,
    items: row.items as ChecklistItem[],
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

export function toSiteDto(site: Site) {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    createdAt: site.createdAt.toISOString(),
  };
}
