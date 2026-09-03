-- Extends shared-state persistence with an allow-listed `product_usage`
-- report namespace, alongside the existing `northbeam` one, in the same
-- room. Revenue's chart/filter validation and messages are byte-for-byte
-- unchanged below; Product Usage gets its own filter-patch validation
-- branch, its own default-state insert, and its own activity messages.
-- Apply after 0003_shared_state_rpc.sql.

alter table dashboard_state drop constraint if exists dashboard_state_report_id_check;
alter table dashboard_state add constraint dashboard_state_report_id_check check (report_id in ('northbeam', 'product_usage'));
alter table activity_log drop constraint if exists activity_log_report_id_check;
alter table activity_log add constraint activity_log_report_id_check check (report_id in ('northbeam', 'product_usage'));

drop function if exists public.create_room(uuid, text, jsonb, integer);
drop function if exists public.mutate_room(uuid, text, bigint, jsonb);

create or replace function public.create_room(
  p_room_id uuid,
  p_capability_hash text,
  p_state jsonb,
  p_schema_version integer,
  p_report_id text default 'northbeam'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  existing_hash text;
  saved_state jsonb;
  saved_version bigint;
begin
  if p_report_id not in ('northbeam', 'product_usage') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Report id is invalid.');
  end if;

  select capability_hash into existing_hash from rooms where room_id = p_room_id;
  if existing_hash is not null then
    if existing_hash <> p_capability_hash then
      return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Room capability is invalid.');
    end if;
  else
    insert into rooms(room_id, capability_hash) values (p_room_id, p_capability_hash);
  end if;

  insert into dashboard_state(room_id, report_id, schema_version, version, state, updated_by)
  values (p_room_id, p_report_id, p_schema_version, 0, p_state, 'person')
  on conflict (room_id, report_id) do nothing;
  select state, version into saved_state, saved_version from dashboard_state where room_id = p_room_id and report_id = p_report_id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('state', saved_state, 'version', saved_version,
    'activity', jsonb_build_object('id', 0, 'actor', 'person', 'message', 'started live session', 'ts', to_char(now(), 'HH12:MI AM'))));
end;
$$;

