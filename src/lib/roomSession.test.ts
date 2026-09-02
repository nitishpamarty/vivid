import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoomUrl, createRoomSession, parseRoomSession } from './roomSession.ts';

test('creates a UUID and high-entropy URL-safe capability', () => {
  const session = createRoomSession();
  assert.match(session.roomId, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.match(session.capability, /^[A-Za-z0-9_-]{43}$/);
});

test('round-trips a room session in the fragment only', () => {
  const session = { roomId: '123e4567-e89b-12d3-a456-426614174000', capability: 'A'.repeat(43) };
  const url = buildRoomUrl('https://vividdata.pages.dev/?source=test', session);
  assert.equal(new URL(url).search, '?source=test');
  assert.equal(new URL(url).hash.startsWith('#room='), true);
  assert.deepEqual(parseRoomSession(url), session);
});

test('rejects missing, malformed, or query-string credentials', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(parseRoomSession('https://vividdata.pages.dev/'), null);
  assert.equal(parseRoomSession(`https://vividdata.pages.dev/#room=${id}`), null);
  assert.equal(parseRoomSession(`https://vividdata.pages.dev/?room=${id}&key=${'A'.repeat(43)}`), null);
  assert.equal(parseRoomSession(`https://vividdata.pages.dev/#room=bad&key=${'A'.repeat(43)}`), null);
  assert.equal(parseRoomSession('https://[invalid'), null);
});

test('keeps credentials out of query parameters when building a room URL', () => {
  const session = { roomId: '123e4567-e89b-12d3-a456-426614174000', capability: 'A'.repeat(43) };
  const url = new URL(buildRoomUrl('https://vividdata.pages.dev/?room=old&key=old', session));
  assert.equal(url.search, '');
  assert.equal(url.hash, `#room=${session.roomId}&key=${session.capability}`);
});
