import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import http from 'node:http';
import { createCollector, xhsIdentity } from '../server/collector.js';
import { NoteStore } from '../server/notes.js';
import { localEndpoint, knowledgeNoteUrl, downloadImage } from '../extensions/xhs-collector/transport.js';

const noteId = '1234567890abcdef12345678';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const payload = () => ({ noteId, sourceUrl: `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=discard`, title: '测试图文', content: '这是正文', author: '测试作者', images: [png], stats: { likes: '1.2万' }, includeComments: false, comments: [{ author: '读者', text: '怎么做？' }] });
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-collector-test-'));
  const notes = new NoteStore(dir), app = express();
  app.use('/api/collector', createCollector({ dataDir: dir, notes }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/collector`;
  const key = (await (await fetch(`${base}/pairing`)).json()).key;
  const request = (route, data, headers = {}) => fetch(`${base}/${route}`, { method: data ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { dir, notes, request, key, base };
}

test('local auth: pairing not readable cross-origin; extension requires valid credential; stable private key', async t => {
  const f = await fixture(t);
  assert.equal(fs.statSync(path.join(f.dir, 'collector-key.json')).mode & 0o777, 0o600);
  assert.equal((await f.request('pairing', null, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.request('pairing', null, { Origin: `chrome-extension://${'a'.repeat(32)}` })).status, 403);
  assert.equal((await f.request('health', null, { Authorization: 'Bearer invalid' })).status, 401);
  const ok = await f.request('health', null, { Origin: `chrome-extension://${'a'.repeat(32)}` });
  assert.equal(ok.status, 200); assert.equal((await ok.json()).service, 'xhs-collector');
  const badHost = await new Promise(resolve => http.get(`${f.base}/health`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }));
  assert.equal(badHost, 403);
  assert.equal((await (await f.request('pairing')).json()).key, f.key);
});

test('save, local image bytes, comments opt-in, deduplication, edited fields and backup survive re-capture', async t => {
  const f = await fixture(t);
  const one = await (await f.request('capture', payload())).json();
  assert.equal(one.ok, true); assert.equal(one.comments, 0); assert.equal(one.images, 1);
  let note = f.notes.get(one.noteId);
  assert.equal(note.source, 'xiaohongshu'); assert.equal(note.sourceUrl.includes('?'), false);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, note.images[0])), Buffer.from(png, 'base64'));
  assert.equal(JSON.stringify(note).includes(png), false);
  f.notes.update(note.id, { title: '我的手工标题' });
  const two = await (await f.request('capture', { ...payload(), content: '更新正文', includeComments: true })).json();
  assert.equal(two.duplicate, true); assert.equal(two.comments, 1); assert.equal(two.images, 1);
  assert.equal(f.notes.list().length, 1); note = f.notes.get(note.id);
  assert.equal(note.title, '我的手工标题'); assert.match(note.content, /更新正文/); assert.match(note.content, /怎么做/);
  assert.equal(fs.readdirSync(path.join(f.dir, 'collector-backups')).length, 1);
  await f.request('capture', payload());
  note = f.notes.get(note.id); assert.equal(note.title, '我的手工标题'); assert.equal(note.collector.comments.length, 1);
});

test('reject malformed identities and image data without partial note writes', async t => {
  const f = await fixture(t);
  for (const data of [ { ...payload(), noteId: '../bad' }, { ...payload(), sourceUrl: 'http://127.0.0.1/internal' }, { ...payload(), content: '' }, { ...payload(), images: ['PHN2Zz48L3N2Zz4='] }, { ...payload(), images: Array(21).fill(png) } ]) {
    assert.equal((await f.request('capture', data)).status, 400);
    assert.equal(f.notes.list().length, 0);
  }
});

test('reuses matching existing imports without overwriting their edited fields or import identity', async t => {
  const f = await fixture(t);
  const old = f.notes.create({ title: '已有记录', content: '原始正文', source: 'xiaohongshu' });
  fs.writeFileSync(f.notes.fileFor(old.id), JSON.stringify({ ...old, sourceUrl: payload().sourceUrl, importSource: { app: 'legacy', identity: 'original' } }));
  const result = await (await f.request('capture', { ...payload(), includeComments: true })).json();
  const note = f.notes.get(old.id);
  assert.equal(result.noteId, old.id); assert.equal(note.content, '原始正文'); assert.equal(note.importSource.identity, 'original');
  assert.equal(note.collector.comments.length, 1); assert.equal(note.images.length, 1);
});

test('missing images yield text capture and explicit warnings, then a repeat fills images', async t => {
  const f = await fixture(t);
  const result = await (await f.request('capture', { ...payload(), images: [], warnings: ['第 1 张图片下载失败'] })).json();
  assert.equal(result.images, 0); assert.equal(result.warnings.length, 1);
  const retry = await (await f.request('capture', payload())).json();
  assert.equal(retry.noteId, result.noteId); assert.equal(retry.images, 1);
});

test('source URLs drop tokens; collector endpoint cannot redirect keys to remote hosts', async () => {
  assert.equal(xhsIdentity(payload().sourceUrl).url, `https://www.xiaohongshu.com/explore/${noteId}`);
  for (const value of ['https://evil.example', 'http://127.0.0.1:8788/path', 'http://127.0.0.1.evil.example', 'http://user:pw@127.0.0.1', 'http://127.0.0.1/#a']) assert.throws(() => localEndpoint(value));
  for (const url of ['http://127.0.0.1/a.png', 'https://xhscdn.com.evil.example/a.png', 'https://user:password@xhscdn.com/a']) await assert.rejects(downloadImage(url));
  assert.equal(localEndpoint(), 'http://127.0.0.1:8788');
  assert.equal(knowledgeNoteUrl({ endpoint: 'http://127.0.0.1:8788' }, '12345678-1234-1234-1234-1234567890ab'), 'http://127.0.0.1:8788/?knowledgeNote=12345678-1234-1234-1234-1234567890ab#knowledge');
  assert.throws(() => knowledgeNoteUrl({ endpoint: 'http://127.0.0.1:8788' }, '../bad'));
});
