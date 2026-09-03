import {
  normalizeSemanticMetadata,
  type SemanticMetadata,
  type SemanticMetadataResult,
} from './semanticMetadata.ts';
import { readEdgeFunctionError } from './edgeFunctionErrors.ts';

export interface SemanticLayerResult<T = unknown> {
  ok: boolean;
  data?: T;
  reason?: string;
  error?: string;
}

export interface SemanticLayerTransport {
  invoke: (body: Record<string, unknown>) => Promise<SemanticLayerResult>;
}

export interface SemanticLayerClientOptions {
  /** Metadata is immutable for a deployment in normal use; refresh after this TTL. */
  metadataTtlMs?: number;
  now?: () => number;
}

const DEFAULT_METADATA_TTL_MS = 5 * 60 * 1_000;

async function invoke(body: Record<string, unknown>): Promise<SemanticLayerResult> {
  // Load the browser client only when a request is made. Besides keeping this
  // boundary easy to exercise in non-browser tests, credentials remain owned
  // by the existing Supabase module and never enter metadata state.
  const { supabase } = await import('./supabase.ts');
  const { data, error } = await supabase.functions.invoke('semantic-layer', { body });
  if (error) {
    const safe = await readEdgeFunctionError(error);
    return safe ? { ok: false, ...safe } : { ok: false, reason: 'unavailable', error: 'Semantic layer is unavailable. Try again.' };
  }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'unavailable', error: 'Semantic layer returned an invalid response.' };
  return data as SemanticLayerResult;
}

export interface SemanticLayerClient {
  getBusinessDefinitions: () => Promise<SemanticLayerResult<SemanticMetadata>>;
  queryBusinessMetric: (query: Record<string, unknown>) => Promise<SemanticLayerResult>;
  clearMetadataCache: () => void;
}

/**
 * Create a client with a short-lived, in-memory metadata cache. The transport
 * is injectable so normalization/cache behavior can be tested without a
 * browser or Supabase connection. Query responses are deliberately not cached.
 */
export function createSemanticLayerClient(
  transport: SemanticLayerTransport,
  options: SemanticLayerClientOptions = {},
): SemanticLayerClient {
  const ttl = Math.max(0, options.metadataTtlMs ?? DEFAULT_METADATA_TTL_MS);
  const now = options.now ?? (() => Date.now());
  let cached: { data: SemanticMetadata; expiresAt: number } | undefined;
  let pending: Promise<SemanticLayerResult<SemanticMetadata>> | undefined;

  const clearMetadataCache = () => { cached = undefined; };
  const getBusinessDefinitions = async (): Promise<SemanticLayerResult<SemanticMetadata>> => {
    if (cached && cached.expiresAt > now()) return { ok: true, data: cached.data };
    if (pending) return pending;
    pending = (async () => {
      let response: SemanticLayerResult;
      try {
        response = await transport.invoke({ operation: 'meta' });
      } catch {
        if (cached) return { ok: true, data: cached.data, reason: 'stale' };
        return { ok: false, reason: 'unavailable', error: 'Semantic layer is unavailable. Try again.' };
      }
      if (!response.ok) {
        // A stale snapshot is still a trusted Cube response and keeps an
        // already-open canvas usable during a transient metadata outage.
        if (cached) return { ok: true, data: cached.data, reason: 'stale' };
        return { ok: false, reason: response.reason ?? 'unavailable', error: response.error ?? 'Semantic layer is unavailable. Try again.' };
      }
      const normalized: SemanticMetadataResult = normalizeSemanticMetadata(response.data);
      if (!normalized.ok) {
        if (cached) return { ok: true, data: cached.data, reason: 'stale' };
        return normalized;
      }
      cached = { data: normalized.data, expiresAt: now() + ttl };
      return { ok: true, data: normalized.data };
    })().finally(() => { pending = undefined; });
    return pending;
  };

  return {
    getBusinessDefinitions,
    queryBusinessMetric: async (query) => {
      try { return await transport.invoke({ operation: 'query', query }); }
      catch { return { ok: false, reason: 'unavailable', error: 'Semantic layer is unavailable. Try again.' }; }
    },
    clearMetadataCache,
  };
}

const defaultClient = createSemanticLayerClient({ invoke });

export const getBusinessDefinitions = defaultClient.getBusinessDefinitions;
export const queryBusinessMetric = defaultClient.queryBusinessMetric;
export const clearSemanticMetadataCache = defaultClient.clearMetadataCache;

export { normalizeCubeMetadata, normalizeSemanticMetadata } from './semanticMetadata.ts';
export type {
  SemanticCubeDefinition,
  SemanticDimensionDefinition,
  SemanticFilterDefinition,
  SemanticFilterOperator,
  SemanticMeasureDefinition,
  SemanticMeasureType,
  SemanticMetadata,
  SemanticMetadataResult,
  NormalizedSemanticMetadata,
  SemanticRelationshipDefinition,
  SemanticValueType,
} from './semanticMetadata.ts';
