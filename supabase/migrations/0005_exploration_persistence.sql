-- Durable Exploration Canvas state.
--
-- This is the no-login demo policy described in
-- docs/agentic-exploration-canvas-threat-model.md: a caller presents a
-- high-entropy capability at request time, the Edge Function hashes it, and
-- Postgres stores only the digest. The capability is never an authority field
-- in a persisted snapshot or audit event.
--
-- A single JSON snapshot is intentional here. Cards are an ordered canvas
-- aggregate and are always read/written together under one CAS version; a
-- normalized card table would add partial-update/reordering semantics before
-- the product needs card-level queries. The snapshot is bounded to 100 cards
-- and 1 MiB. `schema_version` is kept beside it so a decoder can migrate the
-- payload explicitly later.
--
-- Tenant scope is intentionally absent from this no-login fictional demo:
-- possession of a capability is the complete grant. This migration must not
-- be reused for customer data until tenant_id/principal scope is added to the
-- tables, capability lookup, RPCs, and every governed dataset query.

create extension if not exists pgcrypto;

create table if not exists explorations (
  exploration_id uuid primary key default gen_random_uuid(),
  schema_version integer not null check (schema_version = 1),
  name text not null check (char_length(name) between 1 and 200),
  snapshot jsonb not null,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint explorations_snapshot_object check (jsonb_typeof(snapshot) = 'object'),
  constraint explorations_snapshot_cards check (
    jsonb_typeof(snapshot->'cards') = 'array'
    and jsonb_array_length(snapshot->'cards') <= 100
    and octet_length(snapshot::text) <= 1048576
  )
);

