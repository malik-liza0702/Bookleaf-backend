import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));

/** The hand-written OpenAPI 3 spec, served at /api/docs and /api/docs/openapi.json. */
export function loadOpenApiSpec(): Record<string, unknown> {
  return parse(readFileSync(join(here, 'openapi.yaml'), 'utf8')) as Record<string, unknown>;
}
