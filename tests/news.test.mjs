// Run: node tests/news.test.mjs   (Node 18+)
import assert from 'node:assert/strict';
import { parseFeed, select, renderNews, inject, esc } from '../scripts/news/lib.mjs';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

const rss = `<?xml version="1.0"?><rss><channel><title>Feed</title>
<item><title><![CDATA[Model X ships & beats <b>benchmarks</b>]]></title><link>https://ex.com/a?utm=1</link>
<pubDate>Thu, 29 Oct 2026 14:00:00 GMT</pubDate><description>&lt;p&gt;Long body text here&lt;/p&gt;</description></item>
<item><title>No link item</title><pubDate>Thu, 29 Oct 2026 14:00:00 GMT</pubDate></item>
<item><title>Old story</title><link>https://ex.com/old</link><pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate></item>
</channel></rss>`;
const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Atom &amp;amp; news</title>
<link rel="alternate" type="text/html" href="https://at.com/post"/><published>2026-10-30T09:00:00Z</published>
<summary>Short summary</summary></entry></feed>`;
const NOW = Date.parse('2026-10-31T12:00:00Z');

t('parses RSS: CDATA, entities, tags stripped, link required', () => {
  const items = parseFeed(rss);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Model X ships & beats benchmarks');
  assert.equal(items[0].url, 'https://ex.com/a?utm=1');
  assert.equal(items[0].date, '2026-10-29T14:00:00.000Z');
  assert.equal(items[0].text, 'Long body text here');
});

t('parses Atom alternate links', () => {
  const [a] = parseFeed(atom);
  assert.equal(a.url, 'https://at.com/post');
  assert.equal(a.title, 'Atom & news');
});

t('select: recent only, dedupe across sources, per-source cap, newest first', () => {
  const mk = (title, url, date) => ({ title, url, date, text: '' });
  const out = select([
    { source: 'A', items: [mk('One', 'https://a/1', '2026-10-30T00:00:00Z'), mk('Two', 'https://a/2', '2026-10-29T00:00:00Z'),
      mk('Three', 'https://a/3', '2026-10-28T00:00:00Z'), mk('Four', 'https://a/4', '2026-10-27T00:00:00Z'),
      mk('Ancient', 'https://a/5', '2026-09-01T00:00:00Z')] },
    { source: 'B', items: [mk('one!', 'https://b/1', '2026-10-31T00:00:00Z'), mk('Five', 'https://a/1?x=1', '2026-10-31T01:00:00Z'),
      mk('Six', 'https://b/6', '2026-10-31T02:00:00Z')] },
  ], { now: NOW, perSource: 3, max: 15 });
  assert.deepEqual(out.map((i) => i.title), ['Six', 'One', 'Two', 'Three']);
});

t('render escapes everything and never shows feed snippets', () => {
  const html = renderNews([{ source: '<S>', title: '"x" <script>', url: 'https://e.com/?a=1&b=2', date: '2026-10-30T00:00:00Z', summary: 'Sum & more', text: 'SECRET FEED TEXT' }], '2026-10-31T00:00:00Z');
  assert.ok(html.includes('&lt;S&gt;') && html.includes('&quot;x&quot; &lt;script&gt;') && html.includes('a=1&amp;b=2'));
  assert.ok(html.includes('Sum &amp; more') && !html.includes('SECRET FEED TEXT'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(renderNews([], '2026-10-31T00:00:00Z').includes('news-empty'));
});

t('inject replaces only the marked block and fails loudly without markers', () => {
  const page = 'a<!-- NEWS:START -->old<!-- NEWS:END -->b';
  assert.equal(inject(page, 'NEW'), 'a<!-- NEWS:START -->\nNEW\n  <!-- NEWS:END -->b');
  assert.equal(inject(inject(page, 'X'), 'Y'), 'a<!-- NEWS:START -->\nY\n  <!-- NEWS:END -->b');
  assert.throws(() => inject('no markers', 'x'));
  assert.equal(esc(`<'&">`), '&lt;&#39;&amp;&quot;&gt;');
});

console.log(`\n${n} passed`);
