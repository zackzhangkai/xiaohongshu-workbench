import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { NoteStore } from '../server/notes.js';
import { SessionStore } from '../server/sessions.js';
import { prepareChatContext } from '../server/chat-context.js';
import { visionSample } from '../server/vision-test.js';
import { runChatTurn } from '../server/chat.js';

const skillsDir = fileURLToPath(new URL('../skills', import.meta.url));
const skillId = 'knowledge-content-imitation';
// 公开仓库不带内置技能内容；缺失时这些用例自动跳过
const maybe = fs.existsSync(path.join(skillsDir, skillId)) ? test : test.skip;
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-context-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const notes = new NoteStore(dir);
  const sessions = new SessionStore(dir);
  const note = notes.create({ title: '任务如何跑通', summary: '简短摘要', content: '正文独有证据：先拆解，再执行，最后检查。', source: 'xiaohongshu' });
  const session = sessions.create();
  return { notes, sessions, note, session, prepare: (input = {}, target = session) => prepareChatContext({ session: target, input, notes, skillsDir }) };
}
async function mock(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const p of req) raw += p;
    const body = JSON.parse(raw); requests.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: handler(body, requests.length) }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { requests, config: { chatBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, chatModel: 'auto', apiKey: 'test-key' } };
}

maybe('real skill and full note reach provider; reopen retains context and immutable source snapshot', async (t) => {
  const { notes, sessions, note, session, prepare } = fixture(t);
  const { requests, config } = await mock(t, (_body, count) => ({ content: count === 1 ? '建议先做一张原创流程图。这个方向可以吗？' : '按已确认方向继续。' }));
  const prepared = prepare({ skillId, noteIds: [note.id] });
  session.context = prepared.context;
  await runChatTurn({ ...prepared, session, config, userMessage: `AI 仿写 · ${note.title}`, onEvent() {} });
  const first = requests[0];
  assert.match(first.messages[0].content, /# 知识库 AI 仿写/);
  assert.match(first.messages[0].content, /首次引用的方案轮/);
  assert.match(first.messages.at(-2).content, /正文独有证据/);
  assert.equal(first.messages.at(-1).content, `AI 仿写 · ${note.title}`);
  assert.equal('tools' in first, false);
  assert.ok(first.messages.every((m) => !('context' in m)));
  assert.deepEqual(notes.get(note.id), note);
  sessions.save(session);
  notes.update(note.id, { content: '后续变更不应悄悄更改已确认的创作依据' });
  const reopened = sessions.get(session.id);
  const followup = prepare({}, reopened);
  assert.equal(followup.context.skillId, skillId);
  assert.match(followup.referenceContent, /正文独有证据/);
  assert.equal(followup.allowImageGeneration, true);
  reopened.context = followup.context;
  await runChatTurn({ ...followup, session: reopened, config, userMessage: '可以，继续', onEvent() {} });
  assert.equal(requests[1].tools[0].function.name, 'image_generate');
  assert.match(requests[1].messages[0].content, /# 知识库 AI 仿写/);
  assert.equal(reopened.messages[0].context.references[0].title, note.title);
  assert.ok(requests[1].messages.every((m) => !('context' in m)));
});

maybe('invalid or missing references fail before generation, and explicit removal clears context', (t) => {
  const { prepare, session, note } = fixture(t);
  assert.throws(() => prepare({ skillId, noteIds: [] }), /引用一篇笔记/);
  assert.throws(() => prepare({ noteIds: 'bad' }), /有效笔记/);
  assert.throws(() => prepare({ noteIds: ['../../.env'] }), /不存在/);
  assert.throws(() => prepare({ skillId: 'nonexistent' }), /skill 不存在/);
  session.context = prepare({ skillId, noteIds: [note.id] }).context;
  const cleared = prepare({ skillId: '', noteIds: [] });
  assert.equal(cleared.referenceContent, '');
  assert.equal(cleared.context.references.length, 0);
  assert.equal(cleared.context.creation, undefined);
  assert.equal(cleared.systemPrompt.includes('# 知识库 AI 仿写'), false);
});

maybe('unsolicited tool calls during initial proposal cannot generate a paid image', async (t) => {
  const { session, note, prepare } = fixture(t);
  const { requests, config } = await mock(t, (_body, count) => count === 1
    ? { tool_calls: [{ index: 0, id: 'forbidden-image', function: { name: 'image_generate', arguments: '{"prompt":"must not be sent"}' } }] }
    : { content: '先确认创作方向。' });
  const prepared = prepare({ skillId, noteIds: [note.id] });
  session.context = prepared.context;
  const events = [];
  await runChatTurn({ ...prepared, config, session, userMessage: 'AI 仿写', onEvent: (e) => events.push(e) });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((r) => !r.tools));
  assert.match(requests[1].messages.at(-1).content, /等待用户确认/);
  assert.ok(!events.some((e) => e.type === 'image'));
});

maybe('snapshot image bytes reach provider without base64 persistence; default scheduler-style call never uploads', async (t) => {
  const { notes, sessions, note, session, prepare } = fixture(t);
  const importsDir = path.join(fs.realpathSync(path.dirname(notes.dir)), 'imports'); fs.mkdirSync(importsDir);
  const bytes = visionSample(); fs.writeFileSync(path.join(importsDir, 'sample.png'), bytes);
  fs.writeFileSync(notes.fileFor(note.id), JSON.stringify({ ...note, images: ['/imports/sample.png'] }));
  const { requests, config } = await mock(t, () => ({ content: '先确认方案。' }));
  config.chatImageInput = true; config.importsDir = importsDir;
  const prepared = prepare({ skillId, noteIds: [note.id] }); session.context = prepared.context;
  const events = [];
  await runChatTurn({ ...prepared, allowReferenceImages: true, session, config, userMessage: '仿写', onEvent: e => events.push(e) });
  const content = requests[0].messages.at(-2).content;
  assert.equal(content.at(-1).image_url.url, `data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(requests[0].tools, undefined);
  assert.equal(events[0].type, 'reference_status');
  assert.match(events[0].status.report, /已附带 1 张/);
  sessions.save(session); assert.ok(!fs.readFileSync(sessions.fileFor ? sessions.fileFor(session.id) : path.join(path.dirname(notes.dir), 'sessions', `${session.id}.json`), 'utf8').includes('base64'));
  fs.writeFileSync(notes.fileFor(note.id), JSON.stringify({ ...note, images: ['/imports/new.png'], content: 'changed' }));
  const followup = prepare(); assert.deepEqual(followup.context.references[0].imageRefs, ['/imports/sample.png']);
  await runChatTurn({ ...followup, session, config, userMessage: 'scheduled-style', allowReferenceImages: false, allowImageGeneration: false, onEvent() {} });
  assert.equal(typeof requests[1].messages.at(-2).content, 'string');
  assert.match(requests[1].messages.at(-2).content, /非手动对话禁止图片上传/);
  assert.ok(!JSON.stringify(requests[1]).includes('base64'));
});

maybe('old session remains a text snapshot even if source now has images', t => {
  const { notes, note, session, prepare } = fixture(t);
  session.context = { skillId, references: [{ id: note.id, title: 'old', content: 'immutable old text', imageCount: 1 }] };
  fs.writeFileSync(notes.fileFor(note.id), JSON.stringify({ ...note, images: ['/imports/new.png'] }));
  const prepared = prepare();
  assert.equal(prepared.context.references[0].imageRefs, undefined);
  assert.equal(prepared.context.references[0].content, 'immutable old text');
});

maybe('text-only rewrite never sends original pixels or exposes image paths to the provider and keeps image tools disabled', async t => {
  const { notes, note, session, prepare } = fixture(t);
  const importsDir = path.join(fs.realpathSync(path.dirname(notes.dir)), 'imports'); fs.mkdirSync(importsDir);
  fs.writeFileSync(path.join(importsDir, 'sample.png'), visionSample());
  fs.writeFileSync(notes.fileFor(note.id), JSON.stringify({ ...note, images: ['/imports/sample.png'] }));
  const { requests, config } = await mock(t, (_body, count) => ({ content: count === 1 ? '只调整标题和开头，可以吗？' : '## 标题\n改写标题\n\n## 正文\n改写正文\n\n## 话题\n#测试' }));
  config.chatImageInput = true; config.importsDir = importsDir;
  const first = prepare({ skillId, noteIds: [note.id], referenceMode: 'text-only' });
  assert.equal(first.allowReferenceImages, false); assert.equal(first.allowImageGeneration, false);
  assert.equal(first.referenceContent.includes('/imports/'), false);
  session.context = first.context;
  await runChatTurn({ ...first, session, config, userMessage: '只改小红书文案', onEvent() {} });
  const next = prepare(); session.context = next.context;
  await runChatTurn({ ...next, session, config, userMessage: '可以，继续', onEvent() {} });
  assert.ok(requests.every(request => !JSON.stringify(request).includes('base64')));
  assert.ok(requests.every(request => !('tools' in request)));
  assert.deepEqual(session.messages[0].context.publishImages, ['/imports/sample.png']);
});