create table if not exists exploration_capabilities (
  capability_id bigint generated always as identity primary key,
  exploration_id uuid not null references explorations(exploration_id) on delete cascade,
  capability_digest text not null check (capability_digest ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('owner', 'editor', 'viewer')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (exploration_id, capability_digest)
);

create index if not exists exploration_capabilities_lookup_idx
  on exploration_capabilities(exploration_id, capability_digest);

create table if not exists exploration_audit_events (
  event_id bigint generated always as identity primary key,
  exploration_id uuid not null references explorations(exploration_id) on delete cascade,
  version bigint not null check (version >= 0),
  action text not null check (action in (
    'exploration_created', 'exploration_opened', 'exploration_updated',
    'card_created', 'card_updated', 'card_removed', 'cards_reordered',
    'query_executed', 'question_answered', 'chart_suggested'
  )),
  capability_role text not null check (capability_role in ('owner', 'editor', 'viewer')),
  actor_kind text not null check (actor_kind in ('person', 'agent', 'system')),
  source text not null check (source in ('person_ui', 'webmcp', 'server')),
  mutation_id text check (mutation_id is null or char_length(mutation_id) between 1 and 120),
  card_id text check (card_id is null or char_length(card_id) between 1 and 120),
  occurred_at timestamptz not null default now()
);

create index if not exists exploration_audit_events_lookup_idx
  on exploration_audit_events(exploration_id, occurred_at, event_id);

alter table explorations enable row level security;
alter table exploration_capabilities enable row level security;
alter table exploration_audit_events enable row level security;

-- There are intentionally no SELECT/INSERT/UPDATE/DELETE policies for the
-- browser roles. The service-role Edge Function is the sole transport and
-- invokes the narrow SECURITY DEFINER functions below. This also prevents a
-- guessed UUID from becoming a direct REST/realtime read or write.
revoke all on table explorations from public, anon, authenticated;
revoke all on table exploration_capabilities from public, anon, authenticated;
revoke all on table exploration_audit_events from public, anon, authenticated;
revoke insert, update, delete on table explorations from service_role;
revoke insert, update, delete on table exploration_capabilities from service_role;
revoke insert, update, delete on table exploration_audit_events from service_role;

create or replace function public.exploration_snapshot_is_valid(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  card jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
     or not (p_snapshot ? 'cards')
     or exists (select 1 from jsonb_object_keys(p_snapshot) key where key <> 'cards')
     or jsonb_typeof(p_snapshot->'cards') <> 'array'
     or jsonb_array_length(p_snapshot->'cards') > 100
     or octet_length(p_snapshot::text) > 1048576 then
    return false;
  end if;

  -- The RPC checks the outer card envelope. Full query/chart/card validation
  -- remains in the shared application validator and must also run server-side
  -- when that validator is wired to this endpoint. Reject obvious executable
  -- escape hatches here so a direct RPC invocation cannot persist them.
  for card in select value from jsonb_array_elements(p_snapshot->'cards') loop
    if jsonb_typeof(card) <> 'object'
       or jsonb_typeof(card->'id') <> 'string'
       or char_length(card->>'id') < 1 or char_length(card->>'id') > 120
       or jsonb_typeof(card->'kind') <> 'string'
       or card->>'kind' not in ('chart', 'table-preview', 'note', 'question', 'metric-answer')
       or card::text ~* '"(sql|rawSql|vega|spec|dataUrl|data|url|transform|config|signal|expression|serviceRoleKey|capability|token)"\s*:' then
      return false;
    end if;

    -- Keep the RPC boundary closed even when called by a compromised Edge
    -- Function or a direct service-role integration. The browser validator is
    -- still the detailed card check; this is the server's fail-closed envelope.
    if (card->>'kind' = 'chart' and exists (select 1 from jsonb_object_keys(card) key where key not in ('id','kind','title','query','chart','createdAt','updatedAt')))
       or (card->>'kind' = 'table-preview' and exists (select 1 from jsonb_object_keys(card) key where key not in ('id','kind','title','source','preview','createdAt','updatedAt')))
       or (card->>'kind' = 'note' and exists (select 1 from jsonb_object_keys(card) key where key not in ('id','kind','title','text','createdAt','updatedAt')))
       or (card->>'kind' = 'question' and exists (select 1 from jsonb_object_keys(card) key where key not in ('id','kind','question','answerCardId','createdAt','updatedAt')))
       or (card->>'kind' = 'metric-answer' and exists (select 1 from jsonb_object_keys(card) key where key not in ('id','kind','title','question','definitions','query','result','summary','answeredAt','caveats','suggestedChart','createdAt','updatedAt'))) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create or replace function public.create_exploration(
  p_name text,
  p_schema_version integer,
  p_snapshot jsonb,
  p_capabilities jsonb,
  p_actor_kind text default 'person'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  item jsonb;
  owner_count integer := 0;
  capability_count integer;
  capability_role text;
  created_time timestamptz;
begin
  if p_actor_kind not in ('person', 'agent', 'system')
     or p_name is null or btrim(p_name) = '' or char_length(p_name) > 200
     or p_schema_version <> 1
     or not public.exploration_snapshot_is_valid(p_snapshot)
     or jsonb_typeof(p_capabilities) <> 'array'
     or jsonb_array_length(p_capabilities) < 1
     or jsonb_array_length(p_capabilities) > 8 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Exploration create request is invalid.');
  end if;

  for item in select value from jsonb_array_elements(p_capabilities) loop
    if jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in ('digest', 'role'))
       or jsonb_typeof(item->'digest') <> 'string'
       or item->>'digest' !~ '^[0-9a-f]{64}$'
       or item->>'role' not in ('owner', 'editor', 'viewer') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Exploration capability is invalid.');
    end if;
    if item->>'role' = 'owner' then owner_count := owner_count + 1; end if;
  end loop;
  capability_count := jsonb_array_length(p_capabilities);
  if owner_count <> 1
     or (select count(distinct item->>'digest') from jsonb_array_elements(p_capabilities) item) <> capability_count then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Exploration capabilities are invalid.');
  end if;

  insert into explorations(exploration_id, schema_version, name, snapshot, version)
    values (new_id, p_schema_version, btrim(p_name), p_snapshot, 0)
    returning created_at into created_time;

  insert into exploration_capabilities(exploration_id, capability_digest, role, expires_at)
    select new_id, item->>'digest', item->>'role', null
    from jsonb_array_elements(p_capabilities) item;

  insert into exploration_audit_events(
    exploration_id, version, action, capability_role, actor_kind, source, mutation_id
  ) values (
    new_id, 0, 'exploration_created', 'owner', p_actor_kind,
    case when p_actor_kind = 'agent' then 'webmcp' when p_actor_kind = 'system' then 'server' else 'person_ui' end,
    gen_random_uuid()::text
  );

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'explorationId', new_id, 'schemaVersion', p_schema_version, 'name', btrim(p_name),
    'snapshot', p_snapshot, 'version', 0, 'role', 'owner',
    'createdAt', created_time, 'updatedAt', created_time
  ));
exception when unique_violation then
  return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Exploration capabilities are invalid.');
end;
$$;

create or replace function public.open_exploration(
  p_exploration_id uuid,
  p_capability_digest text,
  p_actor_kind text default 'person'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_role text;
  row_data explorations%rowtype;
begin
  if p_actor_kind not in ('person', 'agent', 'system')
     or p_capability_digest is null or p_capability_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Exploration capability is invalid or expired.');
  end if;
  select c.role into grant_role
  from exploration_capabilities c
  where c.exploration_id = p_exploration_id
    and c.capability_digest = p_capability_digest
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now());
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Exploration capability is invalid or expired.');
  end if;
  select * into row_data from explorations where exploration_id = p_exploration_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Exploration was not found.');
  end if;

  insert into exploration_audit_events(
    exploration_id, version, action, capability_role, actor_kind, source
  ) values (
    row_data.exploration_id, row_data.version, 'exploration_opened', grant_role, p_actor_kind,
    case when p_actor_kind = 'agent' then 'webmcp' when p_actor_kind = 'system' then 'server' else 'person_ui' end
  );
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'explorationId', row_data.exploration_id, 'schemaVersion', row_data.schema_version,
    'name', row_data.name, 'snapshot', row_data.snapshot, 'version', row_data.version,
    'role', grant_role, 'createdAt', row_data.created_at, 'updatedAt', row_data.updated_at
  ));
