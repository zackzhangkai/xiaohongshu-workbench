import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Scheduler } from '../server/scheduler.js';

function setup(t, execute = async () => ({ sessionId: 'result' })) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-scheduler-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let now = Date.parse('2026-09-26T00:00:00Z');
  const options = { dataDir, execute, now: () => now };
  return { scheduler: new Scheduler(options), options, advance: ms => { now += ms; } };
}
const input = { title: '选题', prompt: '写 5 个选题', runAt: '2026-09-26T00:00:00Z' };
test('editing preserves history and original run prompt, reschedules explicitly and survives restart', async t => {
  const { scheduler: s, options } = setup(t);
  const task = s.create(input); await s.run(task.id);
  const fields = { title: '新任务', prompt: '新提示词', runAt: '2026-09-27T00:00:00Z', repeat: 'weekly', enabled: false };
  const updated = s.update(task.id, fields);
  assert.equal(updated.runs.length, 1); assert.equal(updated.runs[0].prompt, input.prompt);
  assert.equal(updated.nextRunAt, new Date(fields.runAt).toISOString()); assert.equal(updated.enabled, false);
  assert.equal(new Scheduler(options).get(task.id).prompt, fields.prompt);
  assert.throws(() => s.update(task.id, { ...fields, runAt: input.runAt }), /晚于现在/);
  assert.equal(s.get(task.id).nextRunAt, new Date(fields.runAt).toISOString());
  s.get(task.id).status = 'running';
  assert.throws(() => s.update(task.id, fields), /执行中/);
});
test('due task runs once, persists results and cannot be re-enabled accidentally', async t => {
  let calls = 0;
  const { scheduler: s, options } = setup(t, async () => { calls++; return { sessionId: 'result' }; });
  const task = s.create(input);
  await s.tick(); await s.tick();
  assert.equal(calls, 1);
  assert.equal(s.get(task.id).runs[0].sessionId, 'result');
  assert.throws(() => s.update(task.id, { enabled: true }), /单次任务已完成/);
  assert.equal(s.get(task.id).enabled, false);
  const reopened = new Scheduler(options);
  await reopened.tick(); assert.equal(calls, 1);
});
test('overdue recurring task catches up once and advances beyond current time', async t => {
  const { scheduler: s, advance } = setup(t);
  const task = s.create({ ...input, repeat: 'daily' });
  advance(3 * 86400000 + 3600000);
  await s.tick(); await s.tick();
  assert.equal(s.get(task.id).runs.length, 1);
  assert.equal(s.get(task.id).nextRunAt, '2026-09-30T00:00:00.000Z');
});
test('pause prevents scheduled calls, failure disables automatic retry', async t => {
  const { scheduler: s } = setup(t, async () => { throw new Error('provider unavailable'); });
  const task = s.create({ ...input, repeat: 'weekly' });
  s.update(task.id, { enabled: false }); await s.tick();
  assert.equal(s.get(task.id).runs.length, 0);
  s.update(task.id, { enabled: true }); await s.tick(); await s.tick();
  assert.equal(s.get(task.id).runs.length, 1);
  assert.equal(s.get(task.id).runs[0].error, 'provider unavailable');
  assert.equal(s.get(task.id).enabled, false);
});
test('concurrent runs rejected and interrupted executions never auto-replayed', async t => {
  let finish;
  const { scheduler: s, options } = setup(t, () => new Promise(resolve => { finish = resolve; }));
  const task = s.create(input);
  const pending = s.run(task.id);
  await assert.rejects(s.run(task.id), /已经在执行/);
  const recovered = new Scheduler(options);
  assert.equal(recovered.get(task.id).runs[0].status, 'interrupted');
  assert.equal(recovered.get(task.id).enabled, false);
  finish({ sessionId: 'result' }); await pending;
});
test('invalid schedules rejected before persistence', t => {
  const { scheduler: s } = setup(t);
  for (const patch of [{ title: '' }, { prompt: 2 }, { runAt: 'bad' }, { repeat: 'other' }, { repeat: 'interval', intervalMinutes: 0 }]) assert.throws(() => s.create({ ...input, ...patch }));
  assert.equal(s.list().length, 0);
});
