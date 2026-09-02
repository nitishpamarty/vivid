// Thin proxy to Cube (see /cube), so CUBE_API_SECRET never reaches the browser.
// "meta": Cube's schema (cubes/measures/dimensions) — what the agent grounds definitions in.
// "query": an actual Cube query (measures/dimensions/filters) — real numbers, same definitions.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Cube's production auth (NODE_ENV=production / CUBEJS_DEV_MODE off) requires
// a JWT signed with CUBEJS_API_SECRET, not the raw secret as a bearer token.
// Short-lived since it's minted fresh per request anyway.
async function signCubeToken(secret: string, ttlSeconds = 300): Promise<string> {
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64url(enc.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await request.json();
    const operation = body?.operation;
    if (operation !== 'meta' && operation !== 'query') {
      return response({ ok: false, reason: 'invalid_request', error: 'operation must be "meta" or "query".' }, 400);
    }

    const cubeUrl = Deno.env.get('CUBE_API_URL');
    const cubeSecret = Deno.env.get('CUBE_API_SECRET');
    if (!cubeUrl || !cubeSecret) {
      return response({ ok: false, reason: 'unavailable', error: 'Semantic layer is not configured.' }, 503);
    }

    const url = operation === 'meta'
      ? `${cubeUrl}/cubejs-api/v1/meta`
      : `${cubeUrl}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(body.query ?? {}))}`;

    const token = await signCubeToken(cubeSecret);
    const cubeResponse = await fetch(url, { headers: { Authorization: token } });
    const data = await cubeResponse.json();
    if (!cubeResponse.ok) {
      return response({ ok: false, reason: 'unavailable', error: data?.error ?? 'Semantic layer request failed.' }, 502);
    }
    return response({ ok: true, data });
  } catch {
    return response({ ok: false, reason: 'invalid_request', error: 'Semantic layer request was not understood.' }, 400);
  }
});
