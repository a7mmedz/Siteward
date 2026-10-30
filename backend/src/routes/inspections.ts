import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { canAccessInspection, currentUser } from '../lib/auth.js';
import { notFound, parse } from '../lib/errors.js';
import { toInspectionDto, withInspector } from '../lib/serialize.js';

const listQuery = z.object({
  updatedSince: z.iso
    .datetime({ offset: true, message: 'updatedSince must be an ISO 8601 date-time' })
    .optional(),
});

const idParams = z.object({ id: z.uuid('Inspection id must be a UUID') });

export function inspectionsRouter() {
  const router = Router();

  /**
   * Incremental pull. With `updatedSince`, soft-deleted rows are included so clients can drop them.
   * `serverTime` is taken before the query; clients pass it back as the next `updatedSince`.
   */
  router.get('/inspections', async (req, res) => {
    const { updatedSince } = parse(listQuery, req.query);
    const user = currentUser(req);
    const serverTime = new Date();
    const where: Prisma.InspectionWhereInput = {
      ...(user.role === 'inspector' && { inspectorId: user.id }),
      ...(updatedSince ? { updatedAt: { gte: new Date(updatedSince) } } : { deletedAt: null }),
    };
    const rows = await prisma.inspection.findMany({
      where,
      include: withInspector,
      orderBy: { updatedAt: 'asc' },
    });
    res.json({ inspections: rows.map(toInspectionDto), serverTime: serverTime.toISOString() });
  });

  router.get('/inspections/:id', async (req, res) => {
    const { id } = parse(idParams, req.params);
    const user = currentUser(req);
    const row = await prisma.inspection.findUnique({ where: { id }, include: withInspector });
    // Not-visible and missing look the same, so ids of other inspectors' work are not revealed.
    if (!row || row.deletedAt || !canAccessInspection(user, row)) {
      throw notFound('Inspection not found');
    }
    res.json({ inspection: toInspectionDto(row) });
  });

  return router;
}
