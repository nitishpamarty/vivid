import {
  QUERY_DATASET_CATALOG,
  RELATIONSHIP_CATALOG,
  getReachableDatasets,
  validateQueryContract,
  type NormalizedQueryContract,
  type QueryAggregate,
  type QueryDatasetId,
  type QueryFieldRef,
  type QueryFilter,
  type QueryFieldDefinition,
} from './queryContract.ts';
import type { ExploreChartContract } from './exploreAggregate.ts';

export interface CompositionField {
  ref: QueryFieldRef;
  definition: QueryFieldDefinition;
}

export interface ComposedChartInput {
  source: QueryDatasetId;
  relationshipPath: readonly string[];
  dimension: QueryFieldRef;
  measure: { field: QueryFieldRef; aggregate: QueryAggregate };
  filter?: QueryFilter;
  title?: string;
}

export type CompositionResult =
  | { ok: true; data: { query: NormalizedQueryContract; chart: ExploreChartContract } }
  | { ok: false; reason: string; error: string };

export function getRelationshipOptions(source: QueryDatasetId) {
  return RELATIONSHIP_CATALOG.filter(({ from }) => from === source);
}

export function getCompositionFields(source: QueryDatasetId, relationshipPath: readonly string[] = []): CompositionField[] {
  const datasets = getReachableDatasets(source, relationshipPath);
  return datasets.flatMap((dataset) => Object.entries(QUERY_DATASET_CATALOG[dataset].fields)
    .map(([field, definition]) => ({ ref: { dataset, field }, definition })));
}

const chartType = (type: QueryFieldDefinition['type']): 'nominal' | 'quantitative' | 'temporal' =>
  type === 'date' ? 'temporal' : type === 'number' ? 'quantitative' : 'nominal';

const chartAggregate = (aggregate: QueryAggregate): 'sum' | 'mean' | 'count' | 'min' | 'max' | undefined => {
  if (aggregate === 'avg') return 'mean';
  if (aggregate === 'count_distinct') return undefined;
  return aggregate;
};

/**
 * Build a chart card's query and intent-only chart contract from the explicit
 * relationship path. No join condition is accepted here: the query validator
 * resolves the path against RELATIONSHIP_CATALOG before this result is used.
 */
export function buildComposedChart(input: ComposedChartInput): CompositionResult {
  const query = {
    source: input.source,
    relationshipPath: [...input.relationshipPath],
    dimensions: [{ field: input.dimension }],
    measures: [input.measure],
    ...(input.filter ? { filters: [input.filter] } : {}),
    sort: [{ field: input.dimension, direction: 'asc' as const }],
    ...(QUERY_DATASET_CATALOG[input.dimension.dataset]?.fields[input.dimension.field]?.type === 'date'
      ? { timeGrain: 'month' as const } : {}),
    limit: 500,
  };
  const validated = validateQueryContract(query);
  if (!validated.ok) return validated;

  const dimensionDefinition = QUERY_DATASET_CATALOG[input.dimension.dataset]?.fields[input.dimension.field];
  const measureDefinition = QUERY_DATASET_CATALOG[input.measure.field.dataset]?.fields[input.measure.field.field];
  const aggregate = chartAggregate(input.measure.aggregate);
  if (!dimensionDefinition || !measureDefinition || !aggregate) {
    return { ok: false, reason: 'invalid_measure', error: 'The selected measure cannot be represented by the chart contract.' };
  }
  return {
    ok: true,
    data: {
      query: validated.data,
      chart: {
        version: 1,
        mark: 'bar',
        encoding: {
          x: { field: input.dimension.field, dataset: input.dimension.dataset, type: chartType(dimensionDefinition.type) },
          y: { field: input.measure.field.field, dataset: input.measure.field.dataset, type: 'quantitative', aggregate },
        },
        ...(input.title ? { title: input.title } : {}),
      },
    },
  };
}

