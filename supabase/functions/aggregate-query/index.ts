import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.114.0';
import { observeRequest, rateLimitKey, rateLimiter, readJsonBody, requestLimits, withTimeout } from '../_shared/observability.ts';

// Query validation and SQL compilation live in the server-only RPC. This
// function is deliberately a thin transport boundary shared by UI/WebMCP.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
  'Content-Type': 'application/json',
};
const MAX_QUERY_BYTES = 64 * 1024;

function response(body: unknown, status = 200): Response {
  const headers = { ...cors };
  if (status === 429 && body && typeof body === 'object' && 'retryAfterSeconds' in body) {
    headers['Retry-After'] = String((body as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve((request) => observeRequest(request, 'aggregate-query', async () => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return response({ ok: false, reason: 'invalid_request', error: 'POST is required.' }, 405);
  try {
    const parsed = await readJsonBody(request, Math.min(MAX_QUERY_BYTES, requestLimits('query').maxBytes));
    if (!parsed.ok) {
      const quota = rateLimiter.take(await rateLimitKey(request), requestLimits('query').ratePerMinute);
      if (quota) return response(quota, 429);
      return response(parsed, parsed.reason === 'payload_too_large' ? 413 : 400);
    }
    const body = parsed.body as Record<string, unknown>;
    // This read path has no user capability. Use the edge proxy address so
    // the shared anonymous Supabase key does not create one global bucket.
    const quota = rateLimiter.take(await rateLimitKey(request), requestLimits('query').ratePerMinute);
    if (quota) return response(quota, 429);
    if (body?.operation !== 'query' || body?.query === undefined) {
      return response({ ok: false, reason: 'invalid_request', error: 'operation "query" and a QueryContract are required.' }, 400);
    }
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return response({ ok: false, reason: 'unavailable', error: 'Aggregate query service is not configured.' }, 503);
    const supabase = createClient(url, serviceRoleKey);
    const rpc = await withTimeout(supabase.rpc('query_dataset_aggregate', { p_query: body.query }), requestLimits('query').timeoutMs);
    if (rpc.timedOut) return response({ ok: false, reason: 'timeout', error: 'Aggregate query timed out. Try a smaller query.' }, 504);
    const { data, error } = rpc.value;
    if (error) return response({ ok: false, reason: 'unavailable', error: 'Aggregate query service is unavailable.' }, 503);
    return response(data);
  } catch {
    return response({ ok: false, reason: 'invalid_request', error: 'Aggregate query request was not understood.' }, 400);
  }
}));
