// The narrow, data-only query grammar for Exploration Canvas work.
// This module validates intent; it deliberately does not compile SQL or
// execute a query. The server must apply the same catalog and limits again.

export const QUERY_DATASET_IDS = [
  'customers',
  'mrr_monthly',
  'cac_monthly',
  'employees',
  'reports',
  'report_views_monthly',
  'activity_heatmap',
] as const;

export type QueryDatasetId = (typeof QUERY_DATASET_IDS)[number];
export type QueryFieldType = 'string' | 'number' | 'boolean' | 'date';
export const QUERY_FIELD_TYPES = ['string', 'number', 'boolean', 'date'] as const;

export type QueryAggregate = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';
export const QUERY_AGGREGATES = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const;

// The source data is monthly. Exact date values remain available as filters,
// but no day/week/quarter/year rollups are promised by this contract.
export type QueryTimeGrain = 'month';
export const QUERY_TIME_GRAINS = ['month'] as const;

export type QueryFilterOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_null'
  | 'is_not_null';
export const QUERY_FILTER_OPERATORS = [
  'eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null',
] as const;

export type QuerySortDirection = 'asc' | 'desc';

export interface QueryFieldRef {
  dataset: QueryDatasetId;
  field: string;
}

export interface QueryDimension {
  field: QueryFieldRef;
}

export interface QueryMeasure {
  field: QueryFieldRef;
  aggregate: QueryAggregate;
}

export type QueryFilterValue = string | number | boolean | null | Array<string | number | boolean>;

export interface QueryFilter {
  field: QueryFieldRef;
  operator: QueryFilterOperator;
  value?: QueryFilterValue;
}

export interface QuerySort {
  field: QueryFieldRef;
  direction: QuerySortDirection;
}

export interface QueryContract {
  source: QueryDatasetId;
  /** Directed ids from the relationship catalog, in contiguous order. */
  relationshipPath?: string[];
  dimensions: QueryDimension[];
  measures: QueryMeasure[];
  filters?: QueryFilter[];
  sort?: QuerySort[];
  timeGrain?: QueryTimeGrain;
  limit?: number;
  offset?: number;
}

export interface NormalizedQueryContract extends QueryContract {
  relationshipPath: string[];
  filters: QueryFilter[];
  sort: QuerySort[];
  limit: number;
  offset: number;
}

export interface QueryFieldDefinition {
  type: QueryFieldType;
  /** A field may be grouped by when true. */
  dimension?: boolean;
  /** A field may be used in a WHERE filter when true. */
  filterable?: boolean;
  aggregates?: readonly QueryAggregate[];
}

export interface QueryDatasetDefinition {
  id: QueryDatasetId;
  table: QueryDatasetId;
  fields: Readonly<Record<string, QueryFieldDefinition>>;
}

export interface QueryRelationshipDefinition {
  id: string;
  from: QueryDatasetId;
  to: QueryDatasetId;
  localKey: string;
  foreignKey: string;
  cardinality: 'many_to_one';
}

const field = (
  type: QueryFieldType,
  options: Pick<QueryFieldDefinition, 'dimension' | 'filterable' | 'aggregates'> = {},
): QueryFieldDefinition => ({ type, ...options });

const counts = ['count', 'count_distinct'] as const;
const numeric = ['sum', 'avg', 'min', 'max'] as const;

