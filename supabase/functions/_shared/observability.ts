// Small, dependency-free transport controls shared by the Edge Functions.
// Identity values are hashed for rate-limit keys and are never emitted.

export type RequestLimitFailure = {
  ok: false;
  reason: 'payload_too_large' | 'rate_limited';
  error: string;
  retryAfterSeconds?: number;
};

export type RequestBodyResult =
  | { ok: true; body: unknown; bytes: number }
  | RequestLimitFailure
  | { ok: false; reason: 'invalid_request'; error: string };

const encoder = new TextEncoder();

function boundedEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const runtime = globalThis as unknown as { Deno?: { env: { get: (key: string) => string | undefined } } };
  const value = Number(runtime.Deno?.env.get(name));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;
}

export function requestLimits(kind: 'query' | 'mutation' | 'read' = 'read') {
  return {
    maxBytes: boundedEnvNumber('VIVID_MAX_REQUEST_BYTES', 1_250_000, 16_384, 2_000_000),
    ratePerMinute: kind === 'mutation'
      ? boundedEnvNumber('VIVID_MUTATION_RATE_PER_MINUTE', 30, 1, 600)
      : kind === 'query'
        ? boundedEnvNumber('VIVID_QUERY_RATE_PER_MINUTE', 60, 1, 600)
        : boundedEnvNumber('VIVID_READ_RATE_PER_MINUTE', 120, 1, 600),
    windowMs: 60_000,
    timeoutMs: boundedEnvNumber('VIVID_REQUEST_TIMEOUT_MS', 5_000, 500, 10_000),
  } as const;
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<RequestBodyResult> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, reason: 'payload_too_large', error: 'Request payload exceeds the allowed size.' };
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'payload_too_large', error: 'Request payload exceeds the allowed size.' };
      }
      chunks.push(next.value);
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)), bytes: bytes.byteLength };
  } catch {
    return { ok: false, reason: 'invalid_request', error: 'Request body was not understood.' };
  }
}

export async function safeHash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Rate-limit by capability/principal when available, otherwise by the edge
 * proxy's client address. The key is an internal digest, never loggable data.
 */
export async function rateLimitKey(request: Request, identity?: string): Promise<string> {
  if (identity) return `identity:${await safeHash(identity)}`;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `address:${forwarded || 'unknown'}`;
}

export function createRateLimiter() {
  const windows = new Map<string, { startedAt: number; count: number }>();
  return {
    take(key: string, max: number, now = Date.now(), windowMs = 60_000): RequestLimitFailure | null {
      // Bound bookkeeping too: an attacker must not be able to exhaust the
      // isolate by presenting unlimited distinct capability strings.
      if (!windows.has(key) && windows.size >= 10_000) {
        const oldest = windows.keys().next().value;
        if (oldest) windows.delete(oldest);
      }
      const previous = windows.get(key);
      const current = !previous || now - previous.startedAt >= windowMs
        ? { startedAt: now, count: 0 }
        : previous;
      current.count += 1;
      windows.set(key, current);
      if (current.count <= max) return null;
      return {
        ok: false,
        reason: 'rate_limited',
        error: 'Request quota exceeded. Try again shortly.',
        retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + windowMs - now) / 1_000)),
      };
    },
  };
}

// One limiter per warm Edge Function isolate. This is intentionally a small
// first-line guard; deploy a shared gateway/Redis quota for multi-region
// enforcement when this fictional demo grows beyond one isolate.
export const rateLimiter = createRateLimiter();

export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    const result = await Promise.race([work.then((value) => ({ timedOut: false as const, value })), timeout]);
    return result as { timedOut: true } | { timedOut: false; value: T };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function requestId(): string {
  return crypto.randomUUID();
}

/** Structured, low-cardinality request telemetry. Never pass payloads here. */
export function logRequest(event: {
  requestId: string;
  route: string;
  status: number;
  startedAt: number;
  operation?: string;
  bodyBytes?: number;
}): void {
  console.info(JSON.stringify({
    event: 'vivid_request',
    requestId: event.requestId,
    route: event.route,
    operation: ['query', 'meta', 'create_room', 'mutate', 'create_exploration', 'open_exploration', 'list_explorations', 'mutate_exploration'].includes(event.operation ?? '') ? event.operation : undefined,
    status: event.status,
    outcome: event.status >= 500 ? 'error' : event.status >= 400 ? 'rejected' : 'ok',
    latencyMs: Math.max(0, Math.round(performance.now() - event.startedAt)),
    bodyBytes: event.bodyBytes,
  }));
}

export async function observeRequest(
  request: Request,
  route: string,
  handler: (requestId: string) => Promise<Response>,
): Promise<Response> {
  const id = requestId();
  const startedAt = performance.now();
  const declaredBytes = Number(request.headers.get('content-length'));
  const bodyBytes = Number.isFinite(declaredBytes) && declaredBytes >= 0 ? declaredBytes : undefined;
  try {
    const result = await handler(id);
    result.headers.set('X-Request-Id', id);
    logRequest({ requestId: id, route, status: result.status, startedAt, bodyBytes });
    return result;
  } catch (error) {
    logRequest({ requestId: id, route, status: 500, startedAt, bodyBytes });
    throw error;
  }
}
