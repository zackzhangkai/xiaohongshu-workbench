import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createConfigStore, publicConfig, configCandidate, testChatConnection, testAndSaveChatConfig } from '../server/config.js';
import { runChatTurn } from '../server/chat.js';
import { imageConnection } from '../server/image-provider.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-config-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'model-config.json');
}
test('provider migration preserves secrets, backup and routes across restart and legacy candidates', (t) => {
  const file = fixture(t), store = createConfigStore(file, {});
  store.save({ apiKey: 'original-secret', imageApiKey: 'image-secret' });
  const original = fs.readFileSync(file, 'utf8');
  const draft = store.public();
  const saved = store.save({ providers: draft.providers, routes: draft.routes });
  assert.equal(fs.readFileSync(file + '.v1-backup', 'utf8'), original);
  assert.equal(fs.statSync(file + '.v1-backup').mode & 0o777, 0o600);
  assert.equal(JSON.stringify(saved).includes('secret'), false);
  assert.equal(createConfigStore(file, {}).get().apiKey, 'original-secret');
  store.save({ chatModel: 'replacement' });
  assert.equal(store.public().routes.chat.model, 'replacement');
  assert.equal(store.get().providers.length, 2);
  assert.equal(store.get().imageApiKey, 'image-secret');
  store.save({ chatImageInput: true });
  assert.equal(store.get().apiKey, 'original-secret');
  assert.equal(fs.readFileSync(file + '.v1-backup', 'utf8'), original);
});
test('provider validation rejects dangling capabilities, duplicate ids, unsupported protocol and destination key reuse atomically', (t) => {
  const store = createConfigStore(fixture(t), { CHAT_API_KEY: 'hidden-key' });
  const draft = store.public();
  store.save({ providers: draft.providers, routes: draft.routes });
  const before = store.get();
  for (const patch of [{ baseUrl: 'https://other.example/v1' }, { clearKey: 'true' }, { protocol: 'anthropic' }, { defaultModel: 'absent' }, { models: [{ id: 'qwen-plus', capabilities: ['image'] }] }]) {
    assert.throws(() => store.save({ providers: draft.providers.map((p, i) => i ? p : { ...p, ...patch }), routes: draft.routes }));
    assert.deepEqual(store.get(), before);
  }
  assert.throws(() => store.save({ providers: [...draft.providers, draft.providers[0]], routes: draft.routes }));
  const changed = draft.providers.map((p, i) => i ? p : { ...p, baseUrl: 'http://localhost:1234/v1', clearKey: true });
  store.save({ providers: changed, routes: draft.routes });
  assert.equal(store.get().apiKey, '');
});
for (const changeAddress of [false, true]) {
  test(`v2 cleared chat/image keys remain empty after restart with env keys (change address: ${changeAddress})`, (t) => {
    const file = fixture(t);
    const env = { CHAT_API_KEY: 'env-chat-secret', IMAGE_API_KEY: 'env-image-secret' };
    const store = createConfigStore(file, env);
    const draft = store.public();
    store.save({ providers: draft.providers, routes: draft.routes });
    // Empty keys from the form retain existing secrets before explicit clearing.
    store.save({ providers: draft.providers.map(p => ({ ...p, apiKey: '' })), routes: draft.routes });
    assert.equal(store.get().apiKey, env.CHAT_API_KEY);
    assert.equal(store.get().imageApiKey, env.IMAGE_API_KEY);
    store.save({ providers: draft.providers.map((p, i) => ({ ...p, apiKey: '', clearKey: true,
      ...(changeAddress ? { baseUrl: `http://localhost:${1234 + i}/v1` } : {}),
    })), routes: draft.routes });
    const restarted = createConfigStore(file, env);
    assert.deepEqual(restarted.get(), store.get());
    assert.equal(restarted.get().apiKey, '');
    assert.equal(restarted.get().imageApiKey, '');
    assert.ok(restarted.get().providers.every(p => p.apiKey === ''));
    assert.ok(restarted.public().providers.every(p => p.hasKey === false));
    // Subsequent blank form submissions must not resurrect the environment keys.
    restarted.save({ providers: restarted.public().providers, routes: restarted.public().routes });
    assert.equal(createConfigStore(file, env).get().apiKey, '');
    assert.equal(createConfigStore(file, env).get().imageApiKey, '');
  });
}
test('v2 disk catalog still rejects invalid saved providers and routes', (t) => {
  const file = fixture(t), store = createConfigStore(file, {});
  store.save({ providers: store.public().providers, routes: store.public().routes });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const invalid of [
    { ...saved, providers: undefined },
    { ...saved, routes: undefined },
    { ...saved, providers: saved.providers.map(p => ({ ...p, apiKey: 42 })) },
    { ...saved, providers: saved.providers.map(p => ({ ...p, baseUrl: 'http://remote.example/v1' })) },
    { ...saved, routes: { chat: { providerId: 'missing', model: 'missing' } } },
  ]) {
    fs.writeFileSync(file, JSON.stringify(invalid));
    assert.throws(() => createConfigStore(file, { CHAT_API_KEY: 'env-secret' }));
  }
});
test('deleting active providers clears runtime projection and never falls back to old destinations', async (t) => {
  const store = createConfigStore(fixture(t), { CHAT_API_KEY: 'old-secret' });
  store.save({ providers: [], routes: {} });
  assert.equal(store.get().apiKey, '');
  assert.equal(store.get().chatBaseUrl, '');
  assert.equal(store.get().chatModel, '');
  let called = false;
  await assert.rejects(testChatConnection(store.get(), async () => { called = true; }), /请先配置/);
  assert.equal(called, false);
  assert.throws(() => imageConnection(store.get()), /请先配置/);
  assert.equal(store.public().routes.transcription, null);
});
test('five capability routes persist and actual chat/image use selected provider, key and model', async (t) => {
  const store = createConfigStore(fixture(t), {});
  const provider = { id: 'mock-provider', name: 'Mock', preset: 'custom', protocol: 'openai', baseUrl: 'http://localhost:1234/v1', apiKey: 'selected-secret', imageProtocol: 'openai-images', defaultModel: 'multi', models: [{ id: 'multi', capabilities: ['chat', 'image', 'transcription', 'embedding', 'video'] }] };
  const routes = Object.fromEntries(provider.models[0].capabilities.map(c => [c, { providerId: provider.id, model: 'multi' }]));
  store.save({ providers: [provider], routes });
  const requests = [];
  await testAndSaveChatConfig(store, { providers: store.public().providers, routes }, async (url, options) => {
    requests.push({ url, key: options.headers.Authorization, model: JSON.parse(options.body).model });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  assert.deepEqual(requests[0], { url: 'http://localhost:1234/v1/chat/completions', key: 'Bearer selected-secret', model: 'multi' });
  assert.deepEqual(imageConnection(store.get()), { baseUrl: provider.baseUrl, apiKey: provider.apiKey, protocol: 'openai-images' });
  assert.equal(store.get().imageModel, 'multi');
  assert.deepEqual(store.public().routes, routes);
});
test('save, retain keys, restart, clear keys, and secret-free public response', (t) => {
  const file = fixture(t);
  const env = { DASHSCOPE_API_KEY: 'legacy-test-key' };
  const store = createConfigStore(file, env);
  const saved = store.save({ chatBaseUrl: 'https://model.example/v1/chat/completions/', chatModel: 'custom', apiKey: 'chat-test-key', imageApiKey: 'image-test-key' });
  assert.equal(saved.chatBaseUrl, 'https://model.example/v1');
  assert.equal(JSON.stringify(saved).includes('test-key'), false);
  store.save({ apiKey: '', imageApiKey: '', chatModel: 'custom-2' });
  assert.equal(createConfigStore(file, env).get().apiKey, 'chat-test-key');
  assert.equal(store.get().imageApiKey, 'image-test-key');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  store.save({ clearChatKey: true, clearImageKey: true });
  assert.equal(createConfigStore(file, env).get().apiKey, '');
  assert.equal(createConfigStore(file, env).get().imageApiKey, '');
});
test('reject invalid settings atomically and require a new key for a new destination', (t) => {
  const store = createConfigStore(fixture(t), { CHAT_API_KEY: 'private-test-key' });
  const before = store.get();
  for (const patch of [{ chatBaseUrl: 'http://remote.example/v1' }, { chatBaseUrl: 'https://new.example/v1' }, { chatModel: '' }, { apiKey: 5 }, { chatBaseUrl: 'https://user:password@example.com/v1' }, { imageProtocol: 'guess-from-url' }]) assert.throws(() => store.save(patch));
  assert.deepEqual(store.get(), before);
  assert.equal(configCandidate(before, { chatBaseUrl: 'http://localhost:1234/v1', clearChatKey: true }).apiKey, '');
});
test('legacy saved image config defaults to DashScope synchronous protocol', (t) => {
  const file = fixture(t);
  fs.writeFileSync(file, JSON.stringify({ imageBaseUrl: 'https://images.example/api/v1', imageModel: 'legacy-image', imageApiKey: 'legacy-key' }));
  const store = createConfigStore(file, {});
  assert.equal(store.get().imageProtocol, 'dashscope-multimodal');
  assert.equal(store.public().imageProtocol, 'dashscope-multimodal');
  assert.equal(JSON.stringify(store.public()).includes('legacy-key'), false);
});
test('connection errors do not echo provider bodies or credentials', async () => {
  const cfg = { chatBaseUrl: 'https://example.com/v1', chatModel: 'test', apiKey: 'secret' };
  await assert.rejects(testChatConnection(cfg, async () => new Response('secret', { status: 401 })), /HTTP 401/);
  await assert.rejects(testChatConnection(cfg, async () => new Response('{}')), /有效的聊天内容/);
  await assert.rejects(testChatConnection(cfg, async () => { throw new Error('secret'); }), (err) => !err.message.includes('secret'));
});
test('saved URL, key and model are used by both connection test and actual chat', async (t) => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw); requests.push({ url: req.url, auth: req.headers.authorization, body });
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"mock reply"}}]}\n\ndata: [DONE]\n\n');
    } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] })); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const store = createConfigStore(fixture(t), {});
  store.save({ chatBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, chatModel: 'my-model', apiKey: 'mock-chat-key' });
  assert.equal((await testChatConnection(store.get())).ok, true);
  const session = { messages: [] };
  await runChatTurn({ config: store.get(), session, systemPrompt: 'test', userMessage: 'hello', onEvent() {} });
  assert.equal(session.messages.at(-1).content, 'mock reply');
  for (const req of requests) {
    assert.equal(req.url, '/v1/chat/completions');
    assert.equal(req.auth, 'Bearer mock-chat-key');
    assert.equal(req.body.model, 'my-model');
  }
  assert.equal(publicConfig(store.get()).hasKey, true);
});

test('successful chat test saves and activates credentials while failed test preserves old config', async (t) => {
  const file = fixture(t);
  const store = createConfigStore(file, {});
  store.save({ chatBaseUrl: 'https://old.example/v1', chatModel: 'old-model', apiKey: 'old-key' });
  const input = { chatBaseUrl: 'https://new.example/v1', chatModel: 'new-model', apiKey: 'new-key' };
  await assert.rejects(testAndSaveChatConfig(store, input, async () => new Response('{"error":"bad"}', { status: 401 })), /HTTP 401/);
  assert.equal(store.get().chatModel, 'old-model');
  assert.equal(store.get().apiKey, 'old-key');

  const result = await testAndSaveChatConfig(store, input, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer new-key');
    assert.equal(JSON.parse(options.body).model, 'new-model');
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OK' } }] }), { headers: { 'Content-Type': 'application/json' } });
  });
  assert.equal(result.reply, 'OK');
  assert.equal(result.config.hasKey, true);
  assert.equal(createConfigStore(file, {}).get().apiKey, 'new-key');
  assert.equal(createConfigStore(file, {}).get().chatModel, 'new-model');
});
