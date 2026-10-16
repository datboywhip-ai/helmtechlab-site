// Run: node tests/contact.test.mjs   (Node 18+)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// functions/api/contact.js is an ES module without a package.json, so load a copy as .mjs
const dir = mkdtempSync(join(tmpdir(), 'contact-'));
const file = join(dir, 'contact.mjs');
writeFileSync(file, readFileSync(new URL('../functions/api/contact.js', import.meta.url), 'utf8'));
const { onRequestPost, onRequest } = await import(file);

const URL_ = 'https://helmtechlab.com/api/contact';
const good = { name: 'Dana', email: 'dana@example.com', message: 'We need dispatch automation for 40 trucks.' };
const req = (body, headers = {}, raw) => new Request(URL_, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'https://helmtechlab.com', ...headers },
  body: raw ?? JSON.stringify(body),
});
const kv = () => { const store = new Map(); return { store, put: async (k, v) => { store.set(k, v); } }; };
const call = async (r, env) => { const res = await onRequestPost({ request: r, env }); return [res.status, await res.json()]; };

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

await t('stores a valid lead in KV', async () => {
  const LEADS = kv();
  const [s, b] = await call(req(good), { LEADS });
  assert.equal(s, 200); assert.equal(b.ok, true);
  assert.equal(LEADS.store.size, 1);
  const lead = JSON.parse([...LEADS.store.values()][0]);
  assert.equal(lead.email, 'dana@example.com'); assert.equal(lead.source, 'helmtechlab.com');
  assert.ok([...LEADS.store.keys()][0].startsWith('lead:'));
});
await t('503 when nothing is configured', async () => {
  const [s, b] = await call(req(good), {});
  assert.equal(s, 503); assert.equal(b.error, 'not_configured');
});
await t('422 with field messages for bad input', async () => {
  const [s, b] = await call(req({ name: '', email: 'nope', message: 'short' }), { LEADS: kv() });
  assert.equal(s, 422); assert.deepEqual(Object.keys(b.fields).sort(), ['email', 'message', 'name']);
});
await t('honeypot answers ok but stores nothing', async () => {
  const LEADS = kv();
  const [s, b] = await call(req({ ...good, website: 'http://spam' }), { LEADS });
  assert.equal(s, 200); assert.equal(b.ok, true); assert.equal(LEADS.store.size, 0);
});
await t('rejects cross-origin posts', async () => {
  const [s] = await call(req(good, { origin: 'https://evil.example' }), { LEADS: kv() });
  assert.equal(s, 403);
});
await t('rejects non-JSON content type and malformed JSON', async () => {
  assert.equal((await call(req(good, { 'content-type': 'text/plain' }), { LEADS: kv() }))[0], 415);
  assert.equal((await call(req(null, {}, '{oops'), { LEADS: kv() }))[0], 400);
});
await t('truncates oversized fields and strips control characters', async () => {
  const LEADS = kv();
  await call(req({ ...good, name: 'A\u0000B' + 'x'.repeat(500), message: 'm'.repeat(9000) }), { LEADS });
  const lead = JSON.parse([...LEADS.store.values()][0]);
  assert.equal(lead.name.length, 120); assert.ok(!lead.name.includes('\u0000')); assert.equal(lead.message.length, 4000);
});
await t('forwards to webhook; 502 when every target fails', async () => {
  const realFetch = globalThis.fetch; let seen;
  globalThis.fetch = async (u, o) => { seen = { u, body: JSON.parse(o.body) }; return new Response('ok', { status: 200 }); };
  let [s] = await call(req(good), { LEAD_WEBHOOK_URL: 'https://hooks.example/x' });
  assert.equal(s, 200); assert.equal(seen.u, 'https://hooks.example/x'); assert.equal(seen.body.name, 'Dana');
  globalThis.fetch = async () => new Response('no', { status: 500 });
  [s] = await call(req(good), { LEAD_WEBHOOK_URL: 'https://hooks.example/x' });
  assert.equal(s, 502);
  const bad = { put: async () => { throw new Error('kv down'); } };
  [s] = await call(req(good), { LEADS: bad });
  assert.equal(s, 502);
  globalThis.fetch = realFetch;
});
await t('non-POST methods get 405', async () => {
  const res = await onRequest(); assert.equal(res.status, 405); assert.equal(res.headers.get('allow'), 'POST');
});
console.log(`\n${n} passed`);