// This catalog intentionally mirrors the seven tables and the fields exposed
// by their current Cube models. Flags in mrr_monthly are filter-only; they are
// not silently promoted to dimensions just because they exist in Postgres.
export const QUERY_DATASET_CATALOG: Readonly<Record<QueryDatasetId, QueryDatasetDefinition>> = {
  customers: {
    id: 'customers', table: 'customers', fields: {
      customer_id: field('string', { dimension: true, filterable: true, aggregates: counts }),
      name: field('string', { dimension: true, filterable: true }),
      segment: field('string', { dimension: true, filterable: true }),
      plan_tier: field('string', { dimension: true, filterable: true }),
      region: field('string', { dimension: true, filterable: true }),
      channel: field('string', { dimension: true, filterable: true }),
      contract_type: field('string', { dimension: true, filterable: true }),
      signup_month: field('date', { dimension: true, filterable: true }),
      churn_month: field('date', { dimension: true, filterable: true }),
    },
  },
  mrr_monthly: {
    id: 'mrr_monthly', table: 'mrr_monthly', fields: {
      customer_id: field('string', { dimension: true, filterable: true, aggregates: counts }),
      month: field('date', { dimension: true, filterable: true }),
      mrr: field('number', { filterable: true, aggregates: numeric }),
      is_new: field('boolean', { filterable: true }),
      is_expansion: field('boolean', { filterable: true }),
      is_contraction: field('boolean', { filterable: true }),
      is_churned: field('boolean', { filterable: true }),
    },
  },
  cac_monthly: {
    id: 'cac_monthly', table: 'cac_monthly', fields: {
      month: field('date', { dimension: true, filterable: true, aggregates: counts }),
      cac: field('number', { filterable: true, aggregates: numeric }),
    },
  },
  employees: {
    id: 'employees', table: 'employees', fields: {
      employee_id: field('string', { dimension: true, filterable: true, aggregates: counts }),
      department: field('string', { dimension: true, filterable: true }),
      region: field('string', { dimension: true, filterable: true }),
      hire_month: field('date', { dimension: true, filterable: true }),
      term_month: field('date', { dimension: true, filterable: true }),
    },
  },
  reports: {
    id: 'reports', table: 'reports', fields: {
      report_id: field('string', { dimension: true, filterable: true, aggregates: counts }),
      name: field('string', { dimension: true, filterable: true }),
      owner_team: field('string', { dimension: true, filterable: true }),
      created_month: field('date', { dimension: true, filterable: true }),
    },
  },
  report_views_monthly: {
    id: 'report_views_monthly', table: 'report_views_monthly', fields: {
      report_id: field('string', { dimension: true, filterable: true, aggregates: counts }),
      month: field('date', { dimension: true, filterable: true }),
      views: field('number', { filterable: true, aggregates: numeric }),
      unique_viewers: field('number', { filterable: true, aggregates: numeric }),
      engagement_score: field('number', { filterable: true, aggregates: numeric }),
    },
  },
  activity_heatmap: {
    id: 'activity_heatmap', table: 'activity_heatmap', fields: {
      weekday: field('string', { dimension: true, filterable: true, aggregates: counts }),
      hour_bucket: field('string', { dimension: true, filterable: true }),
      views: field('number', { filterable: true, aggregates: numeric }),
    },
  },
};

// These are the only cross-table paths. They are directional: the query
// starts at the fact table and may traverse to its keyed parent. In
// particular, shared names such as region and month do not create joins.
export const RELATIONSHIP_CATALOG: readonly QueryRelationshipDefinition[] = [
  {
    id: 'mrr_monthly_to_customers',
    from: 'mrr_monthly', to: 'customers',
    localKey: 'customer_id', foreignKey: 'customer_id', cardinality: 'many_to_one',
  },
  {
    id: 'report_views_monthly_to_reports',
    from: 'report_views_monthly', to: 'reports',
    localKey: 'report_id', foreignKey: 'report_id', cardinality: 'many_to_one',
  },
];

export const QUERY_LIMITS = {
  defaultLimit: 100,
  maxLimit: 500,
  maxOffset: 100_000,
  maxDimensions: 5,
  maxMeasures: 5,
  maxFilters: 10,
  maxSort: 3,
  maxFilterValues: 50,
  maxSourceRows: 100_000,
} as const;

export type QueryErrorReason =
  | 'invalid_query'
  | 'unknown_field'
  | 'unknown_dataset'
  | 'unknown_relationship'
  | 'invalid_relationship_path'
  | 'field_not_in_path'
  | 'invalid_dimension'
  | 'invalid_measure'
  | 'invalid_filter'
  | 'invalid_operator'
  | 'invalid_value'
  | 'invalid_sort'
  | 'unsupported_time_grain'
  | 'invalid_pagination'
  | 'limit_exceeded';

export type QueryValidationResult =
  | { ok: true; data: NormalizedQueryContract }
  | { ok: false; reason: QueryErrorReason; error: string };

