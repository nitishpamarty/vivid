import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.114.0';
import { observeRequest, rateLimitKey, rateLimiter, readJsonBody, requestLimits, withTimeout } from '../_shared/observability.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
  'Content-Type': 'application/json',
};

async function hashCapability(capability: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function response(body: unknown, status = 200): Response {
  const headers = { ...cors };
  if (status === 429 && body && typeof body === 'object' && 'retryAfterSeconds' in body) {
    headers['Retry-After'] = String((body as { retryAfterSeconds?: number }).retryAfterSeconds ?? 60);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve((request) => observeRequest(request, 'shared-state', async () => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const parsed = await readJsonBody(request, requestLimits('mutation').maxBytes);
    if (!parsed.ok) {
      const quota = rateLimiter.take(await rateLimitKey(request), requestLimits('mutation').ratePerMinute);
      if (quota) return response(quota, 429);
      return response(parsed, parsed.reason === 'payload_too_large' ? 413 : 400);
    }
    const body = parsed.body as Record<string, unknown>;
    const quota = rateLimiter.take(await rateLimitKey(request, typeof body.capability === 'string' ? body.capability : undefined), requestLimits('mutation').ratePerMinute);
    if (quota) return response(quota, 429);
    const operation = body?.operation;
    const roomId = body?.roomId;
    const capability = body?.capability;
    const reportId = typeof body?.reportId === 'string' ? body.reportId : 'northbeam';
    if ((operation !== 'create_room' && operation !== 'mutate') || typeof roomId !== 'string' || typeof capability !== 'string') {
      return response({ ok: false, reason: 'invalid_request', error: 'roomId, capability, and a supported operation are required.' }, 400);
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const capabilityHash = await hashCapability(capability);
    const rpc = operation === 'create_room'
      ? supabase.rpc('create_room', { p_room_id: roomId, p_capability_hash: capabilityHash, p_state: body.state, p_schema_version: body.schemaVersion, p_report_id: reportId })
      : supabase.rpc('mutate_room', { p_room_id: roomId, p_capability_hash: capabilityHash, p_expected_version: body.expectedVersion, p_mutation: body.mutation, p_report_id: reportId });
    const result = await withTimeout(rpc, requestLimits('mutation').timeoutMs);
    if (result.timedOut) return response({ ok: false, reason: 'timeout', error: 'Shared session request timed out. Try again.' }, 504);
    const { data, error } = result.value;
    if (error) return response({ ok: false, reason: 'unavailable', error: 'Shared session is unavailable. Try again.' }, 503);
    return response(data);
  } catch {
    return response({ ok: false, reason: 'invalid_request', error: 'Shared-state request was not understood.' }, 400);
  }
}));
