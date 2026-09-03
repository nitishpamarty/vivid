// The Cube meta endpoint is intentionally kept behind a small, provider-neutral
// boundary. Cube remains authoritative; this module only selects the metadata
// needed by the UI/tools and drops executable fields (notably SQL).

export const SEMANTIC_FILTER_OPERATORS = [
  'eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null',
] as const;

export type SemanticFilterOperator = (typeof SEMANTIC_FILTER_OPERATORS)[number];
export type SemanticValueType = 'string' | 'number' | 'boolean' | 'time' | 'unknown';
export type SemanticMeasureType = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'unknown';

export interface SemanticMeasureDefinition {
  name: string;
  title?: string;
  description?: string;
  /** Cube's result/value type (normally number). */
  type: SemanticValueType;
  /** Cube's aggregation type, when supplied by the metadata endpoint. */
  aggregation: SemanticMeasureType;
}

export interface SemanticDimensionDefinition {
  name: string;
  title?: string;
  description?: string;
  type: SemanticValueType;
  primaryKey: boolean;
}

export interface SemanticFilterDefinition {
  /** Fully-qualified Cube member name, suitable for a semantic query. */
  member: string;
  title?: string;
  description?: string;
  type: SemanticValueType;
  operators: readonly SemanticFilterOperator[];
}

export interface SemanticRelationshipDefinition {
  cube: string;
  targetCube: string;
  relationship: 'many_to_one' | 'one_to_many' | 'one_to_one' | 'many_to_many' | 'unknown';
}

export interface SemanticCubeDefinition {
  name: string;
  title?: string;
  description?: string;
  measures: readonly SemanticMeasureDefinition[];
  dimensions: readonly SemanticDimensionDefinition[];
  /** Filter members permitted by the metadata-backed semantic boundary. */
  filters: readonly SemanticFilterDefinition[];
  relationships: readonly SemanticRelationshipDefinition[];
}

export interface SemanticMetadata {
  cubes: readonly SemanticCubeDefinition[];
  relationships: readonly SemanticRelationshipDefinition[];
}

export type SemanticMetadataResult =
  | { ok: true; data: SemanticMetadata }
  | { ok: false; reason: 'invalid_metadata'; error: string };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const name = (value: unknown): value is string => text(value, 200) && /^[A-Za-z0-9_.-]+$/.test(value);

function description(value: unknown): string | undefined {
  return text(value) ? value : undefined;
}

function valueType(value: unknown): SemanticValueType {
  if (value === 'string') return 'string';
  if (value === 'number' || value === 'numeric') return 'number';
  if (value === 'boolean') return 'boolean';
  if (value === 'time' || value === 'date') return 'time';
  return 'unknown';
}

function measureType(value: unknown): SemanticMeasureType {
  return ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'].includes(String(value))
    ? value as SemanticMeasureType : 'unknown';
}

function memberName(cube: string, raw: unknown): string | undefined {
  if (!name(raw)) return undefined;
  return raw.includes('.') ? raw : `${cube}.${raw}`;
}

function operatorsFor(type: SemanticValueType): readonly SemanticFilterOperator[] {
  if (type === 'string') return ['eq', 'neq', 'in', 'not_in', 'is_null', 'is_not_null'];
  if (type === 'boolean') return ['eq', 'neq', 'is_null', 'is_not_null'];
  return SEMANTIC_FILTER_OPERATORS;
}

function arrayOrEmpty(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function relationship(cube: string, raw: unknown): SemanticRelationshipDefinition | undefined {
  if (!object(raw) || !name(raw.name)) return undefined;
  const kind = raw.relationship;
  const cardinality = ['many_to_one', 'one_to_many', 'one_to_one', 'many_to_many'].includes(String(kind))
    ? kind as SemanticRelationshipDefinition['relationship'] : 'unknown';
  return { cube, targetCube: raw.name, relationship: cardinality };
}

/**
 * Normalize the Cube meta response into a bounded, typed model. Unknown
 * optional fields are ignored, while malformed cubes/definitions are omitted;
 * an absent or malformed top-level `cubes` array fails closed.
 */
export function normalizeSemanticMetadata(input: unknown): SemanticMetadataResult {
  if (!object(input) || !Array.isArray(input.cubes)) {
    return { ok: false, reason: 'invalid_metadata', error: 'Semantic metadata did not contain a Cube list.' };
  }

  const cubes: SemanticCubeDefinition[] = [];
  const relationships: SemanticRelationshipDefinition[] = [];
  for (const rawCube of input.cubes) {
    if (!object(rawCube) || !name(rawCube.name)) continue;
    const cube = rawCube.name;
    const measures: SemanticMeasureDefinition[] = [];
    for (const raw of arrayOrEmpty(rawCube.measures)) {
      if (!object(raw) || !name(raw.name) || raw.public === false || raw.isVisible === false) continue;
      const rawDescription = description(raw.description);
      measures.push({
        name: raw.name,
        ...(text(raw.title) ? { title: raw.title } : {}),
        ...(rawDescription ? { description: rawDescription } : {}),
        type: valueType(raw.type === 'count' || raw.type === 'count_distinct' || raw.type === 'sum' || raw.type === 'avg' || raw.type === 'min' || raw.type === 'max' ? 'number' : raw.type),
        aggregation: measureType(raw.aggType ?? raw.type),
      });
    }
    const dimensions: SemanticDimensionDefinition[] = [];
    const filters: SemanticFilterDefinition[] = [];
    for (const raw of arrayOrEmpty(rawCube.dimensions)) {
      if (!object(raw) || !name(raw.name) || raw.public === false || raw.isVisible === false) continue;
      const type = valueType(raw.type);
      const rawDescription = description(raw.description);
      const dimension = {
        name: raw.name,
        ...(text(raw.title) ? { title: raw.title } : {}),
        ...(rawDescription ? { description: rawDescription } : {}),
        type, primaryKey: raw.primaryKey === true,
      } satisfies SemanticDimensionDefinition;
      dimensions.push(dimension);
      filters.push({
        member: memberName(cube, raw.name)!,
        ...(text(raw.title) ? { title: raw.title } : {}),
        ...(rawDescription ? { description: rawDescription } : {}),
        type, operators: operatorsFor(type),
      });
    }
    const localRelationships = arrayOrEmpty(rawCube.joins)
      .map((raw) => relationship(cube, raw)).filter((item): item is SemanticRelationshipDefinition => Boolean(item));
    relationships.push(...localRelationships);
    const rawDescription = description(rawCube.description);
    cubes.push({
      name: cube,
      ...(text(rawCube.title) ? { title: rawCube.title } : {}),
      ...(rawDescription ? { description: rawDescription } : {}),
      measures, dimensions, filters, relationships: localRelationships,
    });
  }
  if (cubes.length === 0) return { ok: false, reason: 'invalid_metadata', error: 'Semantic metadata did not contain any valid cubes.' };
  return { ok: true, data: { cubes, relationships } };
}

// Provider-oriented alias for callers that refer to the upstream payload as
// Cube metadata rather than semantic metadata.
export const normalizeCubeMetadata = normalizeSemanticMetadata;
export type NormalizedSemanticMetadata = SemanticMetadata;
