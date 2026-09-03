-- Add the governed Revenue presentation mutation to the existing shared-state
-- transaction. This changes RPC behavior only; it adds no tables or columns.
-- Apply after 0006_product_usage_shared_state.sql.

drop function if exists public.mutate_room(uuid, text, bigint, jsonb, text);

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
  contract jsonb;
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
  contract := p_mutation->'contract';

  if p_report_id = 'northbeam' and p_mutation->>'kind' = 'chart_contract' then
    chart_id := p_mutation->>'chartId';
    if chart_id is null or chart_id not in ('arr_mix', 'top_accounts', 'net_new_logos', 'arr_bridge', 'retention_nrr', 'retention_churn')
       or jsonb_typeof(contract) <> 'object'
       or not (contract ? 'version') or not (contract ? 'chartId') or not (contract ? 'presentation') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_contract', 'error', 'Revenue chart contract is invalid.');
    end if;
    for key, value in select * from jsonb_each(contract) loop
      if key not in ('version', 'chartId', 'presentation') then
        return jsonb_build_object('ok', false, 'reason', 'unknown_field', 'error', 'Revenue chart contract contains an unknown field.');
      end if;
    end loop;
    if jsonb_typeof(contract->'version') is distinct from 'number' or contract->>'version' is distinct from '1' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Revenue chart contract version must be 1.');
    end if;
    if contract->>'chartId' is distinct from chart_id then
      return jsonb_build_object('ok', false, 'reason', 'unknown_chart', 'error', 'Revenue chart contract chartId does not match the mutation chartId.');
    end if;
    if contract->>'presentation' is null
       or (chart_id = 'arr_mix' and contract->>'presentation' not in ('donut', 'bar'))
       or (chart_id = 'top_accounts' and contract->>'presentation' not in ('ranked_list', 'bar'))
       or (chart_id = 'net_new_logos' and contract->>'presentation' not in ('heatmap', 'bar'))
       or (chart_id = 'arr_bridge' and contract->>'presentation' <> 'waterfall')
       or (chart_id in ('retention_nrr', 'retention_churn') and contract->>'presentation' <> 'line') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Revenue chart presentation is not allowed.');
    end if;
    next_state := jsonb_set(
      current_state.state,
      '{chartContracts}',
      jsonb_build_object(
        'arr_mix', jsonb_build_object('version', 1, 'chartId', 'arr_mix', 'presentation', 'donut'),
        'top_accounts', jsonb_build_object('version', 1, 'chartId', 'top_accounts', 'presentation', 'ranked_list'),
        'net_new_logos', jsonb_build_object('version', 1, 'chartId', 'net_new_logos', 'presentation', 'heatmap'),
        'arr_bridge', jsonb_build_object('version', 1, 'chartId', 'arr_bridge', 'presentation', 'waterfall'),
        'retention_nrr', jsonb_build_object('version', 1, 'chartId', 'retention_nrr', 'presentation', 'line'),
        'retention_churn', jsonb_build_object('version', 1, 'chartId', 'retention_churn', 'presentation', 'line')
      ) || coalesce(current_state.state->'chartContracts', '{}'::jsonb) || jsonb_build_object(chart_id, contract),
      true
    );
    message := 'updated ' || chart_id || ' chart presentation';
  elsif p_report_id = 'northbeam' and p_mutation->>'kind' = 'chart_patch' then
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
  update dashboard_state
    set state = next_state,
        schema_version = case when p_report_id = 'northbeam' and p_mutation->>'kind' = 'chart_contract' then 5 else schema_version end,
        version = new_version, updated_by = actor, updated_at = now()
    where room_id = p_room_id and report_id = p_report_id;
  insert into activity_log(room_id, report_id, actor, source, message)
    values (p_room_id, p_report_id, actor, source, message)
    returning id, created_at into event_id, event_time;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('state', next_state, 'version', new_version,
    'activity', jsonb_build_object('id', event_id, 'actor', actor, 'message', message, 'ts', to_char(event_time, 'HH12:MI AM'))));
end;
$$;

revoke all on function public.mutate_room(uuid, text, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.mutate_room(uuid, text, bigint, jsonb, text) to service_role;
