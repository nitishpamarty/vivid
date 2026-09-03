import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.114.0';
import { observeRequest, rateLimitKey, rateLimiter, readJsonBody, requestLimits, withTimeout } from '../_shared/observability.ts';

// Capabilities are bearer secrets for the no-login demo. They are accepted
// only in the request body, hashed immediately, and never included in a
// response, error, audit message, or RPC argument in plaintext.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Type': 'application/json',
};

type JsonObject = Record<string, unknown>;

function response(body: unknown, status = 200): Response {
  const headers = { ...cors };
  if (status === 429 && body && typeof body === 'object' && 'retryAfterSeconds' in body) {
    headers['Retry-After'] = String((body as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function knownKeys(value: JsonObject, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validCapability(value: unknown): value is string {
  // The client currently creates 43-character URL-safe values. Keep the
  // endpoint slightly more permissive for future rotation formats while
  // requiring a URL-safe alphabet and enough length for a generated grant.
  // This is a shape check, not proof of entropy; the server still treats the
  // capability as a bearer secret and stores only its digest.
  return typeof value === 'string'
    && value.length >= 32
    && value.length <= 512
    && /^[A-Za-z0-9_-]+$/.test(value);
}

async function hashCapability(capability: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function actorKind(value: unknown): 'person' | 'agent' | 'system' {
  return value === 'agent' || value === 'system' ? value : 'person';
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function invalid(message: string, status = 400): Response {
  return response({ ok: false, reason: 'invalid_request', error: message }, status);
}

Deno.serve((request) => observeRequest(request, 'exploration-state', async () => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return invalid('POST is required.', 405);

  try {
    const parsed = await readJsonBody(request, requestLimits('mutation').maxBytes);
    if (!parsed.ok) {
      const quota = rateLimiter.take(await rateLimitKey(request), requestLimits('mutation').ratePerMinute);
      if (quota) return response(quota, 429);
      return response(parsed, parsed.reason === 'payload_too_large' ? 413 : 400);
    }
    const body = parsed.body as JsonObject;
    const quota = rateLimiter.take(await rateLimitKey(request, typeof body.capability === 'string' ? body.capability : undefined), requestLimits('mutation').ratePerMinute);
    if (quota) return response(quota, 429);
    if (!object(body) || typeof body.operation !== 'string') return invalid('A supported operation is required.');
    const url = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return response({ ok: false, reason: 'unavailable', error: 'Exploration persistence is not configured.' }, 503);
    const supabase = createClient(url, serviceRoleKey);
    const actor = actorKind(body.actor);

    if (body.operation === 'create_exploration') {
      if (!knownKeys(body, ['operation', 'name', 'schemaVersion', 'snapshot', 'capability', 'shares', 'actor'])
        || !validCapability(body.capability) || typeof body.name !== 'string' || body.name.trim().length === 0
        || body.name.length > 200 || body.schemaVersion !== 1 || !object(body.snapshot)) {
        return invalid('A name, schema version, snapshot, and high-entropy capability are required.');
      }
      const digest = await hashCapability(body.capability);
      const capabilities: Array<{ digest: string; role: 'owner' | 'editor' | 'viewer' }> = [{ digest, role: 'owner' }];
      if (body.shares !== undefined) {
        if (!Array.isArray(body.shares) || body.shares.length > 7) return invalid('Shares must contain at most seven capabilities.');
        for (const share of body.shares) {
          if (!object(share) || !knownKeys(share, ['capability', 'role']) || !validCapability(share.capability)
            || (share.role !== 'editor' && share.role !== 'viewer')) return invalid('Each share requires a high-entropy capability and editor or viewer role.');
          const role = share.role;
          capabilities.push({ digest: await hashCapability(share.capability), role });
        }
      }
      const rpc = await withTimeout(supabase.rpc('create_exploration', {
        p_name: body.name,
        p_schema_version: body.schemaVersion,
        p_snapshot: body.snapshot,
        p_capabilities: capabilities,
        p_actor_kind: actor,
      }), requestLimits('mutation').timeoutMs);
      if (rpc.timedOut) return response({ ok: false, reason: 'timeout', error: 'Exploration request timed out. Try again.' }, 504);
      const { data, error } = rpc.value;
      if (error) return response({ ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' }, 503);
      return response(data);
    }

    if (body.operation === 'list_explorations') {
      if (!knownKeys(body, ['operation', 'capability', 'actor']) || !validCapability(body.capability)) {
        return invalid('A high-entropy capability is required.');
      }
      const digest = await hashCapability(body.capability);
      const rpc = await withTimeout(supabase.rpc('list_explorations', {
        p_capability_digest: digest,
        p_actor_kind: actor,
      }), requestLimits('read').timeoutMs);
      if (rpc.timedOut) return response({ ok: false, reason: 'timeout', error: 'Exploration request timed out. Try again.' }, 504);
      const { data, error } = rpc.value;
      if (error) return response({ ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' }, 503);
      return response(data);
    }

    if (!knownKeys(body, ['operation', 'explorationId', 'capability', 'actor', 'expectedVersion', 'snapshot', 'action', 'mutationId', 'cardId', 'name'])
      || !validUuid(body.explorationId) || !validCapability(body.capability)) {
      return invalid('explorationId and a high-entropy capability are required.');
    }
    const digest = await hashCapability(body.capability);

    if (body.operation === 'open_exploration') {
      if (!knownKeys(body, ['operation', 'explorationId', 'capability', 'actor'])) return invalid('Open request contains an unknown field.');
      const rpc = await withTimeout(supabase.rpc('open_exploration', {
        p_exploration_id: body.explorationId,
        p_capability_digest: digest,
        p_actor_kind: actor,
      }), requestLimits('read').timeoutMs);
      if (rpc.timedOut) return response({ ok: false, reason: 'timeout', error: 'Exploration request timed out. Try again.' }, 504);
      const { data, error } = rpc.value;
      if (error) return response({ ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' }, 503);
      return response(data);
    }

    if (body.operation === 'mutate_exploration') {
      if (!knownKeys(body, ['operation', 'explorationId', 'capability', 'actor', 'expectedVersion', 'snapshot', 'action', 'mutationId', 'cardId', 'name'])
        || !validVersion(body.expectedVersion) || !object(body.snapshot)
        || typeof body.action !== 'string' || body.action.length === 0 || body.action.length > 40
        || typeof body.mutationId !== 'string' || body.mutationId.length === 0 || body.mutationId.length > 120
        || (body.cardId !== undefined && (typeof body.cardId !== 'string' || body.cardId.length === 0 || body.cardId.length > 120))
        || (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 200))) {
        return invalid('A bounded snapshot, action, mutationId, and expectedVersion are required.');
      }
      const rpc = await withTimeout(supabase.rpc('mutate_exploration', {
        p_exploration_id: body.explorationId,
        p_capability_digest: digest,
        p_expected_version: body.expectedVersion,
        p_snapshot: body.snapshot,
        p_action: body.action,
        p_mutation_id: body.mutationId,
        p_actor_kind: actor,
        p_card_id: body.cardId ?? null,
        p_name: body.name ?? null,
      }), requestLimits('mutation').timeoutMs);
      if (rpc.timedOut) return response({ ok: false, reason: 'timeout', error: 'Exploration request timed out. Try again.' }, 504);
      const { data, error } = rpc.value;
      if (error) return response({ ok: false, reason: 'unavailable', error: 'Exploration persistence is unavailable.' }, 503);
      // Broadcast only a non-sensitive version tick. Clients must still use
      // their own capability through open_exploration to retrieve the snapshot.
      if (object(data) && data.ok === true) {
        await supabase.channel(`exploration:${body.explorationId}`).send({
          type: 'broadcast', event: 'exploration_updated', payload: { version: (data.data as JsonObject | undefined)?.version },
        }).catch(() => {});
      }
      return response(data);
    }

    return invalid('Operation is not supported.');
  } catch {
    // Do not return parser errors, capability material, or upstream details.
    return invalid('Exploration persistence request was not understood.');
  }
}));
