import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createCollector } from '../server/collector.js';
import { NoteStore } from '../server/notes.js';

const noteId = '1234567890abcdef12345678';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const payload = () => ({ noteId, sourceUrl: `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=discard`, title: '同步测试图文', content: '这是正文', author: '测试作者', images: [png], stats: { likes: '1.2万' }, includeComments: false, comments: [] });

async function fixture(t, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-collector-sync-test-'));
  const notes = new NoteStore(dir), app = express();
  app.use('/api/collector', createCollector({ dataDir: dir, notes, env }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/api/collector`;
  const key = (await (await fetch(`${base}/pairing`)).json()).key;
  const capture = data => fetch(`${base}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(response => response.json());
  return { dir, notes, capture };
}

test('mirrors each capture into a local folder as markdown plus ordered images', async t => {
  const f = await fixture(t);
  const result = await f.capture(payload());
  const folder = path.join(f.dir, 'exports', 'collector', noteId);
  assert.equal(result.localSync.ok, true);
  assert.equal(result.localSync.dir, folder);
  const md = fs.readFileSync(path.join(folder, 'note.md'), 'utf8');
  assert.match(md, /^# 同步测试图文/m);
  assert.match(md, /作者：测试作者/);
  assert.match(md, /赞 1\.2万/);
  assert.match(md, /这是正文/);
  assert.match(md, /原文：https:\/\/www\.xiaohongshu\.com\/explore\/1234567890abcdef12345678/);
  const images = fs.readdirSync(path.join(folder, 'images'));
  assert.equal(images.length, 1);
  assert.match(images[0], /^01-[a-f0-9]{64}\.png$/);
  assert.match(md, new RegExp(`!\\[图1\\]\\(images/${images[0]}\\)`));
  assert.deepEqual(fs.readFileSync(path.join(folder, 'images', images[0])), Buffer.from(png, 'base64'));
});

test('re-capture rebuilds the mirror from the stored note and removes stale files', async t => {
  const f = await fixture(t);
  const one = await f.capture(payload());
  const note = f.notes.get(one.noteId);
  f.notes.update(note.id, { title: '我的手工标题' });
  const folder = path.join(f.dir, 'exports', 'collector', noteId);
  fs.writeFileSync(path.join(folder, 'extra-stale.txt'), '旧文件');
  const two = await f.capture({ ...payload(), content: '更新后的正文', includeComments: true, comments: [{ author: '读者', text: '怎么做？' }] });
  assert.equal(two.ok, true);
  const md = fs.readFileSync(path.join(folder, 'note.md'), 'utf8');
  assert.equal(md.startsWith('# 我的手工标题'), true);
  assert.match(md, /更新后的正文/);
  assert.match(md, /怎么做/);
  assert.equal(fs.existsSync(path.join(folder, 'extra-stale.txt')), false);
  assert.equal(fs.readdirSync(path.join(folder, 'images')).length, 1);
});

test('honours custom and relative COLLECTOR_SYNC_DIR and disables on empty value', async t => {
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-collector-sync-target-'));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const custom = await fixture(t, { COLLECTOR_SYNC_DIR: external });
  const result = await custom.capture(payload());
  assert.equal(result.localSync.dir, path.join(external, noteId));
  assert.ok(fs.existsSync(path.join(external, noteId, 'note.md')));
  assert.equal(fs.existsSync(path.join(custom.dir, 'exports')), false);

  const relative = await fixture(t, { COLLECTOR_SYNC_DIR: 'mirror/xhs' });
  await relative.capture(payload());
  assert.ok(fs.existsSync(path.join(relative.dir, 'mirror', 'xhs', noteId, 'note.md')));

  const disabled = await fixture(t, { COLLECTOR_SYNC_DIR: '' });
  const skipped = await disabled.capture(payload());
  assert.equal(skipped.localSync, null);
  assert.equal(fs.existsSync(path.join(disabled.dir, 'exports')), false);
  assert.equal(disabled.notes.list().length, 1);
});

test('local sync failure never blocks the capture itself', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.dir, 'exports'), 'not a directory');
  const result = await f.capture(payload());
  assert.equal(result.ok, true);
  assert.equal(result.localSync.ok, false);
  assert.match(result.localSync.error, /本地同步失败/);
  assert.equal(f.notes.list().length, 1);
});
