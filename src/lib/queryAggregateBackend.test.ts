import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/0004_query_aggregate_rpc.sql', import.meta.url), 'utf8');
const edgeFunction = readFileSync(new URL('../../supabase/functions/aggregate-query/index.ts', import.meta.url), 'utf8');

test('aggregate backend is server-owned and service-role-only', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set_config\('statement_timeout', '5000'/);
  assert.match(migration, /revoke all on function public\.query_dataset_aggregate\(jsonb\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.query_dataset_aggregate\(jsonb\) to service_role/);
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(edgeFunction, /CUBE_API_TOKEN|CUBE_API_URL/);
});

test('aggregate backend only emits approved relationship joins and bounded results', () => {
  assert.match(migration, /mrr_monthly_to_customers/);
  assert.match(migration, /report_views_monthly_to_reports/);
  assert.match(migration, /source_rows > 100000/);
  assert.match(migration, /limit_value \+ 1/);
  assert.match(migration, /'maxSourceRows', 100000/);
  assert.match(migration, /'statementTimeoutMs', 5000/);
  assert.match(migration, /'maxResponseBytes', 1000000/);
  assert.match(migration, /'sourceTables'/);
  assert.match(migration, /'truncated'/);
});

test('transport does not accept arbitrary operations or non-POST execution', () => {
  assert.match(edgeFunction, /request\.method !== 'POST'/);
  assert.match(edgeFunction, /body\?\.operation !== 'query'/);
  assert.match(edgeFunction, /query_dataset_aggregate/);
});
