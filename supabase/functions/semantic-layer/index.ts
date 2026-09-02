// Thin proxy to Cube Cloud, so CUBE_API_TOKEN never reaches the browser.
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const body = await request.json();
    const operation = body?.operation;
    if (operation !== 'meta' && operation !== 'query') {
      return response({ ok: false, reason: 'invalid_request', error: 'operation must be "meta" or "query".' }, 400);
    }

    const cubeUrl = Deno.env.get('CUBE_API_URL');
    const cubeToken = Deno.env.get('CUBE_API_TOKEN');
    if (!cubeUrl || !cubeToken) {
      return response({ ok: false, reason: 'unavailable', error: 'Semantic layer is not configured.' }, 503);
    }

    const url = operation === 'meta'
      ? `${cubeUrl}/cubejs-api/v1/meta`
      : `${cubeUrl}/cubejs-api/v1/load?query=${encodeURIComponent(JSON.stringify(body.query ?? {}))}`;

    const cubeResponse = await fetch(url, { headers: { Authorization: cubeToken } });
    const data = await cubeResponse.json();
    if (!cubeResponse.ok) {
      return response({ ok: false, reason: 'unavailable', error: data?.error ?? 'Semantic layer request failed.' }, 502);
    }
    return response({ ok: true, data });
  } catch {
    return response({ ok: false, reason: 'invalid_request', error: 'Semantic layer request was not understood.' }, 400);
  }
});
