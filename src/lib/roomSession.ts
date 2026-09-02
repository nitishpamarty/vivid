export interface RoomSession {
  roomId: string;
  capability: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const CAPABILITY_BYTES = 32;

function randomCapability(): string {
  const bytes = new Uint8Array(CAPABILITY_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function createRoomSession(): RoomSession {
  return { roomId: crypto.randomUUID(), capability: randomCapability() };
}

export function parseRoomSession(input: string | URL): RoomSession | null {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input, 'http://localhost') : input;
  } catch {
    return null;
  }
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  const roomId = params.get('room');
  const capability = params.get('key');
  if (!roomId || !capability || !UUID.test(roomId) || !CAPABILITY.test(capability)) return null;
  return { roomId, capability };
}

export function buildRoomUrl(baseUrl: string | URL, session: RoomSession): string {
  const url = typeof baseUrl === 'string' ? new URL(baseUrl) : new URL(baseUrl.toString());
  url.searchParams.delete('room');
  url.searchParams.delete('key');
  url.hash = new URLSearchParams({ room: session.roomId, key: session.capability }).toString();
  return url.toString();
}
