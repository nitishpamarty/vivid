// Launch-readiness checks for the Exploration Canvas.
//
// This is intentionally a source/contract verifier, not a substitute for a
// deployed Supabase integration test. It is safe to run in a checkout with no
// network, database, or credentials.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

const files = {
  exploreTools: await source('src/lib/registerExploreWebMcpTools.ts'),
  queryTools: await source('src/lib/registerQueryWebMcpTools.ts'),
  canvasTools: await source('src/lib/registerCanvasWebMcpTools.ts'),
  reportTools: await source('src/lib/registerWebMcpTools.ts'),
  semanticTools: await source('src/lib/registerSemanticWebMcpTools.ts'),
  usageTools: await source('src/lib/registerUsageWebMcpTools.ts'),
  app: await source('src/App.tsx'),
  queryContract: await source('src/lib/queryContract.ts'),
  semanticEdge: await source('supabase/functions/semantic-layer/index.ts'),
  aggregateEdge: await source('supabase/functions/aggregate-query/index.ts'),
  explorationEdge: await source('supabase/functions/exploration-state/index.ts'),
  explorationMigration: await source('supabase/migrations/0005_exploration_persistence.sql'),
  sharedMigration: await source('supabase/migrations/0003_shared_state_rpc.sql'),
  roomSession: await source('src/lib/roomSession.ts'),
  canvas: await source('src/components/ExplorationCanvas.tsx'),
};

const checks = [
  ['Connect Data discovery/connection tools', files.exploreTools, ['list_datasets', 'connect_dataset', 'get_dataset_schema', 'get_chart_contract', 'set_chart_contract']],
  ['Connect Data display cast tool', files.exploreTools, ['set_column_display_type', 'presentation-time only']],
  ['governed aggregate tool pair', files.queryTools, ['get_query_options', 'query_dataset_aggregate', 'validateQueryContract', 'normalizeAggregateResponse']],
  ['canvas card lifecycle tools', files.canvasTools, ['get_exploration_context', 'create_canvas_card', 'update_canvas_card', 'remove_canvas_card', 'reorder_canvas_cards']],
  ['canvas persistence tools', files.canvasTools, ['list_explorations', 'open_exploration', 'create_exploration', 'update_exploration', 'expectedVersion']],
  ['Revenue report tools', files.reportTools, ['get_report_context', 'list_report_options', 'update_chart_spec', 'set_report_filters', 'find_account_values', 'find_field_values']],
  ['semantic WebMCP tools', files.semanticTools, ['get_business_definitions', 'query_business_metric', 'registerSemanticWebMcpTools']],
  ['separate visualization/semantic registration wiring', files.app, ['registerWebMcpTools', 'registerSemanticWebMcpTools']],
  ['Product Usage tool lifecycle', files.usageTools, ['get_usage_context', 'list_usage_options', 'set_usage_filters', 'find_usage_values']],
  ['two declared relationship paths', files.queryContract, ['mrr_monthly_to_customers', 'report_views_monthly_to_reports', 'RELATIONSHIP_CATALOG']],
  ['semantic metadata/query boundary', files.semanticEdge, ['operation !== \'meta\' && operation !== \'query\'', 'validQuery', 'CUBE_API_TOKEN', 'Semantic layer request failed.']],
  ['aggregate server boundary', files.aggregateEdge, ['operation !== \'query\'', 'query_dataset_aggregate', 'MAX_QUERY_BYTES', 'POST is required.']],
  ['capability hashing and role shares', files.explorationEdge, ['crypto.subtle.digest(\'SHA-256\'', 'share.role !== \'editor\' && share.role !== \'viewer\'', 'mutate_exploration']],
  ['viewer write denial and owner rename rule', files.explorationMigration, ["grant_role = 'viewer'", "Only the owner can rename"]],
  ['exploration CAS and atomic audit', files.explorationMigration, ['for update', 'current_row.version <> p_expected_version', 'next_version := current_row.version + 1', 'insert into exploration_audit_events']],
  ['default-deny exploration tables', files.explorationMigration, ['enable row level security', 'revoke all on table explorations from public, anon, authenticated']],
  ['closed card contract rejects escape hatches', files.explorationMigration, ['rawSql', 'dataUrl', 'transform', 'serviceRoleKey']],
  ['request/body limits and bounded telemetry', await source('supabase/functions/_shared/observability.ts'), ['VIVID_MAX_REQUEST_BYTES', 'VIVID_QUERY_RATE_PER_MINUTE', 'VIVID_MUTATION_RATE_PER_MINUTE', 'withTimeout', 'vivid_request']],
  ['fragment-only session capability', files.roomSession, ['url.hash', 'params.get(\'key\')', 'url.searchParams.delete(\'key\')']],
  ['semantic suggestion is visibly inert', files.canvas, ['Suggested chart · not applied', 'apply it with an explicit chart-card mutation']],
];

const failures = [];
for (const [name, text, needles] of checks) {
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) failures.push(`${name}: missing ${missing.join(', ')}`);
}

if (/tool\(\s*['"](?:get_business_definitions|query_business_metric)['"]/.test(files.reportTools)) {
  failures.push('visualization registration must not contain semantic-layer tools');
}

if (failures.length) {
  console.error('Exploration Canvas launch verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Exploration Canvas launch contract verification passed (${checks.length} checks).`);
console.log('This verifier checks checked-in contracts only; run the manual browser acceptance flow in docs/agentic-exploration-canvas-launch.md against a deployed Supabase project for live persistence, roles, and CAS evidence.');
