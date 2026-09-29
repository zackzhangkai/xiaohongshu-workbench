import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VoiceService } from '../server/voice.js';
function setup(t, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-voice-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, service: new VoiceService(dir, run) };
}
test('voice selection parses names with spaces and rejects unsupported commands before generation', async t => {
  let calls = 0;
  const { service } = setup(t, async () => { calls++; return { stdout: 'Tingting zh_CN # 你好\nBad News en_US # hello\n' }; });
  assert.deepEqual((await service.voices()).map(v => v.name), ['Tingting', 'Bad News']);
  await assert.rejects(service.create({ text: '[[slnc 1]]', voice: 'Tingting', rate: 180 }));
  await assert.rejects(service.create({ text: '你好', voice: 'Tingting', rate: 400 }));
  assert.equal(calls, 1);
  await assert.rejects(service.create({ text: '你好', voice: 'not-installed', rate: 180 }));
  assert.equal(service.busy, false);
});
test('generation failures are recorded and release the processing slot', async t => {
  const { service } = setup(t, async (_file, args) => {
    if (args[1] === '?') return { stdout: 'Tingting zh_CN # 你好' };
    throw new Error('native process failed');
  });
  const record = await service.create({ text: '你好', voice: 'Tingting', rate: 180 });
  for (let i = 0; i < 20 && service.busy; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(service.list()[0].id, record.id);
  assert.equal(service.list()[0].status, 'failed');
  assert.equal(service.busy, false);
  assert.ok(!fs.existsSync(path.join(service.dir, `${record.id}.txt`)));
});
test('restart marks unfinished jobs failed without automatically resubmitting speech', t => {
  const { dir, service } = setup(t, () => { throw new Error('should not run'); });
  service.save({ id: '11111111-1111-4111-8111-111111111111', status: 'running', createdAt: 1 });
  const reopened = new VoiceService(dir, () => { throw new Error('should not run'); });
  assert.equal(reopened.list()[0].status, 'failed');
});
