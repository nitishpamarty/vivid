-- Governed aggregate queries for the Exploration Canvas.
-- The browser sends only the validated QueryContract shape. This function still
-- validates it server-side and resolves every identifier from fixed allow-lists.
-- It is intentionally callable only by the service role through the Edge
-- Function; the current demo's seven source tables are fictional/public-read.

create or replace function public.query_dataset_aggregate(p_query jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source text;
  path jsonb;
  relation_id text;
  joined_dataset text;
  dimensions jsonb;
  measures jsonb;
  filters jsonb;
  sort_keys jsonb;
  item jsonb;
  ref jsonb;
  dataset text;
  field text;
  aggregate_name text;
  operator_name text;
  value_json jsonb;
  field_type text;
  field_expr text;
  group_expr text;
  select_expr text := 'jsonb_build_object(';
  from_expr text;
  where_expr text := '';
  group_exprs text := '';
  order_expr text := '';
  query_sql text;
  rows jsonb;
  source_rows bigint;
  result_count integer;
  limit_value integer;
  offset_value integer;
  limit_number numeric;
  offset_number numeric;
  time_grain text;
  dimension_count integer := 0;
  measure_count integer := 0;
  filter_count integer := 0;
  sort_count integer := 0;
  has_date_dimension boolean := false;
  truncated boolean := false;
  is_first boolean := true;
  relation_count integer;
  expected_key text;
begin
  -- Keep a bounded transaction-local execution budget for direct RPC callers.
  perform set_config('statement_timeout', '5000', true);

  if p_query is null or jsonb_typeof(p_query) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_query', 'error', 'Query contract must be an object.');
  end if;
  if exists (select 1 from jsonb_object_keys(p_query) key where key not in
    ('source','relationshipPath','dimensions','measures','filters','sort','timeGrain','limit','offset')) then
    return jsonb_build_object('ok', false, 'reason', 'unknown_field', 'error', 'Query contains an unknown field.');
  end if;

  source := p_query->>'source';
  if source not in ('customers','mrr_monthly','cac_monthly','employees','reports','report_views_monthly','activity_heatmap') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_dataset', 'error', 'The query source is not approved.');
  end if;

  path := coalesce(nullif(p_query->'relationshipPath', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(path) <> 'array' or jsonb_array_length(path) > 1 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_relationship_path', 'error', 'The relationship path is invalid.');
  end if;
  relation_id := path->>0;
  joined_dataset := null;
  if jsonb_array_length(path) = 1 then
    if source = 'mrr_monthly' and relation_id = 'mrr_monthly_to_customers' then
      joined_dataset := 'customers';
    elsif source = 'report_views_monthly' and relation_id = 'report_views_monthly_to_reports' then
      joined_dataset := 'reports';
    else
      return jsonb_build_object('ok', false, 'reason', 'unknown_relationship', 'error', 'The relationship is not approved for this source.');
    end if;
  elsif relation_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_relationship_path', 'error', 'The relationship path is invalid.');
  end if;

  dimensions := p_query->'dimensions';
  measures := p_query->'measures';
  filters := coalesce(nullif(p_query->'filters', 'null'::jsonb), '[]'::jsonb);
  sort_keys := coalesce(nullif(p_query->'sort', 'null'::jsonb), '[]'::jsonb);
  if dimensions is null or measures is null or jsonb_typeof(dimensions) <> 'array' or jsonb_typeof(measures) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_query', 'error', 'Dimensions and measures must be arrays.');
  end if;
  if jsonb_array_length(dimensions) > 5 or jsonb_array_length(measures) < 1 or jsonb_array_length(measures) > 5 then
    return jsonb_build_object('ok', false, 'reason', 'limit_exceeded', 'error', 'The query shape exceeds the approved limits.');
  end if;
  if jsonb_typeof(filters) <> 'array' or jsonb_array_length(filters) > 10 or jsonb_typeof(sort_keys) <> 'array' or jsonb_array_length(sort_keys) > 3 then
    return jsonb_build_object('ok', false, 'reason', 'limit_exceeded', 'error', 'The query shape exceeds the approved limits.');
  end if;

  if (p_query ? 'limit' and jsonb_typeof(p_query->'limit') <> 'number')
     or (p_query ? 'offset' and jsonb_typeof(p_query->'offset') <> 'number')
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pagination', 'error', 'Pagination is outside the approved limits.');
  end if;
  limit_number := coalesce((p_query->>'limit')::numeric, 100);
  offset_number := coalesce((p_query->>'offset')::numeric, 0);
  if limit_number <> trunc(limit_number) or offset_number <> trunc(offset_number)
     or limit_number < 1 or limit_number > 500 or offset_number < 0 or offset_number > 100000 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_pagination', 'error', 'Pagination is outside the approved limits.');
  end if;
  limit_value := limit_number::integer;
  offset_value := offset_number::integer;
  time_grain := p_query->>'timeGrain';
  if time_grain is not null and time_grain <> 'month' then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_time_grain', 'error', 'Only month time grain is supported.');
  end if;

  from_expr := format(' %I s', source);
  if joined_dataset = 'customers' then
    from_expr := from_expr || ' join customers j1 on s.customer_id = j1.customer_id';
  elsif joined_dataset = 'reports' then
    from_expr := from_expr || ' join reports j1 on s.report_id = j1.report_id';
  end if;

  -- Source scan budget is checked before executing the aggregate. The tables
  -- are small today, but this remains an exact, fail-closed ceiling as they grow.
  execute format('select count(*) from %I', source) into source_rows;
  if source_rows > 100000 then
    return jsonb_build_object('ok', false, 'reason', 'limit_exceeded', 'error', 'The source exceeds the server scan budget.');
  end if;

  -- Dimensions: only catalogued fields and fields reachable from the path.
  for item in select value from jsonb_array_elements(dimensions) loop
    if jsonb_typeof(item) <> 'object' or exists (select 1 from jsonb_object_keys(item) key where key <> 'field')
       or jsonb_typeof(item->'field') <> 'object'
       or exists (select 1 from jsonb_object_keys(item->'field') key where key not in ('dataset','field')) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_dimension', 'error', 'A dimension is malformed.');
    end if;
    ref := item->'field';
    dataset := ref->>'dataset'; field := ref->>'field';
    if dataset is null or field is null or (dataset <> source and dataset <> joined_dataset) then
      return jsonb_build_object('ok', false, 'reason', 'field_not_in_path', 'error', 'A dimension is outside the relationship path.');
    end if;
    if (dataset = 'customers' and field not in ('customer_id','name','segment','plan_tier','region','channel','contract_type','signup_month','churn_month'))
       or (dataset = 'mrr_monthly' and field not in ('customer_id','month'))
       or (dataset = 'cac_monthly' and field <> 'month')
       or (dataset = 'employees' and field not in ('employee_id','department','region','hire_month','term_month'))
       or (dataset = 'reports' and field not in ('report_id','name','owner_team','created_month'))
       or (dataset = 'report_views_monthly' and field not in ('report_id','month'))
       or (dataset = 'activity_heatmap' and field not in ('weekday','hour_bucket')) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_dimension', 'error', 'The dimension is not approved.');
    end if;
    -- The catalog only exposes date dimensions for these named fields.
    if field in ('signup_month','churn_month','month','hire_month','term_month','created_month') then
      has_date_dimension := true;
    end if;
    if dataset = source then field_expr := format('s.%I', field); else field_expr := format('j1.%I', field); end if;
    if time_grain = 'month' and field in ('signup_month','churn_month','month','hire_month','term_month','created_month') then
      field_expr := format('date_trunc(''month'', %s)::date', field_expr);
    end if;
    if not is_first then select_expr := select_expr || ', '; end if;
    select_expr := select_expr || quote_literal(dataset || '.' || field) || ', ' || field_expr;
    if group_exprs <> '' then group_exprs := group_exprs || ', '; end if;
    group_exprs := group_exprs || field_expr;
    is_first := false;
    dimension_count := dimension_count + 1;
  end loop;
  if exists (select 1 from jsonb_array_elements(dimensions) d group by d->'field'->>'dataset', d->'field'->>'field' having count(*) > 1) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_dimension', 'error', 'A dimension is repeated.');
  end if;
  if time_grain = 'month' and not has_date_dimension then
    return jsonb_build_object('ok', false, 'reason', 'unsupported_time_grain', 'error', 'Month time grain requires a date dimension.');
  end if;

  -- Measures: each field/aggregate pair is selected from this fixed catalog.
  for item in select value from jsonb_array_elements(measures) loop
    if jsonb_typeof(item) <> 'object' or exists (select 1 from jsonb_object_keys(item) key where key not in ('field','aggregate'))
       or jsonb_typeof(item->'field') <> 'object'
       or exists (select 1 from jsonb_object_keys(item->'field') key where key not in ('dataset','field')) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_measure', 'error', 'A measure is malformed.');
    end if;
    ref := item->'field'; dataset := ref->>'dataset'; field := ref->>'field'; aggregate_name := item->>'aggregate';
    if dataset is null or field is null or (dataset <> source and dataset <> joined_dataset) then
      return jsonb_build_object('ok', false, 'reason', 'field_not_in_path', 'error', 'A measure is outside the relationship path.');
    end if;
    if dataset in ('customers','mrr_monthly','employees','reports','cac_monthly') and field in ('customer_id','employee_id','report_id','month') then
      if aggregate_name not in ('count','count_distinct') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_measure', 'error', 'This field only supports count aggregates.');
      end if;
    elsif (dataset = 'mrr_monthly' and field = 'mrr') or (dataset = 'cac_monthly' and field = 'cac')
       or (dataset = 'report_views_monthly' and field in ('views','unique_viewers','engagement_score'))
       or (dataset = 'activity_heatmap' and field = 'views') then
      if aggregate_name not in ('sum','avg','min','max') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_measure', 'error', 'The numeric aggregate is not approved.');
      end if;
    else
      return jsonb_build_object('ok', false, 'reason', 'invalid_measure', 'error', 'The measure field is not approved.');
    end if;
    if dataset = source then field_expr := format('s.%I', field); else field_expr := format('j1.%I', field); end if;
    if aggregate_name = 'count' then field_expr := format('count(%s)', field_expr);
    elsif aggregate_name = 'count_distinct' then field_expr := format('count(distinct %s)', field_expr);
    elsif aggregate_name = 'sum' then field_expr := format('sum(%s)', field_expr);
    elsif aggregate_name = 'avg' then field_expr := format('avg(%s)', field_expr);
    elsif aggregate_name = 'min' then field_expr := format('min(%s)', field_expr);
    elsif aggregate_name = 'max' then field_expr := format('max(%s)', field_expr);
    else
      return jsonb_build_object('ok', false, 'reason', 'invalid_measure', 'error', 'The aggregate is not approved.');
    end if;
    if not is_first then select_expr := select_expr || ', '; end if;
    select_expr := select_expr || quote_literal(dataset || '.' || field || ':' || aggregate_name) || ', ' || field_expr;
    is_first := false;
    measure_count := measure_count + 1;
  end loop;
  if exists (select 1 from jsonb_array_elements(measures) m group by m->'field'->>'dataset', m->'field'->>'field', m->>'aggregate' having count(*) > 1) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_measure', 'error', 'A measure is repeated.');
  end if;

  -- Filters: values are type checked before being safely quoted as SQL literals.
  for item in select value from jsonb_array_elements(filters) loop
    if jsonb_typeof(item) <> 'object' or exists (select 1 from jsonb_object_keys(item) key where key not in ('field','operator','value'))
       or jsonb_typeof(item->'field') <> 'object'
       or exists (select 1 from jsonb_object_keys(item->'field') key where key not in ('dataset','field')) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_filter', 'error', 'A filter is malformed.');
    end if;
    ref := item->'field'; dataset := ref->>'dataset'; field := ref->>'field'; operator_name := item->>'operator'; value_json := item->'value';
    if dataset is null or field is null or (dataset <> source and dataset <> joined_dataset) then
      return jsonb_build_object('ok', false, 'reason', 'field_not_in_path', 'error', 'A filter is outside the relationship path.');
    end if;
    -- Explicit filter catalog and field types mirror queryContract.ts.
    if dataset = 'customers' and field in ('customer_id','name','segment','plan_tier','region','channel','contract_type') then field_type := 'string';
    elsif dataset = 'customers' and field in ('signup_month','churn_month') then field_type := 'date';
    elsif dataset = 'mrr_monthly' and field = 'customer_id' then field_type := 'string';
    elsif dataset = 'mrr_monthly' and field = 'month' then field_type := 'date';
    elsif dataset = 'mrr_monthly' and field = 'mrr' then field_type := 'number';
    elsif dataset = 'mrr_monthly' and field in ('is_new','is_expansion','is_contraction','is_churned') then field_type := 'boolean';
    elsif dataset = 'cac_monthly' and field = 'month' then field_type := 'date';
    elsif dataset = 'cac_monthly' and field = 'cac' then field_type := 'number';
    elsif dataset = 'employees' and field = 'employee_id' then field_type := 'string';
    elsif dataset = 'employees' and field in ('department','region') then field_type := 'string';
    elsif dataset = 'employees' and field in ('hire_month','term_month') then field_type := 'date';
    elsif dataset = 'reports' and field in ('report_id','name','owner_team') then field_type := 'string';
    elsif dataset = 'reports' and field = 'created_month' then field_type := 'date';
    elsif dataset = 'report_views_monthly' and field = 'report_id' then field_type := 'string';
    elsif dataset = 'report_views_monthly' and field = 'month' then field_type := 'date';
    elsif dataset = 'report_views_monthly' and field in ('views','unique_viewers','engagement_score') then field_type := 'number';
    elsif dataset = 'activity_heatmap' and field in ('weekday','hour_bucket') then field_type := 'string';
    elsif dataset = 'activity_heatmap' and field = 'views' then field_type := 'number';
    else
      return jsonb_build_object('ok', false, 'reason', 'invalid_filter', 'error', 'The filter field is not approved.');
    end if;
    if operator_name not in ('eq','neq','in','not_in','gt','gte','lt','lte','is_null','is_not_null') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_operator', 'error', 'The filter operator is not approved.');
    end if;
    if operator_name in ('is_null','is_not_null') then
      if item ? 'value' then return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Null checks do not accept a value.'); end if;
    else
      if not (item ? 'value') then return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'A filter value is required.'); end if;
      if value_json is null or jsonb_typeof(value_json) = 'null' then
        if operator_name not in ('eq','neq') then return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Only equality filters accept null.'); end if;
      elsif operator_name in ('gt','gte','lt','lte') and field_type not in ('number','date') then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'The operator is not valid for this field type.');
      elsif operator_name in ('in','not_in') then
        if jsonb_typeof(value_json) <> 'array' or jsonb_array_length(value_json) < 1 or jsonb_array_length(value_json) > 50 then
          return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'Filter lists must contain 1 to 50 values.');
        end if;
      elsif jsonb_typeof(value_json) = 'array' then
        return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'A scalar filter value is required.');
      end if;
      if value_json is not null and jsonb_typeof(value_json) <> 'null' then
        if operator_name in ('in','not_in') then
          if exists (select 1 from jsonb_array_elements(value_json) v where
            (field_type = 'string' and (jsonb_typeof(v) <> 'string' or length(v #>> '{}') > 200)) or
            (field_type = 'number' and jsonb_typeof(v) <> 'number') or
            (field_type = 'boolean' and jsonb_typeof(v) <> 'boolean') or
            (field_type = 'date' and (jsonb_typeof(v) <> 'string' or (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(to_date(v #>> '{}', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v #>> '{}'))) then
            return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'A filter value has the wrong type.');
          end if;
        elsif (field_type = 'string' and (jsonb_typeof(value_json) <> 'string' or length(value_json #>> '{}') > 200)) or
              (field_type = 'number' and jsonb_typeof(value_json) <> 'number') or
              (field_type = 'boolean' and jsonb_typeof(value_json) <> 'boolean') or
              (field_type = 'date' and (jsonb_typeof(value_json) <> 'string' or (value_json #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or to_char(to_date(value_json #>> '{}', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> value_json #>> '{}')) then
          return jsonb_build_object('ok', false, 'reason', 'invalid_value', 'error', 'A filter value has the wrong type.');
        end if;
      end if;
    end if;
    if dataset = source then field_expr := format('s.%I', field); else field_expr := format('j1.%I', field); end if;
    if operator_name in ('is_null','is_not_null') then
      where_expr := where_expr || case when where_expr = '' then ' where ' else ' and ' end || field_expr || case when operator_name = 'is_null' then ' is null' else ' is not null' end;
    elsif value_json is null or jsonb_typeof(value_json) = 'null' then
      where_expr := where_expr || case when where_expr = '' then ' where ' else ' and ' end || field_expr || case when operator_name = 'eq' then ' is null' else ' is not null' end;
    elsif operator_name in ('in','not_in') then
      field_type := case field_type when 'number' then 'numeric' when 'date' then 'date' when 'boolean' then 'boolean' else 'text' end;
      where_expr := where_expr || case when where_expr = '' then ' where ' else ' and ' end || field_expr || case when operator_name = 'in' then ' = any (' else ' <> all (' end ||
        '(array[' || (select string_agg(quote_literal(v #>> '{}'), ',') from jsonb_array_elements(value_json) v) || ']::' || field_type || '[])';
    else
      field_type := case field_type when 'number' then 'numeric' when 'date' then 'date' when 'boolean' then 'boolean' else 'text' end;
      where_expr := where_expr || case when where_expr = '' then ' where ' else ' and ' end || field_expr || ' ' ||
        case operator_name when 'eq' then '=' when 'neq' then '<>' when 'gt' then '>' when 'gte' then '>=' when 'lt' then '<' when 'lte' then '<=' end || ' ' || quote_literal(value_json #>> '{}') || '::' || field_type;
    end if;
    filter_count := filter_count + 1;
  end loop;

  -- Sort keys are limited to selected dimensions/measures; use the same fixed
  -- field expressions and reject any unsanctioned expression.
  for item in select value from jsonb_array_elements(sort_keys) loop
    ref := item->'field'; dataset := ref->>'dataset'; field := ref->>'field';
    if jsonb_typeof(item) <> 'object' or exists (select 1 from jsonb_object_keys(item) key where key not in ('field','direction'))
       or jsonb_typeof(item->'field') <> 'object' or exists (select 1 from jsonb_object_keys(item->'field') key where key not in ('dataset','field'))
       or item->>'direction' not in ('asc','desc') or dataset is null or field is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_sort', 'error', 'A sort key is malformed.');
    end if;
    if dataset = source then field_expr := format('s.%I', field); elsif dataset = joined_dataset then field_expr := format('j1.%I', field); else
      return jsonb_build_object('ok', false, 'reason', 'field_not_in_path', 'error', 'A sort field is outside the relationship path.');
    end if;
    expected_key := dataset || '.' || field;
    if not exists (select 1 from jsonb_array_elements(dimensions) d where d->'field'->>'dataset' = dataset and d->'field'->>'field' = field)
       and not exists (select 1 from jsonb_array_elements(measures) m where m->'field'->>'dataset' = dataset and m->'field'->>'field' = field) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_sort', 'error', 'Sort fields must be selected dimensions or measures.');
    end if;
    if exists (select 1 from jsonb_array_elements(measures) m where m->'field'->>'dataset' = dataset and m->'field'->>'field' = field) then
      aggregate_name := (select m->>'aggregate' from jsonb_array_elements(measures) m where m->'field'->>'dataset' = dataset and m->'field'->>'field' = field limit 1);
      field_expr := format('%s(%s)', case aggregate_name when 'count_distinct' then 'count(distinct' else aggregate_name end, field_expr);
      if aggregate_name = 'count_distinct' then field_expr := field_expr || ')'; else field_expr := field_expr || ')'; end if;
    end if;
    order_expr := order_expr || case when order_expr = '' then ' order by ' else ', ' end || field_expr || ' ' || upper(item->>'direction');
    sort_count := sort_count + 1;
  end loop;

  select_expr := select_expr || ')';
  query_sql := 'select ' || select_expr || ' as row_data from' || from_expr || where_expr;
  if group_exprs <> '' then query_sql := query_sql || ' group by ' || group_exprs; end if;
  query_sql := query_sql || order_expr || format(' limit %s offset %s', limit_value + 1, offset_value);
  execute 'select coalesce(jsonb_agg(row_data), ''[]''::jsonb) from (' || query_sql || ') result' into rows;
  result_count := jsonb_array_length(rows);
  if octet_length(rows::text) > 1000000 then
    return jsonb_build_object('ok', false, 'reason', 'limit_exceeded', 'error', 'The aggregate response exceeds the server byte budget.');
  end if;
  if result_count > limit_value then
    rows := rows - (result_count - 1);
    result_count := limit_value;
    truncated := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'rows', rows,
      'metadata', jsonb_build_object(
        'sourceTables', case when joined_dataset is null then jsonb_build_array(source) else jsonb_build_array(source, joined_dataset) end,
        'relationshipPath', path,
        'truncated', truncated,
        'resultCount', result_count,
        'appliedLimits', jsonb_build_object('limit', limit_value, 'offset', offset_value, 'maxSourceRows', 100000, 'maxResponseBytes', 1000000, 'statementTimeoutMs', 5000)
      )
    )
  );
exception when others then
  -- Do not return SQL, credentials, or server internals to an untrusted caller.
  return jsonb_build_object('ok', false, 'reason', 'unavailable', 'error', 'Aggregate query could not be completed.');
end;
$$;

revoke all on function public.query_dataset_aggregate(jsonb) from public, anon, authenticated;
grant execute on function public.query_dataset_aggregate(jsonb) to service_role;
