import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLikes, rankResults, selectBatch, searchSpec, noteLink } from '../extensions/xhs-collector/search-core.js';
import { runBatch, runSearch, newTask } from '../extensions/xhs-collector/discovery.js';
import { searchPage } from '../extensions/xhs-collector/search-page.js';
import { extractNote } from '../extensions/xhs-collector/extract.js';

const id = n => n.toString(16).padStart(24, '0');
const item = (n, type = 'image', likesText = '100') => ({ id: id(n), url: `https://www.xiaohongshu.com/search_result/${id(n)}?xsec_token=test-only`, title: `笔记 ${n}`, author: '测试作者', type, likesText });
test('rank numeric likes, deduplicate before top ten, exclude missing counts, and filter BEFORE slicing', () => {
  assert.equal(parseLikes('1.2万+'), 12000);
  assert.equal(parseLikes('1,518'), 1518);
  assert.equal(parseLikes('2.5k'), 2500);
  for (const raw of ['', '赞', undefined, '-10', '1.2wat', '999999999999999999999999']) assert.equal(parseLikes(raw), null);
  const cards = [...Array.from({ length: 12 }, (_, n) => item(n + 1, 'video', `${10000 - n}`)), ...Array.from({ length: 12 }, (_, n) => item(n + 20, 'image', `${100 - n}`)), item(20, 'image', '1.2万'), item(99, 'image', '赞'), item(100, 'unknown', '20000')];
  const ranked = rankResults(cards, 'image');
  assert.equal(ranked.items.length, 10);
  assert.equal(ranked.items[0].id, id(20));
  assert.equal(ranked.items[0].likes, 12000);
  assert.equal(ranked.candidateCount, 26);
  assert.equal(ranked.unknownLikes, 1);
  assert.equal(ranked.unknownTypes, 1);
  assert.ok(ranked.items.every(i => i.type === 'image'));
  assert.equal(rankResults(cards, 'all').items[0].type, 'unknown');
});
test('only selected image identities from current results may enter a batch; navigation cannot leave source site', () => {
  const result = { items: [item(1), item(2, 'video'), item(3, 'unknown')] };
  assert.deepEqual(selectBatch(result, [id(1), id(1)]), [item(1)]);
  for (const ids of [[], [id(2)], [id(3)], [id(4)], null]) assert.throws(() => selectBatch(result, ids));
  for (const url of ['https://evil.example/explore/' + id(1), 'javascript:alert(1)', 'https://www.xiaohongshu.com@evil.example/explore/' + id(1), 'https://www.xiaohongshu.com:8443/explore/' + id(1)]) assert.throws(() => noteLink(url));
  assert.throws(() => noteLink(item(1).url, id(2)));
  assert.equal(new URL(searchSpec(' AI & 编程 ').url).searchParams.get('keyword'), 'AI & 编程');
  assert.throws(() => searchSpec(''));
  assert.throws(() => searchSpec('test', 'bogus'));
});

