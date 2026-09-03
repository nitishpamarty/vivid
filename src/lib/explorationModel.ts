// Durable, provider-neutral domain types for the Exploration Canvas.
//
// These are data contracts, not validators or persistence code. Server-side
// boundaries must validate dataset ids, fields, relationship paths, semantic
// names, limits, and chart contracts before accepting any of these values.
// In particular, none of these types is a raw SQL or raw Vega-Lite escape
// hatch.

import type {
  ExploreAggregate,
  ExploreChannel,
  ExploreEncodingType,
  ExploreMark,
  CHART_CONTRACT_VERSION,
} from './datasets.ts';
import type {
  QueryContract as ValidatedDatasetQueryContract,
  QueryAggregate as DatasetQueryAggregate,
  QueryDimension as DatasetQueryDimension,
  QueryFieldRef as DatasetQueryFieldRef,
  QueryDatasetId,
  QueryFilterOperator as DatasetQueryFilterOperator,
  QueryFilter as DatasetQueryFilter,
  QueryMeasure as DatasetQueryMeasure,
  QuerySort as DatasetQuerySort,
} from './queryContract.ts';

export const EXPLORATION_SCHEMA_VERSION = 1 as const;

export type ExplorationId = string;
export type CardId = string;
export type MutationId = string;
export type AuditEventId = string;

// This is deliberately the catalog id, never a client-supplied Postgres table
// name. The catalog remains the source of truth for its fields and joins.
export type DatasetId = QueryDatasetId;

export interface DatasetSource {
  kind: 'dataset';
  datasetId: DatasetId;
}

export interface SemanticSource {
  kind: 'semantic';
  // Cube cube name, validated against server-returned semantic metadata.
  cube: string;
}

export type DataSource = DatasetSource | SemanticSource;

export type QueryScalar = string | number | boolean | null;
export type QueryAggregation = DatasetQueryAggregate;
/** Time grains available to semantic definitions. Dataset queries are narrower. */
export type SemanticQueryTimeGrain = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

// Compatibility names from the Phase 0 model now point at the canonical
// dataset-query vocabulary where applicable; they are not alternate
// field/aggregation shapes.
export type QueryFilterOperator = DatasetQueryFilterOperator;
export type QueryTimeGrain = SemanticQueryTimeGrain;
export type RelationshipRef = string;
export type QueryFieldRef = DatasetQueryFieldRef;
export type QueryDimension = DatasetQueryDimension;
export type QueryMeasure = DatasetQueryMeasure;
export type QueryFilter = DatasetQueryFilter;
export type QuerySort = DatasetQuerySort;

export interface SemanticFilter {
  member: string;
  operator: QueryFilterOperator;
  values: readonly QueryScalar[];
}

export interface SemanticTimeDimension {
  dimension: string;
  granularity?: SemanticQueryTimeGrain;
  dateRange?: readonly [string, string];
}

/** A Cube query by governed definition names; this is not the Cube wire payload. */
export interface SemanticQueryContract {
  kind: 'semantic';
  source: SemanticSource;
  measures: readonly string[];
  dimensions?: readonly string[];
  filters?: readonly SemanticFilter[];
  timeDimensions?: readonly SemanticTimeDimension[];
  limit: number;
}

/**
 * DatasetQueryContract is the validated Phase 1 query shape. Keep this alias
 * pointed at queryContract.ts so persisted canvas cards and validation cannot
 * drift into a second dataset-query grammar. Semantic queries remain a
 * separate variant because Cube definition names have different semantics.
 */
export type DatasetQueryContract = ValidatedDatasetQueryContract;
export type QueryContract = DatasetQueryContract | SemanticQueryContract;

// Mirrors the existing ExploreChartContract shape. Keeping this structurally
// compatible lets the current single-dataset chart continue to be adopted as
// the first canvas chart without storing a Vega spec.
export interface ChartEncoding {
  field: string;
  /** Present only when the chart query includes its field's approved source. */
  dataset?: QueryDatasetId;
  type: ExploreEncodingType;
  aggregate?: ExploreAggregate;
  bin?: boolean;
}

