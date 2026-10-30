import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

// Same relative location from src/routes (tsx) and dist/routes (built): backend/../docs.
const SPEC_PATH =
  process.env.OPENAPI_PATH ?? fileURLToPath(new URL('../../../docs/openapi.yaml', import.meta.url));

export function docsRouter() {
  const router = Router();
  const source = readFileSync(SPEC_PATH, 'utf8');
  const spec = YAML.parse(source) as Record<string, unknown>;

  router.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml').send(source);
  });
  router.get('/openapi.json', (_req, res) => {
    res.json(spec);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, { customSiteTitle: 'Siteward API docs' }),
  );
  return router;
}
