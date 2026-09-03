import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../supabase/migrations/0005_exploration_persistence.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../../supabase/functions/exploration-state/index.ts', import.meta.url), 'utf8');

test('capability roles have an explicit open/mutate matrix', () => {
  assert.match(migration, /role text not null check \(role in \('owner', 'editor', 'viewer'\)\)/);
  assert.match(migration, /select c\.role into grant_role[\s\S]*from exploration_capabilities/);
  assert.match(migration, /if not found or grant_role = 'viewer' then[\s\S]*reason', 'unauthorized'/);
  assert.match(migration, /if p_name is not null and grant_role <> 'owner'[\s\S]*Only the owner can rename/);
  assert.match(edge, /share\.role !== 'editor' && share\.role !== 'viewer'/);
});

test('capability grants are checked for revocation and expiry on every access path', () => {
  for (const operation of ['open_exploration', 'list_explorations', 'mutate_exploration']) {
    const start = migration.indexOf(`create or replace function public.${operation}`);
    const body = migration.slice(start, migration.indexOf('\n$$;', start));
    assert.match(body, /revoked_at is null[\s\S]*expires_at is null or c\.expires_at > now\(\)/,
      `${operation} must check grant status`);
  }
});

test('listing is a capability-scoped compact read and remains service-only', () => {
  assert.match(migration, /create or replace function public\.list_explorations\(\s*p_capability_digest text/);
  assert.match(migration, /explorationId[\s\S]*role/);
  assert.match(migration, /limit 100/);
  assert.match(edge, /body\.operation === 'list_explorations'[\s\S]*supabase\.rpc\('list_explorations'/);
  assert.match(migration, /revoke all on function public\.list_explorations\(text, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.list_explorations\(text, text\) to service_role/);
});

test('browser roles cannot bypass the service-only table and function boundary', () => {
  assert.match(migration, /alter table explorations enable row level security/);
  assert.match(migration, /alter table exploration_capabilities enable row level security/);
  assert.match(migration, /alter table exploration_audit_events enable row level security/);
  assert.match(migration, /revoke all on table explorations from public, anon, authenticated/);
  assert.match(migration, /revoke all on table exploration_capabilities from public, anon, authenticated/);
  assert.match(migration, /revoke all on table exploration_audit_events from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.open_exploration\([^\n]+ from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.open_exploration\([^\n]+ to service_role/);
  assert.doesNotMatch(migration, /create policy[\s\S]*on (explorations|exploration_capabilities|exploration_audit_events)/i);
});

test('tenant and role are not accepted as browser authority fields', () => {
  assert.doesNotMatch(edge, /knownKeys\(body, [^\n]*tenantId/);
  assert.doesNotMatch(edge, /knownKeys\(body, [^\n]*role/);
  assert.match(edge, /const actor = actorKind\(body\.actor\)/);
  assert.match(edge, /p_actor_kind: actor/);
  assert.match(migration, /Tenant scope is intentionally absent from this no-login fictional demo/);
});
