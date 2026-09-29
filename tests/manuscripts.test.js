import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ManuscriptStore, collectSessionImages } from '../server/manuscripts.js';
test('save and restore preserve original versions across restart and reject stale writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-versions-'));
  try {
    const store = new ManuscriptStore(dir), first = store.create({ title: '初稿', content: '第一版' });
    const second = store.update(first.id, { title: '改稿', content: '第二版' }, first.revision);
    assert.deepEqual(store.versions(first.id).map(v => v.content), ['第一版']);
    assert.throws(() => store.update(first.id, { title: '冲突', content: '错误覆盖' }, first.revision), e => e.status === 409);
    assert.equal(store.get(first.id).content, '第二版');
    assert.deepEqual(store.update(first.id, { title: second.title, content: second.content }, second.revision), second);
    assert.equal(store.versions(first.id).length, 1);
    const restarted = new ManuscriptStore(dir), restored = restarted.restore(first.id, first.revision, second.revision);
    assert.equal(restored.content, '第一版'); assert.notEqual(restored.revision, first.revision);
    assert.deepEqual(restarted.versions(first.id).map(v => v.content), ['第二版', '第一版']);
    assert.throws(() => restarted.restore(first.id, '../bad', restored.revision));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('legacy manuscript is preserved before its first versioned save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-legacy-draft-'));
  try {
    const store = new ManuscriptStore(dir), item = store.create({ title: '旧稿件', content: '原始内容' });
    const raw = JSON.parse(fs.readFileSync(store.fileFor(item.id))); assert.equal(raw.revision, undefined);
    const opened = new ManuscriptStore(dir).list()[0];
    store.update(opened.id, { title: opened.title, content: '新内容' }, opened.revision);
    assert.equal(store.versions(item.id)[0].content, '原始内容');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('collectSessionImages keeps ordered unique image tool results up to the saved message only', () => {
  const tool = (url, extra = {}) => ({ role: 'tool', tool_call_id: 'c' + url, content: JSON.stringify(url ? { url, ...extra } : { error: '工具执行失败' }) });
  const messages = [
    { role: 'user', content: '仿写这篇' },
    { role: 'assistant', content: '方案…', tool_calls: [{ id: 'a', function: { name: 'image_generate', arguments: '{}' } }] },
    tool(null),                                                    // plan round refuses generation
    { role: 'assistant', content: '方案稿' },                      // messageIndex 3: plan draft
    { role: 'user', content: '确认，开始生成' },
    tool('/images/final-1.png'),
    tool('/images/final-1.png'),                                  // duplicate generation replay
    { role: 'tool', tool_call_id: 'bad', content: 'not-json' },    // corrupt tool entry is skipped
    tool('/images/final-2.png'),
    { role: 'assistant', content: '成稿' },                        // messageIndex 9: final draft
    tool('/images/late.png'),                                     // generated after the saved message
  ];
  assert.deepEqual(collectSessionImages(messages, 3), []);
  assert.deepEqual(collectSessionImages(messages, 9), ['/images/final-1.png', '/images/final-2.png']);
});
test('collectSessionImages keeps text-only rewrite originals for later manuscript publishing', () => {
  const messages = [
    { role: 'user', content: '只改文案', context: { referenceMode: 'text-only', publishImages: ['/imports/a.png', '/imports/a.png', '/imports/b.jpg', '/imports/../secret.png'] } },
    { role: 'assistant', content: '方案' },
  ];
  assert.deepEqual(collectSessionImages(messages, 1), ['/imports/a.png', '/imports/b.jpg']);
});
test('create persists images, updates keep them, and attachImages backfills legacy drafts without breaking locks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-manuscript-images-'));
  try {
    const store = new ManuscriptStore(dir);
    const legacy = store.create({ title: '旧稿', content: '旧内容' });
    const before = store.get(legacy.id);
    assert.deepEqual(store.attachImages(legacy.id, ['/images/a.png', '/images/a.png', '/images/b.png']).images, ['/images/a.png', '/images/b.png']);
    const after = store.get(legacy.id);
    assert.equal(after.revision, before.revision, 'backfill must not invalidate open editors');
    assert.equal(after.updatedAt, before.updatedAt);
    assert.deepEqual(store.attachImages(legacy.id, ['/images/c.png']).images, ['/images/a.png', '/images/b.png'], 'never overwrite an existing image list');
    const edited = store.update(legacy.id, { title: '改后', content: '新内容' }, after.revision);
    assert.deepEqual(edited.images, ['/images/a.png', '/images/b.png'], 'edits keep attached images');
    assert.deepEqual(store.attachImages(legacy.id, []).images, ['/images/a.png', '/images/b.png']);
    assert.throws(() => store.attachImages(crypto.randomUUID(), ['/images/x.png']), e => e.status === 404);
    const fresh = store.create({ title: '新稿', content: '内容', images: ['/images/n1.png'] });
    assert.deepEqual(store.get(fresh.id).images, ['/images/n1.png']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
