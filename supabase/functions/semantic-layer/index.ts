// Thin proxy to Cube Cloud, so CUBE_API_TOKEN never reaches the browser.
// "meta": Cube's schema (cubes/measures/dimensions) — what the agent grounds definitions in.
// "query": an actual Cube query (measures/dimensions/filters) — real numbers, same definitions.
import { observeRequest, rateLimitKey, rateLimiter, readJsonBody, requestLimits } from '../_shared/observability.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
  'Content-Type': 'application/json',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

const MAX_QUERY_BYTES = 64 * 1024;
const NAME = /^[A-Za-z0-9_.-]{1,200}$/;
const OPERATORS = new Set(['eq', 'neq', 'in', 'not_in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function known(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function name(value: unknown): value is string {
  return typeof value === 'string' && NAME.test(value);
}

function scalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.toISOString().slice(0, 10) === value;
}

/** Validate the semantic wire shape before it reaches Cube. */
function validQuery(value: unknown): value is Record<string, unknown> {
  if (!object(value) || !known(value, ['measures', 'dimensions', 'filters', 'timeDimensions', 'limit'])) return false;
  const measures = value.measures;
  if (!Array.isArray(measures) || measures.length < 1 || measures.length > 5 || measures.some((item) => !name(item))) return false;
  if (value.dimensions !== undefined && (!Array.isArray(value.dimensions) || value.dimensions.length > 5 || value.dimensions.some((item) => !name(item)))) return false;
  if (value.filters !== undefined) {
    if (!Array.isArray(value.filters) || value.filters.length > 10) return false;
    for (const filter of value.filters) {
      if (!object(filter) || !known(filter, ['member', 'operator', 'values']) || !name(filter.member)
        || typeof filter.operator !== 'string' || !OPERATORS.has(filter.operator)
        || !Array.isArray(filter.values) || filter.values.length > 50 || filter.values.some((item) => !scalar(item))) return false;
    }
  }
  if (value.timeDimensions !== undefined) {
    if (!Array.isArray(value.timeDimensions) || value.timeDimensions.length > 3) return false;
    for (const time of value.timeDimensions) {
      if (!object(time) || !known(time, ['dimension', 'granularity', 'dateRange']) || !name(time.dimension)) return false;
      if (time.granularity !== undefined && !['hour', 'day', 'week', 'month', 'quarter', 'year'].includes(String(time.granularity))) return false;
      if (time.dateRange !== undefined && (!Array.isArray(time.dateRange) || time.dateRange.length !== 2 || time.dateRange.some((item) => !validDate(item)))) return false;
    }
  }
  return typeof value.limit === 'number' && Number.isSafeInteger(value.limit) && value.limit >= 1 && value.limit <= 500;
}

Deno.serve((request) => observeRequest(request, 'semantic-layer', async () => {
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
    const quota = rateLimiter.take(await rateLimitKey(request), requestLimits('query').ratePerMinute);
    if (quota) return response(quota, 429);
    if (!object(body) || !known(body, ['operation', 'query'])) {
      return response({ ok: false, reason: 'invalid_request', error: 'Semantic request contains unknown fields.' }, 400);
    }
    const operation = body?.operation;
    if (operation !== 'meta' && operation !== 'query') {
      return response({ ok: false, reason: 'invalid_request', error: 'operation must be "meta" or "query".' }, 400);
    }
    if (operation === 'meta' && body.query !== undefined) {
      return response({ ok: false, reason: 'invalid_request', error: 'Metadata requests do not accept a query.' }, 400);
    }
    if (operation === 'query' && !validQuery(body.query)) {
      return response({ ok: false, reason: 'invalid_query', error: 'Semantic query is outside the approved limits.' }, 400);
    }

    const cubeUrl = Deno.env.get('CUBE_API_URL');
    const cubeToken = Deno.env.get('CUBE_API_TOKEN');
    if (!cubeUrl || !cubeToken) {
      return response({ ok: false, reason: 'unavailable', error: 'Semantic layer is not configured.' }, 503);
    }

    const url = operation === 'meta'
      ? `${cubeUrl}/cubejs-api/v1/meta`
      : `${cubeUrl}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(body.query ?? {}))}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestLimits('query').timeoutMs);
    let cubeResponse: Response;
    try {
      cubeResponse = await fetch(url, { headers: { Authorization: cubeToken }, signal: controller.signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return response({ ok: false, reason: 'timeout', error: 'Semantic query timed out. Try a smaller query.' }, 504);
      }
      return response({ ok: false, reason: 'unavailable', error: 'Semantic layer request failed.' }, 502);
    } finally {
      clearTimeout(timeout);
    }
    const data = await cubeResponse.json();
    if (!cubeResponse.ok) {
      // Upstream errors can contain SQL, credentials, or infrastructure
      // details. Keep the provider boundary intentionally opaque.
      return response({ ok: false, reason: 'unavailable', error: 'Semantic layer request failed.' }, 502);
    }
    return response({ ok: true, data });
  } catch {
    return response({ ok: false, reason: 'invalid_request', error: 'Semantic layer request was not understood.' }, 400);
  }
}));
