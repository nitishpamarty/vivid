// Supabase puts non-2xx Edge Function envelopes on FunctionsHttpError.context.
// Read only our bounded reason codes; never surface provider/error objects.
const SAFE_REASONS = new Set(['rate_limited', 'payload_too_large', 'timeout', 'limit_exceeded', 'invalid_request', 'unauthorized', 'invalid_capability', 'version_conflict', 'not_found']);
const MESSAGES: Record<string, string> = {
  rate_limited: 'Request quota exceeded. Try again shortly.',
  payload_too_large: 'Request payload exceeds the allowed size.',
  timeout: 'Request timed out. Try a smaller request.',
  limit_exceeded: 'The request exceeds the server limits.',
  invalid_request: 'The request is invalid.',
  unauthorized: 'This operation is not authorized.',
  invalid_capability: 'The session capability is invalid or expired.',
  version_conflict: 'The data changed elsewhere; reload before saving.',
  not_found: 'The requested resource was not found.',
};

export async function readEdgeFunctionError(error: unknown): Promise<{ reason: string; error: string } | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json() as { reason?: unknown };
    const reason = typeof body.reason === 'string' && SAFE_REASONS.has(body.reason) ? body.reason : null;
    return reason ? { reason, error: MESSAGES[reason] } : null;
  } catch {
    return null;
  }
}
