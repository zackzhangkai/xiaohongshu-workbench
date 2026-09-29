import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { prepareChatContext } from '../server/chat-context.js';
import { runChatTurn } from '../server/chat.js';
import { visionSample } from '../server/vision-test.js';

async function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-continuation-')));
  fs.writeFileSync(path.join(dir, 'sample.png'), visionSample());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = []; let mode = 'normal';
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    if (mode === 'fail') { res.writeHead(500); res.end('failed'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const delta = mode === 'tools' && requests.length <= 8 ? { tool_calls: [{ index: 0, id: `tool-${requests.length}`, function: { name: 'unknown', arguments: '{}' } }] } : { content: '真实模型原文：先确认方案。' };
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n${mode === 'truncated' ? '' : 'data: [DONE]\n\n'}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { chatBaseUrl: `http://127.0.0.1:${server.address().port}`, chatModel: 'mock', chatImageInput: true, importsDir: dir };
  const notes = new Map(['a', 'b'].map(id => [id, { id, title: id, content: `private-source-${id}`, images: ['/imports/sample.png'] }]));
  const session = { messages: [] }; const events = [];
  async function turn(input = {}, extra = {}) {
    const prepared = prepareChatContext({ session, input, notes, skillsDir: path.resolve('skills') });
    session.context = prepared.context;
    await runChatTurn({ ...prepared, config, session, userMessage: '继续', allowReferenceImages: true, onEvent: e => events.push(structuredClone(e)), ...extra });
  }
  return { session, requests, config, events, turn, mode: value => { mode = value; } };
}
const hasPixels = body => JSON.stringify(body).includes('data:image/png;base64,');

test('first image turn, continuation, explicit reread; clean body and bounded genuine context', async t => {
  const f = await fixture(t);
  await f.turn({ noteIds: ['a'] });
  assert.ok(hasPixels(f.requests[0]));
  assert.equal(f.session.messages.at(-1).content, '真实模型原文：先确认方案。');
  assert.equal(f.session.messages[0].imageStatus.state, 'completed');
  await f.turn();
  assert.ok(!hasPixels(f.requests[1]));
  assert.match(JSON.stringify(f.requests[1]), /本轮未附原图/);
  assert.match(JSON.stringify(f.requests[1]), /已保存的创作上下文/);
  assert.ok(f.requests[1].messages.every(m => !m.imageStatus && !m.context));
  assert.equal(f.session.context.creation.initialResponse, '真实模型原文：先确认方案。');
  await f.turn({ rereadNoteIds: ['a'] });
  assert.ok(hasPixels(f.requests[2]));
  assert.ok(!JSON.stringify(f.session).includes('base64'));
  assert.ok(f.events.filter(e => e.type === 'delta').every(e => !e.text.includes('图片输入状态')));
});

test('failed and truncated requests do not commit image completion; retry attaches', async t => {
  for (const mode of ['fail', 'truncated']) {
    const f = await fixture(t); f.mode(mode);
    await assert.rejects(f.turn({ noteIds: ['a'] }));
    assert.equal(f.session.context.creation, undefined);
    assert.equal(f.session.messages[0].imageStatus.state, 'failed');
    f.mode('normal'); await f.turn();
    assert.ok(hasPixels(f.requests[1]));
  }
});

test('source replacement and removal isolate prior source history and creation evidence', async t => {
  const f = await fixture(t); await f.turn({ noteIds: ['a'] });
  f.session.messages.at(-1).content = 'old-visual-evidence';
  await f.turn({ noteIds: ['b'] });
  assert.ok(hasPixels(f.requests[1]));
  assert.ok(!JSON.stringify(f.requests[1]).includes('private-source-a'));
  assert.ok(!JSON.stringify(f.requests[1]).includes('old-visual-evidence'));
  await f.turn({ noteIds: [] });
  assert.ok(!JSON.stringify(f.requests[2]).includes('private-source-b'));
  assert.equal(f.session.context.creation, undefined);
});

test('global off and scheduled calls block explicit reread without successful image marks', async t => {
  const f = await fixture(t); f.config.chatImageInput = false;
  await f.turn({ noteIds: ['a'], rereadNoteIds: ['a'] });
  assert.ok(!hasPixels(f.requests[0]));
  assert.deepEqual(f.session.context.creation.imageReadIds, []);
  f.config.chatImageInput = true;
  await f.turn({ rereadNoteIds: ['a'] }, { allowReferenceImages: false });
  assert.ok(!hasPixels(f.requests[1]));
  await f.turn(); assert.ok(hasPixels(f.requests[2]));
});

test('legacy session continues text without silently resending; explicit reread remains possible', async t => {
  const f = await fixture(t);
  f.session.context = { skillId: '', references: [{ id: 'a', title: 'a', content: 'legacy', imageRefs: ['/imports/sample.png'] }] };
  f.session.messages = [{ role: 'assistant', content: '旧方案原样保留' }];
  await f.turn(); assert.ok(!hasPixels(f.requests[0]));
  assert.equal(f.session.messages[0].content, '旧方案原样保留');
  await f.turn({ rereadNoteIds: ['a'] }); assert.ok(hasPixels(f.requests[1]));
});

test('tool limit fallback stays pure and persists genuine response with image status separately', async t => {
  const f = await fixture(t); f.mode('tools');
  await f.turn({ noteIds: ['a'] });
  assert.equal(f.requests.length, 9);
  assert.equal(f.session.messages.at(-1).content, '真实模型原文：先确认方案。');
  assert.deepEqual(f.session.context.creation.imageReadIds, ['a']);
  assert.equal(f.session.messages[0].imageStatus.state, 'completed');
});

const maybe = fs.existsSync(path.resolve('skills', 'knowledge-content-imitation')) ? test : test.skip;
maybe('aborted request never commits image success; same-source skill changes preserve context', async t => {
  const f = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.turn({ noteIds: ['a'] }, { signal: controller.signal }));
  assert.equal(f.session.context.creation, undefined);
  assert.equal(f.session.messages.at(-1).imageStatus.state, 'failed');
  await f.turn({ skillId: 'knowledge-content-imitation' });
  const creation = structuredClone(f.session.context.creation);
  await f.turn({ skillId: '' });
  assert.ok(!hasPixels(f.requests.at(-1)));
  assert.equal(f.session.context.creation.initialResponse, creation.initialResponse);
});
