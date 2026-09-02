import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.114.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

async function hashCapability(capability: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await request.json();
    const operation = body?.operation;
    const roomId = body?.roomId;
    const capability = body?.capability;
    if ((operation !== 'create_room' && operation !== 'mutate') || typeof roomId !== 'string' || typeof capability !== 'string') {
      return response({ ok: false, reason: 'invalid_request', error: 'roomId, capability, and a supported operation are required.' }, 400);
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const capabilityHash = await hashCapability(capability);
    const rpc = operation === 'create_room'
      ? supabase.rpc('create_room', { p_room_id: roomId, p_capability_hash: capabilityHash, p_state: body.state, p_schema_version: body.schemaVersion })
      : supabase.rpc('mutate_room', { p_room_id: roomId, p_capability_hash: capabilityHash, p_expected_version: body.expectedVersion, p_mutation: body.mutation });
    const { data, error } = await rpc;
    if (error) return response({ ok: false, reason: 'unavailable', error: 'Shared session is unavailable. Try again.' }, 503);
    return response(data);
  } catch {
    return response({ ok: false, reason: 'invalid_request', error: 'Shared-state request was not understood.' }, 400);
  }
});
