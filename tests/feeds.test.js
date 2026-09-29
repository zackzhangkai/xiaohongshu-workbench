import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FeedStore, parseFeed } from '../server/feeds.js';
const xml = title => `<rss><channel><item><title>${title}</title><link>https://example.com/story</link><description><![CDATA[<p>内容 &amp; 资料</p><script>alert(1)</script>]]></description><pubDate>Sat, 26 Sep 2026 00:00:00 GMT</pubDate></item><item><title>unsafe</title><link>javascript:alert(1)</link></item></channel></rss>`;
test('RSS parsing strips markup and executable links; rejects HTML and entities', async () => {
  const items = await parseFeed(Buffer.from(xml('标题')));
  assert.equal(items.length, 1);
  assert.equal(items[0].summary, '内容 & 资料');
  await assert.rejects(parseFeed(Buffer.from('<html>verification</html>')), /RSS/);
  await assert.rejects(parseFeed(Buffer.from('<!DOCTYPE rss><rss/>')), /实体声明/);
});
test('source updates stable entries, persists cache, preserves stale results on failure', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-feeds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let title = '第一版', fail = false, calls = 0;
  const store = new FeedStore(dir, { fetchImpl: async () => { calls++; if (fail) throw new Error('offline'); return new Response(xml(title)); } });
  const [a, b] = await Promise.all([store.refresh('ithome'), store.refresh('ithome')]);
  assert.equal(calls, 1); assert.equal(a.items[0].id, b.items[0].id);
  title = '更新版'; const updated = await store.refresh('ithome');
  assert.equal(updated.items.length, 1); assert.equal(updated.items[0].title, title);
  fail = true; const stale = await store.refresh('ithome');
  assert.equal(stale.error, 'offline'); assert.equal(stale.items[0].title, title);
  assert.equal(new FeedStore(dir).list()[0].items[0].title, title);
  await assert.rejects(store.refresh('../bad'), /不存在/);
});