export interface ChartContract {
  version: typeof CHART_CONTRACT_VERSION;
  mark: ExploreMark;
  encoding: Partial<Record<ExploreChannel, ChartEncoding>>;
  title?: string;
  tooltip?: boolean;
}

export interface ChartCard {
  id: CardId;
  kind: 'chart';
  title?: string;
  query: QueryContract;
  chart: ChartContract;
  createdAt: string;
  updatedAt: string;
}

export interface TablePreviewCard {
  id: CardId;
  kind: 'table-preview';
  title?: string;
  source: DatasetSource;
  // Preview rows stay session-only. Persisted cards retain scope/provenance,
  // not an unbounded copy of the source table.
  preview?: {
    columns: readonly string[];
    rowCount: number;
    sampled: boolean;
    fetchedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface NoteCard {
  id: CardId;
  kind: 'note';
  title?: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuestionCard {
  id: CardId;
  kind: 'question';
  question: string;
  answerCardId?: CardId;
  createdAt: string;
  updatedAt: string;
}

export interface SemanticDefinitionRef {
  kind: 'measure' | 'dimension' | 'filter' | 'time_dimension';
  name: string;
  cube: string;
}

export interface BoundedQueryResult {
  columns: readonly string[];
  rows: readonly Readonly<Record<string, QueryScalar>>[];
  rowCount: number;
  truncated: boolean;
}

export interface AnswerCard {
  id: CardId;
  kind: 'metric-answer';
  title?: string;
  question: string;
  definitions: readonly SemanticDefinitionRef[];
  query: SemanticQueryContract;
  result: BoundedQueryResult;
  /** Human-readable answer derived from the bounded result, not a query. */
  summary: string;
  answeredAt: string;
  caveats: readonly string[];
  // A suggestion is data for a later explicit card mutation, never an
  // instruction to mutate an existing chart.
  suggestedChart?: ChartContract;
  createdAt: string;
  updatedAt: string;
}

export type CanvasCard = ChartCard | TablePreviewCard | NoteCard | QuestionCard | AnswerCard;

export type ExplorationRole = 'owner' | 'editor' | 'viewer';

export interface ExplorationCollaborator {
  subjectId: string;
  role: Exclude<ExplorationRole, 'owner'>;
}

export interface ExplorationOwnership {
  ownerId: string;
  collaborators?: readonly ExplorationCollaborator[];
}

export interface Exploration {
  schemaVersion: typeof EXPLORATION_SCHEMA_VERSION;
  id: ExplorationId;
  name: string;
  owner: ExplorationOwnership;
  cards: readonly CanvasCard[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ActorKind = 'person' | 'agent' | 'system';

export interface MutationActor {
  kind: ActorKind;
  subjectId?: string;
}

export type CanvasMutation =
  | { kind: 'create_card'; card: CanvasCard }
  | { kind: 'update_card'; cardId: CardId; card: CanvasCard }
  | { kind: 'remove_card'; cardId: CardId }
  | { kind: 'reorder_cards'; cardIds: readonly CardId[] }
  | { kind: 'rename_exploration'; name: string };

export interface VersionedMutation {
  id: MutationId;
  explorationId: ExplorationId;
  expectedVersion: number;
  mutation: CanvasMutation;
  actor: MutationActor;
  requestedAt: string;
}

export interface MutationConflict {
  currentVersion: number;
}

export type MutationResult =
  | { ok: true; exploration: Exploration; appliedVersion: number }
  | { ok: false; reason: 'version_conflict' | 'unauthorized' | 'invalid_mutation'; error: string; conflict?: MutationConflict };

export type AuditAction =
  | 'exploration_created'
  | 'exploration_opened'
  | 'card_created'
  | 'card_updated'
  | 'card_removed'
  | 'cards_reordered'
  | 'query_executed'
  | 'question_answered'
  | 'chart_suggested';

export interface AuditEvent {
  id: AuditEventId;
  explorationId: ExplorationId;
  version: number;
  action: AuditAction;
  actor: MutationActor;
  cardId?: CardId;
  mutationId?: MutationId;
  occurredAt: string;
}
