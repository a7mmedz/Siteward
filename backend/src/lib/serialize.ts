import type { Inspection, Role, Site } from '@prisma/client';
import type { ChecklistItem } from './validation.js';

export type UserRefDto = { id: string; name: string; role: Role };

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
  /** Server time of the last write. */
  updatedAt: string;
  /** Who made the last write. */
  updatedBy: UserRefDto;
  deletedAt: string | null;
};

export type InspectionWithInspector = Inspection & {
  inspector: { name: string };
  updatedBy: UserRefDto;
};

export const withInspector = {
  inspector: { select: { name: true } },
  updatedBy: { select: { id: true, name: true, role: true } },
} as const;

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
    updatedBy: { id: row.updatedBy.id, name: row.updatedBy.name, role: row.updatedBy.role },
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