const QUERY_KEYS = ['source', 'relationshipPath', 'dimensions', 'measures', 'filters', 'sort', 'timeGrain', 'limit', 'offset'];
const FIELD_REF_KEYS = ['dataset', 'field'];
const onlyKnownKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isDataset = (value: unknown): value is QueryDatasetId => typeof value === 'string' && (QUERY_DATASET_IDS as readonly string[]).includes(value);
const displayValue = (value: unknown): string => value === null ? 'null' : value === undefined ? 'undefined' : typeof value === 'string' ? value : typeof value;
const fail = (reason: QueryErrorReason, error: string): QueryValidationResult => ({ ok: false, reason, error });

function definitionFor(ref: unknown): { ref: QueryFieldRef; definition: QueryFieldDefinition } | null {
  if (!isObject(ref) || !onlyKnownKeys(ref, FIELD_REF_KEYS) || !isDataset(ref.dataset) || typeof ref.field !== 'string') return null;
  const fields = QUERY_DATASET_CATALOG[ref.dataset].fields;
  if (!Object.prototype.hasOwnProperty.call(fields, ref.field)) return null;
  const definition = fields[ref.field];
  return definition ? { ref: { dataset: ref.dataset, field: ref.field }, definition } : null;
}

function validateFilterValue(value: unknown, type: QueryFieldType, operator: QueryFilterOperator): boolean {
  if (operator === 'is_null' || operator === 'is_not_null') return value === undefined;
  const equalityOperators = ['eq', 'neq', 'in', 'not_in'];
  if (!equalityOperators.includes(operator) && type !== 'number' && type !== 'date') return false;
  // Membership predicates are deliberately array-only. Accepting a scalar
  // here creates an ambiguous wire shape and makes it too easy for a caller
  // to accidentally broaden a query while compiling it server-side.
  if ((operator === 'in' || operator === 'not_in') && !Array.isArray(value)) return false;
  if (value === null) return operator === 'eq' || operator === 'neq';
  const values = Array.isArray(value) ? value : [value];
  if ((operator === 'in' || operator === 'not_in') && (values.length === 0 || values.length > QUERY_LIMITS.maxFilterValues)) return false;
  if (operator !== 'in' && operator !== 'not_in' && Array.isArray(value)) return false;
  return values.every((item) => {
    if (type === 'string') return typeof item === 'string' && item.length <= 200;
    if (type === 'date') return typeof item === 'string' && isIsoDate(item);
    if (type === 'number') return typeof item === 'number' && Number.isFinite(item);
    return typeof item === 'boolean';
  });
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() === Number(match[2]) - 1
    && date.getUTCDate() === Number(match[3]);
}

function reachableDatasets(source: QueryDatasetId, path: string[]): Set<QueryDatasetId> {
  const result = new Set<QueryDatasetId>([source]);
  let current = source;
  for (const id of path) {
    const relation = RELATIONSHIP_CATALOG.find((candidate) => candidate.id === id);
    if (!relation || relation.from !== current) break;
    result.add(relation.to);
    current = relation.to;
  }
  return result;
}