end;
$$;

-- Return only explorations for which the presented capability is currently
-- valid.  This intentionally omits snapshots and capability material; the
-- caller must open one of the returned ids to read its cards.
create or replace function public.list_explorations(
  p_capability_digest text,
  p_actor_kind text default 'person'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_actor_kind not in ('person', 'agent', 'system')
     or p_capability_digest is null or p_capability_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Exploration capability is invalid or expired.');
  end if;

  return jsonb_build_object('ok', true, 'data', coalesce((
    select jsonb_agg(jsonb_build_object(
      'explorationId', e.exploration_id,
      'schemaVersion', e.schema_version,
      'name', e.name,
      'version', e.version,
      'role', c.role,
      'createdAt', e.created_at,
      'updatedAt', e.updated_at
    ) order by e.updated_at desc, e.exploration_id)
    from (
      select e.*
      from explorations e
      join exploration_capabilities c0 on c0.exploration_id = e.exploration_id
      where c0.capability_digest = p_capability_digest
        and c0.revoked_at is null
        and (c0.expires_at is null or c0.expires_at > now())
      order by e.updated_at desc, e.exploration_id
      limit 100
    ) e
    join exploration_capabilities c
      on c.exploration_id = e.exploration_id
     and c.capability_digest = p_capability_digest
     and c.revoked_at is null
     and (c.expires_at is null or c.expires_at > now())
  ), '[]'::jsonb));
end;
$$;

create or replace function public.mutate_exploration(
  p_exploration_id uuid,
  p_capability_digest text,
  p_expected_version bigint,
  p_snapshot jsonb,
  p_action text,
  p_mutation_id text,
  p_actor_kind text default 'person',
  p_card_id text default null,
  p_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_role text;
  current_row explorations%rowtype;
  next_version bigint;
  event_source text;
begin
  if p_actor_kind not in ('person', 'agent', 'system')
     or p_capability_digest is null or p_capability_digest !~ '^[0-9a-f]{64}$'
     or p_expected_version is null or p_expected_version < 0
     or p_action not in ('exploration_updated', 'card_created', 'card_updated', 'card_removed', 'cards_reordered', 'query_executed', 'question_answered', 'chart_suggested')
     or p_mutation_id is null or char_length(p_mutation_id) < 1 or char_length(p_mutation_id) > 120
     or (p_card_id is not null and (char_length(p_card_id) < 1 or char_length(p_card_id) > 120))
     or (p_name is not null and (btrim(p_name) = '' or char_length(p_name) > 200))
     or not public.exploration_snapshot_is_valid(p_snapshot) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Exploration update request is invalid.');
  end if;

  select c.role into grant_role
  from exploration_capabilities c
  where c.exploration_id = p_exploration_id
    and c.capability_digest = p_capability_digest
    and c.revoked_at is null
    and (c.expires_at is null or c.expires_at > now());
  if not found or grant_role = 'viewer' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized', 'error', 'This capability cannot edit the exploration.');
  end if;

  -- Editors may update cards and run approved operations, but only the owner
  -- may rename/manage the exploration. The capability role, never a request
  -- body field, is the authority for this check.
  if p_name is not null and grant_role <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized', 'error', 'Only the owner can rename the exploration.');
  end if;

  select * into current_row from explorations where exploration_id = p_exploration_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'error', 'Exploration was not found.');
  end if;
  if current_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict', 'error', 'Exploration changed elsewhere.', 'currentVersion', current_row.version);
  end if;

  next_version := current_row.version + 1;
  event_source := case when p_actor_kind = 'agent' then 'webmcp' when p_actor_kind = 'system' then 'server' else 'person_ui' end;
  update explorations
    set snapshot = p_snapshot,
        name = coalesce(nullif(btrim(p_name), ''), name),
        version = next_version,
        updated_at = now()
    where exploration_id = p_exploration_id;
  insert into exploration_audit_events(
    exploration_id, version, action, capability_role, actor_kind, source, mutation_id, card_id
  ) values (
    p_exploration_id, next_version, p_action, grant_role, p_actor_kind,
    event_source, p_mutation_id, p_card_id
  );

  select * into current_row from explorations where exploration_id = p_exploration_id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'explorationId', current_row.exploration_id, 'schemaVersion', current_row.schema_version,
    'name', current_row.name, 'snapshot', current_row.snapshot, 'version', current_row.version,
    'role', grant_role, 'updatedAt', current_row.updated_at
  ));
end;
$$;

revoke all on function public.exploration_snapshot_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.create_exploration(text, integer, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.open_exploration(uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_explorations(text, text) from public, anon, authenticated;
revoke all on function public.mutate_exploration(uuid, text, bigint, jsonb, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_exploration(text, integer, jsonb, jsonb, text) to service_role;
grant execute on function public.open_exploration(uuid, text, text) to service_role;
grant execute on function public.list_explorations(text, text) to service_role;
grant execute on function public.mutate_exploration(uuid, text, bigint, jsonb, text, text, text, text, text) to service_role;
