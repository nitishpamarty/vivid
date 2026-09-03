import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/0005_exploration_persistence.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/exploration-state/index.ts', import.meta.url), 'utf8');
const persistenceDoc = await readFile(new URL('../docs/agentic-exploration-canvas-persistence.md', import.meta.url), 'utf8');
const threatModel = await readFile(new URL('../docs/agentic-exploration-canvas-threat-model.md', import.meta.url), 'utf8');

const checks = [
  ['migration', 'core tables enable RLS', /alter table explorations enable row level security[\s\S]*alter table exploration_capabilities enable row level security[\s\S]*alter table exploration_audit_events enable row level security/i, true],
  ['migration', 'browser table writes are revoked', /revoke all on table explorations from public, anon, authenticated/i, true],
  ['migration', 'capabilities store digests, not plaintext', /capability_digest text not null check \(capability_digest ~ '\^\[0-9a-f\]\{64\}\$'/i, true],
  ['migration', 'audit table has the bounded metadata shape', /create table if not exists exploration_audit_events[\s\S]*?occurred_at timestamptz[\s\S]*?\);/i, true],
  ['migration', 'audit has no sensitive payload columns', /create table if not exists exploration_audit_events[\s\S]*?\b(snapshot|prompt|capability|token)\b\s+(jsonb|text)[\s\S]*?\);/i, false],
  ['migration', 'core tables have no browser policy', /create policy[\s\S]*?on (explorations|exploration_capabilities|exploration_audit_events)/i, false],
  ['migration', 'snapshot is bounded', /jsonb_array_length\(p_snapshot->'cards'\) > 100[\s\S]*octet_length\(p_snapshot::text\) > 1048576/i, true],
  ['migration', 'CAS locks the exploration row', /select \* into current_row from explorations where exploration_id = p_exploration_id for update/i, true],
  ['migration', 'CAS checks expected version', /current_row\.version <> p_expected_version[\s\S]*version_conflict/i, true],
  ['migration', 'CAS increments exactly one version', /next_version := current_row\.version \+ 1[\s\S]*version = next_version/i, true],
  ['migration', 'audit and state update are adjacent in one RPC', /update explorations[\s\S]*insert into exploration_audit_events/i, true],
  ['migration', 'create requires exactly one owner capability', /owner_count <> 1[\s\S]*count\(distinct item->>'digest'\)/i, true],
  ['migration', 'open checks revocation and expiry', /create or replace function public\.open_exploration[\s\S]*revoked_at is null[\s\S]*expires_at is null or c\.expires_at > now\(\)/i, true],
  ['migration', 'mutate checks revocation and expiry', /create or replace function public\.mutate_exploration[\s\S]*revoked_at is null[\s\S]*expires_at is null or c\.expires_at > now\(\)/i, true],
  ['migration', 'viewer mutation is denied', /if not found or grant_role = 'viewer' then[\s\S]*reason', 'unauthorized'/i, true],
  ['migration', 'only owner can rename', /if p_name is not null and grant_role <> 'owner'[\s\S]*Only the owner can rename/i, true],
  ['migration', 'tenant scope is explicitly deferred for this demo', /Tenant scope is intentionally absent from this no-login fictional demo/i, true],
  ['edge', 'edge hashes with SHA-256', /crypto\.subtle\.digest\('SHA-256'/i, true],
  ['edge', 'edge requires URL-safe capability shape', /value\.length >= 32[\s\S]*\^\[A-Za-z0-9_-\]\+/i, true],
  ['edge', 'shares cannot mint owner grants', /share\.role !== 'editor' && share\.role !== 'viewer'/i, true],
  ['edge', 'edge rejects client authority fields', /knownKeys\(body, \['operation', 'explorationId', 'capability', 'actor', 'expectedVersion'/i, true],
  ['edge', 'edge forwards actor only as an audit claim', /p_actor_kind: actor/i, true],
  ['edge', 'edge does not log request secrets', /console\.(log|info|warn|error)\s*\(/i, false],
  ['edge', 'edge never returns capability material', /capability\s*:\s*body\.capability/i, false],
  ['docs', 'role matrix states viewer is read-only', /owner and editor grants may replace[\s\S]*viewer grants are read-only/i, true],
  ['docs', 'docs disclose absent tenant scope', /no `tenant_id` column[\s\S]*cannot establish cross-tenant identity/i, true],
  ['threat model', 'production requires tenant-scoped policy', /Exploration, card, grant,[\s\S]*tenant-scoped/i, true],
];

const failed = checks.filter(([source, _name, pattern, shouldMatch]) => {
  const text = source === 'migration' ? migration : source === 'edge' ? edge : source === 'docs' ? persistenceDoc : threatModel;
  return pattern.test(text) !== shouldMatch;
}).map(([, name]) => name);

if (failed.length) {
  console.error(`Exploration persistence verification failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`Exploration persistence static verification passed (${checks.length} checks).`);
