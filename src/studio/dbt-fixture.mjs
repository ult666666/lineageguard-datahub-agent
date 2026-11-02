import fs from 'node:fs';
import { DBT_FIXTURE, createDbtScenarioAdapter } from '../../public/studio/core/fixtures.js';
import { readDbtJson } from '../../public/studio/core/dbt-manifest.js';

const PUBLIC = new URL('../../public/', import.meta.url);
/** The bundled saas-analytics-warehouse manifest and catalog, parsed as JSON. */
export function readDbtFixture() {
  const read = (file, label) =>
    readDbtJson(new Uint8Array(fs.readFileSync(new URL('.' + file, PUBLIC))), { label });
  return {
    manifest: read(DBT_FIXTURE.manifest, 'bundled dbt manifest'),
    catalog: read(DBT_FIXTURE.catalog, 'bundled dbt catalog'),
  };
}
export async function dbtFixtureAdapter(target = DBT_FIXTURE.target) {
  const { manifest, catalog } = readDbtFixture();
  return createDbtScenarioAdapter(manifest, catalog, target);
}
