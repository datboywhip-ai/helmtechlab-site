// Pure helpers for the AI news feed (no dependencies, no network). Tested in tests/news.test.mjs.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decode(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
// Feeds often HTML-escape their HTML (Atom type="html"), so decode and strip twice.
export const stripTags = (s = '') => decode(decode(s).replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m) return m[1];
  }
  return '';
}

/** Parse RSS 2.0 or Atom text into [{title, url, date, text}]. */
export function parseFeed(xml = '') {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    let url = stripTags(tag(b, ['link']));
    if (!/^https?:\/\//.test(url)) {
      const alt = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
        || b.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i)
        || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      url = alt ? decode(alt[1]) : '';
    }
    const when = stripTags(tag(b, ['pubDate', 'published', 'updated', 'dc:date']));
    const t = Date.parse(when);
    return {
      title: stripTags(tag(b, ['title'])),
      url: url.trim(),
      date: Number.isNaN(t) ? null : new Date(t).toISOString(),
      text: stripTags(tag(b, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 600),
    };
  }).filter((i) => i.title && /^https:\/\//.test(i.url));
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Recent items, deduped. Every source with something recent gets its newest story first,
 *  then remaining slots go to the newest stories overall (at most perSource per source). */
export function select(perSourceItems, { now = Date.now(), days = 10, perSource = 2, max = 12 } = {}) {
  const cutoff = now - days * 86400000;
  const seen = new Set();
  const lists = perSourceItems.map(({ source, items }) => {
    const fresh = items
      .filter((i) => i.date && Date.parse(i.date) >= cutoff && Date.parse(i.date) <= now + 86400000)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    const unique = [];
    for (const i of fresh) {
      const keys = [norm(i.title), i.url.split('?')[0]];
      if (keys.some((k) => seen.has(k))) continue;
      keys.forEach((k) => seen.add(k));
      unique.push({ ...i, source });
      if (unique.length >= perSource) break;
    }
    return unique;
  });
  const byDate = (a, b) => Date.parse(b.date) - Date.parse(a.date);
  const firsts = lists.filter((l) => l.length).map((l) => l[0]).sort(byDate).slice(0, max);
  const rest = lists.flatMap((l) => l.slice(1)).sort(byDate);
  return [...firsts, ...rest].slice(0, max).sort(byDate);
}

/** Per-source counts of usable recent stories (for the build log). */
export function recentCount(items, { now = Date.now(), days = 10 } = {}) {
  const cutoff = now - days * 86400000;
  return items.filter((i) => i.date && Date.parse(i.date) >= cutoff).length;
}

export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });

/** HTML for the news section body. Only our own summaries are shown, never feed text. */
export function renderNews(items, updatedIso) {
  if (!items.length) return '<p class="news-empty">News is updating. Check back soon.</p>';
  const cards = items.map((i) => `
    <article class="news-card">
      <div class="news-meta"><span class="news-source">${esc(i.source)}</span> · <time datetime="${esc(i.date)}">${esc(fmt(i.date))}</time></div>
      <h4><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a></h4>
      ${i.summary ? `<p>${esc(i.summary)}</p>` : ''}
    </article>`).join('');
  return `<div class="news-grid">${cards}
  </div>
  <p class="news-updated">Updated ${esc(fmt(updatedIso))} · refreshed every Monday, Wednesday and Friday. Headlines link to the original publishers; summaries are written by Helm Tech Lab's AI.</p>`;
}

/** Replace the content between <!-- NEWS:START --> and <!-- NEWS:END -->. */
export function inject(html, body) {
  const re = /(<!-- NEWS:START -->)[\s\S]*?(<!-- NEWS:END -->)/;
  if (!re.test(html)) throw new Error('NEWS markers not found in index.html');
  return html.replace(re, `$1\n${body}\n  $2`);
}
