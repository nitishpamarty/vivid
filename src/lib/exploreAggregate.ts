import {
  QUERY_DATASET_CATALOG,
  RELATIONSHIP_CATALOG,
  validateQueryContract,
  type NormalizedQueryContract,
  type QueryAggregate,
  type QueryDatasetId,
  type QueryDimension,
  type QueryMeasure,
} from './queryContract.ts';
type ExploreAggregate = 'sum' | 'mean' | 'count' | 'min' | 'max';
const CHART_CONTRACT_VERSION = 1;
export type ExploreChannel = 'x' | 'y' | 'color' | 'theta';
export interface ExploreEncodingField {
  field: string;
  /** Optional catalog dataset for a field on an explicit relationship path. */
  dataset?: QueryDatasetId;
  type: 'quantitative' | 'nominal' | 'ordinal' | 'temporal';
  aggregate?: ExploreAggregate;
  bin?: boolean;
}
export interface ExploreChartContract {
  version?: number;
  mark: 'bar' | 'line' | 'point' | 'arc';
  encoding: Partial<Record<ExploreChannel, ExploreEncodingField>>;
  title?: string;
  tooltip?: boolean;
}

export interface AggregateChannelPlan {
  channel: ExploreChannel;
  sourceField: string;
  role: 'dimension' | 'measure';
  aggregate?: QueryAggregate;
  outputField: string;
  resultKey: string;
}

export interface AggregateChartPlan {
  query: NormalizedQueryContract;
  channels: AggregateChannelPlan[];
}

export type AggregatePlanResult =
  | { ok: true; data: AggregateChartPlan }
  | { ok: false; reason: string; error: string };

const aggregateMap: Record<ExploreAggregate, QueryAggregate> = {
  sum: 'sum',
  mean: 'avg',
  count: 'count',
  min: 'min',
  max: 'max',
};

const quantitativeFallback = (type: string): ExploreAggregate =>
  type === 'number' ? 'sum' : 'count';

const COUNT_FIELDS: Record<QueryDatasetId, string> = {
  customers: 'customer_id',
  mrr_monthly: 'customer_id',
  cac_monthly: 'month',
  employees: 'employee_id',
  reports: 'report_id',
  report_views_monthly: 'report_id',
  activity_heatmap: 'weekday',
};

function isMeasure(channel: ExploreChannel, encoding: ExploreEncodingField): boolean {
  // Vega's theta is a measure channel in the only mark that uses it. The
  // contract validator already guarantees arc/theta shape; this also keeps
  // all chart results aggregate-backed rather than passing raw rows through.
  return channel === 'theta' || encoding.type === 'quantitative' || encoding.aggregate !== undefined;
}

function resultKey(dataset: QueryDatasetId, field: string, role: AggregateChannelPlan['role'], aggregate?: QueryAggregate): string {
  return role === 'measure' ? `${dataset}.${field}:${aggregate}` : `${dataset}.${field}`;
}

/**
 * Compile the existing safe chart contract into the same typed query grammar
 * used by the aggregate Edge Function. No SQL, Vega data, or client table
 * names are accepted here.
 */
