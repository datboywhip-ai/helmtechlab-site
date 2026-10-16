// Cloudflare Pages Function: POST /api/contact
// Delivery targets (configure at least one in Pages > Settings > Bindings / Variables):
//   LEADS             KV namespace binding   -> every lead is stored as lead:<time>:<id>
//   LEAD_WEBHOOK_URL  environment secret     -> every lead is also POSTed there as JSON
// With neither configured the endpoint answers 503 and the page falls back to email.

const LIMITS = { name: 120, email: 254, message: 4000 };
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra },
  });
}

function clean(value, max) {
  if (typeof value !== 'string') return '';
  // strip control characters except newline and tab, then trim
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export async function onRequestPost({ request, env }) {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    return json({ ok: false, error: 'bad_request' }, 415);
  }

  const origin = request.headers.get('origin');
  if (origin) {
    let sameOrigin = false;
    try { sameOrigin = new URL(origin).host === new URL(request.url).host; } catch { /* malformed origin */ }
    if (!sameOrigin) return json({ ok: false, error: 'forbidden' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad_request' }, 400);

  // Honeypot: real visitors never fill this field. Answer "ok" so bots learn nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true });

  const name = clean(body.name, LIMITS.name);
  const email = clean(body.email, LIMITS.email);
  const message = clean(body.message, LIMITS.message);

  const fields = {};
  if (!name) fields.name = 'Enter your name.';
  if (!EMAIL_RE.test(email)) fields.email = 'Enter a valid email address.';
  if (message.length < 10) fields.message = 'Tell us a little more (at least 10 characters).';
  if (Object.keys(fields).length) return json({ ok: false, error: 'invalid', fields }, 422);

  const hasKv = env && env.LEADS && typeof env.LEADS.put === 'function';
  const hasHook = env && typeof env.LEAD_WEBHOOK_URL === 'string' && env.LEAD_WEBHOOK_URL !== '';
  if (!hasKv && !hasHook) return json({ ok: false, error: 'not_configured' }, 503);

  const at = new Date().toISOString();
  const id = crypto.randomUUID();
  const lead = { id, at, name, email, message, source: 'helmtechlab.com' };

  let delivered = false;
  if (hasKv) {
    try { await env.LEADS.put(`lead:${at}:${id}`, JSON.stringify(lead)); delivered = true; } catch { /* try the webhook */ }
  }
  if (hasHook) {
    try {
      const res = await fetch(env.LEAD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(lead),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) delivered = true;
    } catch { /* reported below if nothing delivered */ }
  }

  if (!delivered) return json({ ok: false, error: 'delivery_failed' }, 502);
  return json({ ok: true });
}

export async function onRequest() {
  return json({ ok: false, error: 'method_not_allowed' }, 405, { allow: 'POST' });
}
