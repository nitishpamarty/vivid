import { supabase } from './supabase.ts';

export interface SemanticLayerResult {
  ok: boolean;
  data?: unknown;
  reason?: string;
  error?: string;
}

async function invoke(body: Record<string, unknown>): Promise<SemanticLayerResult> {
  const { data, error } = await supabase.functions.invoke('semantic-layer', { body });
  if (error) return { ok: false, reason: 'unavailable', error: 'Semantic layer is unavailable. Try again.' };
  return data as SemanticLayerResult;
}

export function getBusinessDefinitions(): Promise<SemanticLayerResult> {
  return invoke({ operation: 'meta' });
}

export function queryBusinessMetric(query: Record<string, unknown>): Promise<SemanticLayerResult> {
  return invoke({ operation: 'query', query });
}