create or replace function public.mutate_room(
  p_room_id uuid,
  p_capability_hash text,
  p_expected_version bigint,
  p_mutation jsonb,
  p_report_id text default 'northbeam'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  room rooms;
  current_state dashboard_state;
  next_state jsonb;
  patch jsonb;
  chart_id text;
  key text;
  value jsonb;
  actor text;
  source text;
  message text;
  new_version bigint;
  event_id bigint;
  event_time timestamptz;
begin
  if p_report_id not in ('northbeam', 'product_usage') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Report id is invalid.');
  end if;

  select * into room from rooms where room_id = p_room_id;
  if not found or room.capability_hash <> p_capability_hash or room.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability', 'error', 'Room capability is invalid or expired.');
  end if;

  select * into current_state from dashboard_state where room_id = p_room_id and report_id = p_report_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_ready', 'error', 'Room state is not ready.');
  end if;
  if current_state.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'conflict', 'error', 'Dashboard changed elsewhere.', 'currentVersion', current_state.version);
  end if;

  actor := p_mutation->>'actor';
  if actor not in ('person', 'agent') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Mutation actor is invalid.');
  end if;
  source := case when actor = 'agent' then 'webmcp' else 'person_ui' end;
  patch := p_mutation->'patch';

  if p_report_id = 'northbeam' and p_mutation->>'kind' = 'chart_patch' then
    chart_id := p_mutation->>'chartId';
    if chart_id not in ('arr_bridge', 'retention_nrr', 'retention_churn') or jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'invalid_patch', 'error', 'Chart mutation is invalid.');
    end if;
    for key, value in select * from jsonb_each(patch) loop
      if chart_id = 'arr_bridge' and key not in ('windowMonths', 'positiveColor', 'negativeColor', 'barWidth') then
        return jsonb_build_object('ok', false, 'reason', 'unknown_field', 'error', 'Chart field is not editable.');
      elsif chart_id in ('retention_nrr', 'retention_churn') and key not in ('windowMonths', 'lineColor') then
        return jsonb_build_object('ok', false, 'reason', 'unknown_field', 'error', 'Chart field is not editable.');
      end if;
      if key = 'windowMonths' and (jsonb_typeof(value) <> 'number' or (value #>> '{}')::numeric not in (6, 12, 24)) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'windowMonths must be 6, 12, or 24.');
      elsif key in ('positiveColor', 'negativeColor', 'lineColor') and (jsonb_typeof(value) <> 'string' or value #>> '{}' not in ('good','critical','brand','cat2','cat3')) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Color value is invalid.');
      elsif key = 'barWidth' and (jsonb_typeof(value) <> 'number' or (value #>> '{}')::numeric < .4 or (value #>> '{}')::numeric > .8 or abs(((value #>> '{}')::numeric - .4) / .02 - round(((value #>> '{}')::numeric - .4) / .02)) > .000000001) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'barWidth must be a 0.02 step between 0.4 and 0.8.');
      end if;
    end loop;
    next_state := jsonb_set(current_state.state, array['charts', chart_id], (current_state.state #> array['charts', chart_id]) || patch, true);
    message := 'updated ' || chart_id || ' chart';
  elsif p_report_id = 'northbeam' and p_mutation->>'kind' = 'filter_patch' then
    if jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'invalid_patch', 'error', 'Filter mutation is invalid.');
    end if;
    for key, value in select * from jsonb_each(patch) loop
      if key not in ('segment','region','planTier','channel','contractType','accountName') or jsonb_typeof(value) <> 'string' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Filter value is invalid.');
      elsif key = 'segment' and value #>> '{}' not in ('all','SMB','Mid-Market','Enterprise') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Segment value is invalid.');
      elsif key = 'region' and value #>> '{}' not in ('all','NA','EMEA','APAC','LATAM') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Region value is invalid.');
      elsif key = 'planTier' and value #>> '{}' not in ('all','Starter','Team','Business','Enterprise') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Plan value is invalid.');
      elsif key = 'channel' and value #>> '{}' not in ('all','Paid','Organic','Referral','Partner') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Channel value is invalid.');
      elsif key = 'contractType' and value #>> '{}' not in ('all','Monthly','Annual') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Contract value is invalid.');
      elsif key = 'accountName' and value #>> '{}' <> 'all' and not exists (select 1 from customers where name = value #>> '{}') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Account name is invalid.');
      end if;
    end loop;
    next_state := jsonb_set(current_state.state, array['filters'], (current_state.state->'filters') || patch, true);
    message := 'updated report filters';
  elsif p_report_id = 'product_usage' and p_mutation->>'kind' = 'filter_patch' then
    if jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
      return jsonb_build_object('ok', false, 'reason', 'invalid_patch', 'error', 'Filter mutation is invalid.');
    end if;
    for key, value in select * from jsonb_each(patch) loop
      if key not in ('ownerTeam','reportId','asOfMonth') or jsonb_typeof(value) <> 'string' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Filter value is invalid.');
      elsif key = 'ownerTeam' and value #>> '{}' not in ('all','Engineering','Sales','Customer Success','Marketing','Product','People','Finance') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Owner team value is invalid.');
      elsif key = 'reportId' and value #>> '{}' <> 'all' and not exists (select 1 from reports where report_id = value #>> '{}') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Report id is invalid.');
      elsif key = 'asOfMonth' and (value #>> '{}' !~ '^\d{4}-\d{2}$' or not exists (select 1 from report_views_monthly where month = to_date(value #>> '{}', 'YYYY-MM'))) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'asOfMonth must be a known generated month (YYYY-MM).');
      end if;
    end loop;
    next_state := jsonb_set(current_state.state, array['filters'], (current_state.state->'filters') || patch, true);
    message := 'updated Product Usage filters';
  elsif p_mutation->>'kind' = 'undo' and actor = 'person' and jsonb_typeof(p_mutation->'restoreState') = 'object' then
    if (p_mutation->>'undoOfVersion')::bigint <> current_state.version then
      return jsonb_build_object('ok', false, 'reason', 'conflict', 'error', 'Dashboard changed elsewhere.', 'currentVersion', current_state.version);
    end if;
    if p_report_id = 'northbeam' and (not (p_mutation->'restoreState' ? 'charts') or not (p_mutation->'restoreState' ? 'filters')) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Restore state is invalid.');
    end if;
    if p_report_id = 'product_usage' and not (p_mutation->'restoreState' ? 'filters') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Restore state is invalid.');
    end if;
    next_state := p_mutation->'restoreState';
    message := case when p_report_id = 'product_usage' then 'undid last Product Usage edit' else 'undid last shared edit' end;
  else
    return jsonb_build_object('ok', false, 'reason', 'invalid_request', 'error', 'Mutation kind is invalid.');
  end if;

  new_version := current_state.version + 1;
  update dashboard_state set state = next_state, version = new_version, updated_by = actor, updated_at = now()
    where room_id = p_room_id and report_id = p_report_id;
  insert into activity_log(room_id, report_id, actor, source, message)
    values (p_room_id, p_report_id, actor, source, message)
    returning id, created_at into event_id, event_time;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('state', next_state, 'version', new_version,
    'activity', jsonb_build_object('id', event_id, 'actor', actor, 'message', message, 'ts', to_char(event_time, 'HH12:MI AM'))));
end;
$$;

revoke all on function public.create_room(uuid, text, jsonb, integer, text) from public, anon, authenticated;
revoke all on function public.mutate_room(uuid, text, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_room(uuid, text, jsonb, integer, text) to service_role;
grant execute on function public.mutate_room(uuid, text, bigint, jsonb, text) to service_role;
