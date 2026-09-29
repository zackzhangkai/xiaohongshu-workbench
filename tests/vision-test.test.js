import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { createConfigStore, configCandidate, testAndSaveChatConfig } from '../server/config.js';
import { testVisionConnection, visionSample } from '../server/vision-test.js';
const cfg = { chatBaseUrl: 'https://example.com/v1', apiKey: 'very-secret-key', chatModel: 'vision', chatImageInput: true };
const reply = content => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
function storeFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-vision-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createConfigStore(path.join(dir, 'model-config.json'), {}) };
}
test('built-in sample contains real left red/right blue pixels and request sends those bytes', async () => {
  const png = visionSample(); assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  const size = png.readUInt32BE(33), raw = inflateSync(png.subarray(41, 41 + size));
  assert.deepEqual([...raw.subarray(1, 4)], [255, 0, 0]); assert.deepEqual([...raw.subarray(1 + 95 * 3, 4 + 95 * 3)], [0, 0, 255]);
  const result = await testVisionConnection(cfg, async (_url, options) => {
    const body = JSON.parse(options.body), content = body.messages[0].content;
    assert.equal(options.headers.Authorization, 'Bearer very-secret-key'); assert.equal(options.redirect, 'error');
    assert.ok(!content[0].text.includes('red')); assert.equal(content[1].image_url.url, `data:image/png;base64,${png.toString('base64')}`);
    return reply('red blue');
  });
  assert.equal(result.ok, true); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('text-only success, wrong answer, provider errors and disabled setting never verify', async () => {
  for (const value of ['OK', 'blue red', '', 'very-secret-key']) await assert.rejects(testVisionConnection(cfg, async () => reply(value)), /未正确识别/);
  await assert.rejects(testVisionConnection({ ...cfg, chatImageInput: false }, () => { throw Error('must not call'); }), /请先勾选/);
  for (const fetcher of [async () => new Response('very-secret-key', { status: 401 }), async () => { throw Error('very-secret-key'); }, async () => new Response('very-secret-key')]) {
    await assert.rejects(testVisionConnection(cfg, fetcher), e => !e.message.includes('very-secret-key'));
  }
});
test('legacy defaults off; vision evidence separate from text test, bound to address/key/model/switch', async t => {
  const { dir, store } = storeFixture(t);
  assert.equal(store.public().chatImageInput, false); assert.equal(store.public().visionVerification, null);
  store.save(cfg);
  await testAndSaveChatConfig(store, {}, async () => reply('OK'));
  assert.equal(store.public().visionVerification, null);
  const record = { ok: true, testedAt: new Date().toISOString(), latencyMs: 1 };
  store.recordVisionTest(store.get(), record);
  assert.equal(store.public().visionVerification.ok, true);
  assert.equal(fs.statSync(path.join(dir, 'vision-verification.json')).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(store.public()).includes('very-secret-key'));
  assert.equal(createConfigStore(path.join(dir, 'model-config.json'), {}).public().visionVerification.ok, true);
  for (const patch of [{ chatModel: 'other' }, { apiKey: 'other-key' }, { chatBaseUrl: 'https://new.example/v1', apiKey: 'new-key' }, { chatImageInput: false }]) {
    const old = store.get(); store.recordVisionTest(old, record); store.save(patch);
    assert.equal(store.public().visionVerification, null);
    store.save(old); assert.equal(store.public().visionVerification, null);
  }
  const candidate = configCandidate(store.get(), { chatModel: 'candidate' });
  store.recordVisionTest(candidate, record); assert.equal(store.public().visionVerification, null);
  store.save({ chatModel: 'candidate' }); assert.equal(store.public().visionVerification.ok, true);
});
test('failed vision candidate test does not alter saved config or expose credentials', async t => {
  const { store } = storeFixture(t); store.save(cfg); const before = store.get();
  const candidate = configCandidate(before, { chatModel: 'bad' });
  await assert.rejects(testVisionConnection(candidate, async () => reply('wrong')));
  assert.deepEqual(store.get(), before); assert.equal(store.public().visionVerification, null);
  assert.throws(() => store.save({ chatImageInput: 'true' }));
});
