import { Router } from 'express';
import { prisma } from '../lib/db.js';
import { toSiteDto } from '../lib/serialize.js';
import { notFound } from '../lib/errors.js';
import type { ChecklistItem } from '../lib/validation.js';

export function sitesRouter() {
  const router = Router();

  router.get('/sites', async (_req, res) => {
    const sites = await prisma.site.findMany({ orderBy: { name: 'asc' } });
    res.json({ sites: sites.map(toSiteDto) });
  });

  router.get('/checklist-template', async (_req, res) => {
    const template = await prisma.checklistTemplate.findFirst({
      where: { isDefault: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!template) throw notFound('No default checklist template has been seeded');
    res.json({
      template: {
        id: template.id,
        name: template.name,
        items: template.items as Pick<ChecklistItem, 'id' | 'label'>[],
      },
    });
  });

  return router;
}
