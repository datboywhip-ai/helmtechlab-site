// Builds the AI news section: fetch feeds -> pick recent stories -> short summaries -> news.json + index.html.
// Run: node scripts/news/build-news.mjs   (Node 20+). Optional env: GEMINI_API_KEY, GEMINI_MODEL.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseFeed, select, renderNews, inject } from './lib.mjs';

const root = new URL('../../', import.meta.url);
const sources = JSON.parse(readFileSync(new URL('scripts/news/sources.json', root), 'utf8'));
const MIN_ITEMS = 4; // fewer than this means the feeds are broken; keep the current page

async function fetchFeed(src) {
  try {
    const r = await fetch(src.url, {
      headers: { 'user-agent': 'HelmTechLab-NewsBot/1.0 (+https://helmtechlab.com)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const items = parseFeed(await r.text());
    console.log(`  ${src.name}: ${items.length} items`);
    return { source: src.name, items };
  } catch (e) {
    console.log(`  ${src.name}: skipped (${e.message})`);
    return { source: src.name, items: [] };
  }
}

async function summarize(items) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) { console.log('No GEMINI_API_KEY: headlines only'); return items; }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest';
  const prompt = `You write one-sentence news summaries for an AI services company's website (audience: business owners and builders).
For each story, write ONE plain sentence (max 30 words) in your own words saying what happened and why it matters.
Rules: no quotes from the source, no hype, no invented facts beyond the title and snippet, no markdown.
Return JSON: [{"i": <index>, "summary": "<sentence>"}].
Stories:
${JSON.stringify(items.map((x, i) => ({ i, source: x.source, title: x.title, snippet: x.text })))}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.3 } }),
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const text = (await r.json()).candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '[]';
    const out = JSON.parse(text);
    const byI = new Map(out.map((o) => [o.i, String(o.summary || '').trim()]));
    console.log(`Summaries: ${byI.size}/${items.length} (${model})`);
    return items.map((x, i) => ({ ...x, summary: (byI.get(i) || '').slice(0, 280) }));
  } catch (e) {
    console.log(`Summaries skipped: ${e.message}`);
    return items;
  }
}

const now = new Date();
console.log('Fetching feeds...');
const all = await Promise.all(sources.map(fetchFeed));
let items = select(all, { now: now.getTime() });
console.log(`Selected ${items.length} stories`);
if (items.length < MIN_ITEMS) {
  console.log(`Only ${items.length} stories; keeping the current page.`);
  process.exit(0);
}
items = await summarize(items);
const clean = items.map(({ text, ...rest }) => rest); // feed snippets are never published
writeFileSync(new URL('news.json', root), JSON.stringify({ updated: now.toISOString(), items: clean }, null, 2) + '\n');
const indexUrl = new URL('index.html', root);
writeFileSync(indexUrl, inject(readFileSync(indexUrl, 'utf8'), renderNews(clean, now.toISOString())));
console.log('Wrote news.json and index.html');