export function validateQueryContract(input: unknown): QueryValidationResult {
  if (!isObject(input)) return fail('invalid_query', 'Query contract must be an object.');
  const unknownKeys = Object.keys(input).filter((key) => !QUERY_KEYS.includes(key));
  if (unknownKeys.length > 0) return fail('unknown_field', `Unknown query field(s): ${unknownKeys.join(', ')}.`);
  if (!isDataset(input.source)) return fail('unknown_dataset', `"source" must be one of: ${QUERY_DATASET_IDS.join(', ')}.`);

  const source = input.source;
  const path = input.relationshipPath ?? [];
  if (!Array.isArray(path) || path.some((id) => typeof id !== 'string')) {
    return fail('invalid_relationship_path', '"relationshipPath" must be an array of relationship ids.');
  }
  let current = source;
  const reachable = new Set<QueryDatasetId>([source]);
  const seenRelationships = new Set<string>();
  for (const id of path) {
    const relation = RELATIONSHIP_CATALOG.find((candidate) => candidate.id === id);
    if (!relation) return fail('unknown_relationship', `"${id}" is not an approved relationship.`);
    if (seenRelationships.has(id)) return fail('invalid_relationship_path', `Relationship "${id}" may appear only once in a path.`);
    if (relation.from !== current) return fail('invalid_relationship_path', `Relationship "${id}" cannot follow dataset "${current}".`);
    const local = QUERY_DATASET_CATALOG[relation.from].fields[relation.localKey];
    const foreign = QUERY_DATASET_CATALOG[relation.to].fields[relation.foreignKey];
    if (!local || !foreign || local.type !== foreign.type) return fail('invalid_relationship_path', `Relationship "${id}" does not connect declared compatible key fields.`);
    reachable.add(relation.to);
    seenRelationships.add(id);
    current = relation.to;
  }

  const dimensionsIn = input.dimensions;
  const measuresIn = input.measures;
  if (!Array.isArray(dimensionsIn) || !Array.isArray(measuresIn)) return fail('invalid_query', '"dimensions" and "measures" must be arrays.');
  if (dimensionsIn.length > QUERY_LIMITS.maxDimensions) return fail('limit_exceeded', `At most ${QUERY_LIMITS.maxDimensions} dimensions are allowed.`);
  if (measuresIn.length === 0 || measuresIn.length > QUERY_LIMITS.maxMeasures) return fail('limit_exceeded', `One to ${QUERY_LIMITS.maxMeasures} measures are required.`);

  const dimensions: QueryDimension[] = [];
  const dimensionKeys = new Set<string>();
  for (const item of dimensionsIn) {
    if (!isObject(item) || !onlyKnownKeys(item, ['field'])) return fail('unknown_field', 'Each dimension may contain only a field reference.');
    const resolved = definitionFor(isObject(item) ? item.field : undefined);
    if (!resolved) return fail('unknown_field', 'Each dimension must reference a known dataset field.');
    if (!reachable.has(resolved.ref.dataset)) return fail('field_not_in_path', `Dimension field "${resolved.ref.dataset}.${resolved.ref.field}" is not in the approved relationship path.`);
    if (!resolved.definition.dimension) return fail('invalid_dimension', `Field "${resolved.ref.dataset}.${resolved.ref.field}" is not an allowed dimension.`);
    const key = `${resolved.ref.dataset}.${resolved.ref.field}`;
    if (dimensionKeys.has(key)) return fail('invalid_dimension', `Dimension "${key}" is repeated.`);
    dimensionKeys.add(key);
    dimensions.push({ field: resolved.ref });
  }

  const measures: QueryMeasure[] = [];
  const measureKeys = new Set<string>();
  for (const item of measuresIn) {
    if (!isObject(item)) return fail('invalid_measure', 'Each measure must be an object.');
    if (!onlyKnownKeys(item, ['field', 'aggregate'])) return fail('unknown_field', 'Each measure may contain only a field and aggregate.');
    const resolved = definitionFor(item.field);
    if (!resolved) return fail('unknown_field', 'Each measure must reference a known dataset field.');
    if (!reachable.has(resolved.ref.dataset)) return fail('field_not_in_path', `Measure field "${resolved.ref.dataset}.${resolved.ref.field}" is not in the approved relationship path.`);
    if (!resolved.definition.aggregates || typeof item.aggregate !== 'string' || !resolved.definition.aggregates.includes(item.aggregate as QueryAggregate)) {
      return fail('invalid_measure', `Aggregate "${displayValue(item.aggregate)}" is not allowed for "${resolved.ref.dataset}.${resolved.ref.field}".`);
    }
    const key = `${resolved.ref.dataset}.${resolved.ref.field}:${item.aggregate}`;
    if (measureKeys.has(key)) return fail('invalid_measure', `Measure "${key}" is repeated.`);
    measureKeys.add(key);
    measures.push({ field: resolved.ref, aggregate: item.aggregate as QueryAggregate });
  }

  const filtersIn = input.filters ?? [];
  if (!Array.isArray(filtersIn)) return fail('invalid_filter', '"filters" must be an array.');
  if (filtersIn.length > QUERY_LIMITS.maxFilters) return fail('limit_exceeded', `At most ${QUERY_LIMITS.maxFilters} filters are allowed.`);
  const filters: QueryFilter[] = [];
  for (const item of filtersIn) {
    if (!isObject(item)) return fail('invalid_filter', 'Each filter must be an object.');
    if (!onlyKnownKeys(item, ['field', 'operator', 'value'])) return fail('unknown_field', 'Each filter may contain only a field, operator, and value.');
    const resolved = definitionFor(item.field);
    if (!resolved) return fail('unknown_field', 'Each filter must reference a known dataset field.');
    if (!reachable.has(resolved.ref.dataset)) return fail('field_not_in_path', `Filter field "${resolved.ref.dataset}.${resolved.ref.field}" is not in the approved relationship path.`);
    if (!resolved.definition.filterable) return fail('invalid_filter', `Field "${resolved.ref.dataset}.${resolved.ref.field}" is not filterable.`);
    if (typeof item.operator !== 'string' || !(QUERY_FILTER_OPERATORS as readonly string[]).includes(item.operator)) return fail('invalid_operator', `Filter operator must be one of: ${QUERY_FILTER_OPERATORS.join(', ')}.`);
    const operator = item.operator as QueryFilterOperator;
    if (!validateFilterValue(item.value, resolved.definition.type, operator)) return fail('invalid_value', `Filter value does not match ${resolved.definition.type} for operator "${operator}".`);
    filters.push({ field: resolved.ref, operator, ...(item.value !== undefined ? { value: item.value as QueryFilterValue } : {}) });
  }

  const sortIn = input.sort ?? [];
  if (!Array.isArray(sortIn)) return fail('invalid_sort', '"sort" must be an array.');
  if (sortIn.length > QUERY_LIMITS.maxSort) return fail('limit_exceeded', `At most ${QUERY_LIMITS.maxSort} sort fields are allowed.`);
  const sort: QuerySort[] = [];
  const sortKeys = new Set<string>();
  for (const item of sortIn) {
    if (!isObject(item) || (item.direction !== 'asc' && item.direction !== 'desc')) return fail('invalid_sort', 'Each sort must contain direction "asc" or "desc".');
    if (!onlyKnownKeys(item, ['field', 'direction'])) return fail('unknown_field', 'Each sort may contain only a field and direction.');
    const resolved = definitionFor(item.field);
    if (!resolved) return fail('unknown_field', 'Each sort must reference a known dataset field.');
    if (!reachable.has(resolved.ref.dataset)) return fail('field_not_in_path', `Sort field "${resolved.ref.dataset}.${resolved.ref.field}" is not in the approved relationship path.`);
    const key = `${resolved.ref.dataset}.${resolved.ref.field}`;
    if (!dimensionKeys.has(key) && ![...measureKeys].some((measure) => measure.startsWith(`${key}:`))) return fail('invalid_sort', `Sort field "${key}" must also be selected as a dimension or measure.`);
    if (sortKeys.has(key)) return fail('invalid_sort', `Sort field "${key}" is repeated.`);
    sortKeys.add(key);
    sort.push({ field: resolved.ref, direction: item.direction });
  }

  if (input.timeGrain !== undefined && (input.timeGrain !== 'month' || !dimensions.some(({ field: ref }) => QUERY_DATASET_CATALOG[ref.dataset].fields[ref.field].type === 'date'))) {
    return fail('unsupported_time_grain', 'Only month time grain is supported, and it requires a date dimension.');
  }
  const limit = input.limit === undefined ? QUERY_LIMITS.defaultLimit : typeof input.limit === 'number' ? input.limit : Number.NaN;
  const offset = input.offset === undefined ? 0 : typeof input.offset === 'number' ? input.offset : Number.NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > QUERY_LIMITS.maxLimit || !Number.isInteger(offset) || offset < 0 || offset > QUERY_LIMITS.maxOffset) {
    return fail('invalid_pagination', `Pagination must use an integer limit from 1 to ${QUERY_LIMITS.maxLimit} and offset from 0 to ${QUERY_LIMITS.maxOffset}.`);
  }

  return {
    ok: true,
    data: {
      source,
      relationshipPath: [...path],
      dimensions,
      measures,
      filters,
      sort,
      ...(input.timeGrain !== undefined ? { timeGrain: 'month' as const } : {}),
      limit,
      offset,
    },
  };
}

export function getReachableDatasets(source: QueryDatasetId, relationshipPath: readonly string[] = []): QueryDatasetId[] {
  return [...reachableDatasets(source, [...relationshipPath])];
}