export function buildAggregateChartPlan(
  datasetId: string,
  contract: ExploreChartContract,
  relationshipPath: readonly string[] = [],
): AggregatePlanResult {
  if (!(datasetId in QUERY_DATASET_CATALOG)) {
    return { ok: false, reason: 'unknown_dataset', error: `"${datasetId}" is not an approved aggregate source.` };
  }
  if (contract.version !== undefined && contract.version !== CHART_CONTRACT_VERSION) {
    return { ok: false, reason: 'invalid_value', error: `"version" must be ${CHART_CONTRACT_VERSION}.` };
  }
  const channelsIn = Object.keys(contract.encoding);
  const unknownChannels = channelsIn.filter((channel) => !(['x', 'y', 'color', 'theta'] as string[]).includes(channel));
  if (unknownChannels.length > 0) {
    return { ok: false, reason: 'unknown_field', error: `Unknown chart channel(s): ${unknownChannels.join(', ')}.` };
  }
  if (contract.mark === 'arc') {
    if (!contract.encoding.theta) return { ok: false, reason: 'missing_channel', error: '"arc" requires a "theta" channel.' };
    if (contract.encoding.x || contract.encoding.y || contract.encoding.theta.type !== 'quantitative') {
      return { ok: false, reason: 'invalid_combination', error: '"arc" requires quantitative theta and does not support x or y.' };
    }
  } else if (!contract.encoding.x || !contract.encoding.y || contract.encoding.theta) {
    return { ok: false, reason: !contract.encoding.x || !contract.encoding.y ? 'missing_channel' : 'invalid_combination', error: `"${contract.mark}" requires x and y channels and does not support theta.` };
  }
  const dataset = datasetId as QueryDatasetId;
  const reachable = new Set<QueryDatasetId>([dataset]);
  let currentDataset = dataset;
  for (const relationshipId of relationshipPath) {
    const relationship = RELATIONSHIP_CATALOG.find(({ id }) => id === relationshipId);
    if (!relationship) return { ok: false, reason: 'unknown_relationship', error: `"${relationshipId}" is not an approved relationship.` };
    if (relationship.from !== currentDataset) {
      return { ok: false, reason: 'invalid_relationship_path', error: `Relationship "${relationshipId}" cannot follow dataset "${currentDataset}".` };
    }
    reachable.add(relationship.to);
    currentDataset = relationship.to;
  }
  const dimensions: QueryDimension[] = [];
  const measures: QueryMeasure[] = [];
  const dimensionKeys = new Set<string>();
  const measureKeys = new Set<string>();
  const channels: AggregateChannelPlan[] = [];

  for (const [channel, encoding] of Object.entries(contract.encoding) as [ExploreChannel, ExploreEncodingField][]) {
    if (!encoding) continue;
    if (encoding.bin) {
      return { ok: false, reason: 'unsupported_bin', error: 'Binned chart channels are not supported by the exact aggregate query yet.' };
    }
    const channelDataset = encoding.dataset ?? dataset;
    if (!reachable.has(channelDataset) || !QUERY_DATASET_CATALOG[channelDataset]) {
      return { ok: false, reason: 'field_not_in_path', error: `Chart field "${channelDataset}.${encoding.field}" is not in the approved relationship path.` };
    }
    const definition = QUERY_DATASET_CATALOG[channelDataset].fields[encoding.field];
    if (!definition) {
      return { ok: false, reason: 'unknown_field', error: `"${encoding.field}" is not an approved field on ${channelDataset}.` };
    }
    const measure = isMeasure(channel, encoding);
    const aggregate = measure ? aggregateMap[encoding.aggregate ?? quantitativeFallback(definition.type)] : undefined;
    // COUNT is row-count semantics. The QueryContract only exposes count on
    // declared key fields, so count a dataset key when a chart asks to count
    // a non-key categorical field (for example customers.name).
    const measureField = measure && aggregate === 'count' && !definition.aggregates?.includes('count')
      ? COUNT_FIELDS[channelDataset]
      : encoding.field;
    const key = `${channelDataset}.${encoding.field}`;

    if (measure) {
      const measureDefinition = QUERY_DATASET_CATALOG[channelDataset].fields[measureField];
      if (!measureDefinition?.aggregates?.includes(aggregate!)) {
        return { ok: false, reason: 'invalid_measure', error: `The aggregate ${aggregate} is not allowed for ${key}.` };
      }
      const measureKey = `${channelDataset}.${measureField}:${aggregate}`;
      if (!measureKeys.has(measureKey)) {
        measures.push({ field: { dataset: channelDataset, field: measureField }, aggregate: aggregate! });
        measureKeys.add(measureKey);
      }
    } else if (!dimensionKeys.has(key)) {
      dimensions.push({ field: { dataset: channelDataset, field: encoding.field } });
      dimensionKeys.add(key);
    }

    channels.push({
      channel,
      sourceField: encoding.field,
      role: measure ? 'measure' : 'dimension',
      ...(aggregate ? { aggregate } : {}),
      // Measure channels are aliased so a count of a dimension (the default
      // customers chart) cannot overwrite that same field's x/category value.
      outputField: measure ? `__vivid_${channel}` : encoding.field,
      resultKey: resultKey(channelDataset, measure ? measureField : encoding.field, measure ? 'measure' : 'dimension', aggregate),
    });
  }

  if (measures.length === 0) {
    return { ok: false, reason: 'invalid_measure', error: 'The chart needs at least one aggregate measure.' };
  }

  const firstDimension = dimensions[0]?.field;
  const hasDateDimension = dimensions.some(({ field }) => QUERY_DATASET_CATALOG[field.dataset].fields[field.field]?.type === 'date');
  const query = {
    source: dataset,
    ...(relationshipPath.length ? { relationshipPath: [...relationshipPath] } : {}),
    dimensions,
    measures,
    ...(firstDimension ? { sort: [{ field: firstDimension, direction: 'asc' as const }] } : {}),
    ...(hasDateDimension ? { timeGrain: 'month' as const } : {}),
    limit: 500,
  };
  const validated = validateQueryContract(query);
  if (!validated.ok) return validated;
  return { ok: true, data: { query: validated.data, channels } };
}

export function projectAggregateRows(plan: AggregateChartPlan, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(plan.channels.map((channel) => [channel.outputField, row[channel.resultKey] ?? null])));
}