function mockChrome({ result, injection, permission = true, land = url => url }) {
  const local = { discoveryResult: result, endpoint: 'http://127.0.0.1:8788', key: 'a'.repeat(64) }, session = { discoveryLinks: { runId: result?.runId, links: Object.fromEntries((result?.items || []).map(i => [i.id, i.url])) } }, calls = [];
  const area = data => ({ get: async () => structuredClone(data), set: async values => Object.assign(data, structuredClone(values)), remove: async key => { delete data[key]; } });
  let currentUrl;
  return { local, session, calls, chrome: {
    permissions: { contains: async () => permission },
    storage: { local: area(local), session: area(session) },
    tabs: { create: async ({ url }) => { currentUrl = land(url); calls.push(['create', url]); return { id: 3 }; }, update: async (_, { url }) => { currentUrl = land(url); calls.push(['update', url]); }, get: async () => ({ status: 'complete', url: currentUrl }), remove: async tab => calls.push(['remove', tab]) },
    scripting: { executeScript: async options => [{ result: await injection(options) }] },
  } };
}
test('search clears stale results, keeps signed navigation only in session, and persists ranked public metadata', async t => {
  const original = globalThis.chrome; t.after(() => { globalThis.chrome = original; });
  const mock = mockChrome({ result: { runId: 'old', items: [item(50)] }, injection: options => {
    assert.equal(options.func, searchPage); assert.equal(mock.local.discoveryResult, null);
    return { candidates: [item(1), item(2, 'video', '500')], platformSort: '最多点赞' };
  } }); globalThis.chrome = mock.chrome;
  await runSearch({ topic: 'AI', contentType: 'image' }, newTask());
  assert.equal(mock.local.discoveryResult.items.length, 1);
  assert.equal(mock.local.discoveryStatus.state, 'done');
  assert.ok(!JSON.stringify(mock.local).includes('xsec_token'));
  assert.ok(mock.session.discoveryLinks.links[id(1)].includes('xsec_token'));
  assert.equal(mock.calls.at(-1)[0], 'remove');
});
test('failed search exposes no prior-topic ranking', async t => {
  const original = globalThis.chrome; t.after(() => { globalThis.chrome = original; });
  const mock = mockChrome({ result: { runId: 'old', items: [item(50)] }, injection: () => ({ error: '请登录或验证' }) }); globalThis.chrome = mock.chrome;
  await assert.rejects(runSearch({ topic: 'AI', contentType: 'image' }, newTask()), /登录或验证/);
  assert.equal(mock.local.discoveryResult, null);
});
test('batch rechecks detail identity, refuses video and records per-note failures without writing', async t => {
  const original = globalThis.chrome, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = original; globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }));
  for (const [payload, error] of [[{ noteId: id(9) }, /身份/], [{ error: '这一版支持图文笔记，视频下载尚未接入' }, /视频/]]) {
    const mock = mockChrome({ result: { runId: 'current', items: [item(1)] }, injection: options => { assert.equal(options.func, extractNote); return payload; } });
    globalThis.chrome = mock.chrome;
    let writes = 0;
    await runBatch({ runId: 'current', ids: [id(1)] }, newTask(), async () => { writes++; });
    assert.equal(writes, 0);
    assert.equal(mock.local.discoveryStatus.state, 'partial');
    assert.match(mock.local.batchResults[id(1)].message, error);
  }
});
test('valid batch uses actual full detail and existing save contract, while expired links and stale run IDs reject', async t => {
  const original = globalThis.chrome, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = original; globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }));
  const mock = mockChrome({ result: { runId: 'current', items: [item(1)] }, injection: () => ({ noteId: id(1), content: '完整正文', imageUrls: [] }) });
  globalThis.chrome = mock.chrome;
  let writes = 0;
  const savedNoteId = '12345678-1234-1234-1234-1234567890ab';
  const save = async payload => { writes++; assert.equal(payload.content, '完整正文'); return { noteId: savedNoteId, duplicate: false, images: 0, warnings: ['无配图'] }; };
  await assert.rejects(runBatch({ runId: 'old', ids: [id(1)] }, newTask(), save), /更新/);
  await runBatch({ runId: 'current', ids: [id(1)] }, newTask(), save);
  assert.equal(writes, 1); assert.equal(mock.local.batchResults[id(1)].state, 'done');
  assert.deepEqual(mock.calls.find(call => call[0] === 'create' && call[1].startsWith('http://127.0.0.1:8788/')), ['create', `http://127.0.0.1:8788/?knowledgeNote=${savedNoteId}#knowledge`]);
  delete mock.session.discoveryLinks;
  await assert.rejects(runBatch({ runId: 'current', ids: [id(1)] }, newTask(), save), /过期/);
});

test('a normal search_result → explore redirect is the same note and must not abort the batch; leaving the note page still does', async t => {
  const original = globalThis.chrome, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = original; globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }));
  const canonicalize = url => url.replace('/search_result/', '/explore/');
  const landed = mockChrome({ result: { runId: 'current', items: [item(1)] }, injection: () => ({ noteId: id(1), content: '完整正文', imageUrls: [] }), land: canonicalize });
  globalThis.chrome = landed.chrome;
  let writes = 0;
  const save = async () => { writes++; return { duplicate: false, images: 0, warnings: [] }; };
  await runBatch({ runId: 'current', ids: [id(1)] }, newTask(), save);
  assert.equal(writes, 1);
  assert.equal(landed.local.batchResults[id(1)].state, 'done');

  const hijacked = mockChrome({ result: { runId: 'current', items: [item(1)] }, injection: () => ({ noteId: id(1), content: '完整正文', imageUrls: [] }), land: () => 'https://www.xiaohongshu.com/login' });
  globalThis.chrome = hijacked.chrome;
  await assert.rejects(runBatch({ runId: 'current', ids: [id(1)] }, newTask(), save), /页面发生跳转/);
  assert.equal(hijacked.local.batchResults[id(1)].state, 'error');
});

test('permission denial and cancellation do not start page access or save; verification pauses queue', async t => {
  const original = globalThis.chrome, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.chrome = original; globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }));
  const denied = mockChrome({ permission: false }); globalThis.chrome = denied.chrome;
  await assert.rejects(runSearch({ topic: 'AI', contentType: 'image' }, newTask()), /授权/);
  assert.equal(denied.calls.length, 0);
  const mock = mockChrome({ result: { runId: 'current', items: [item(1), item(2)] }, injection: () => ({ error: '请先在小红书页面完成登录或验证，再重新采集' }) });
  globalThis.chrome = mock.chrome;
  const cancelled = newTask(); cancelled.cancelled = true;
  await assert.rejects(runSearch({ topic: 'AI', contentType: 'image' }, cancelled), /停止/);
  let writes = 0;
  await assert.rejects(runBatch({ runId: 'current', ids: [id(1), id(2)] }, newTask(), () => writes++), /登录或验证/);
  assert.equal(writes, 0);
  assert.equal(mock.calls.filter(c => c[0] === 'create').length, 1);
  assert.equal(mock.local.batchResults[id(2)], undefined);
});
