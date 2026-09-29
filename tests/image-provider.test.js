import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateImage } from '../server/imagegen.js';
import { imageConnection, imageError, discoverImageModels, TOKEN_PLAN_IMAGE_BASE, DASHSCOPE_IMAGE_BASE } from '../server/image-provider.js';
import { createConfigStore } from '../server/config.js';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const result = { output: { choices: [{ message: { content: [{ text: 'generated' }, { image: 'https://asset.example/test.png' }] } }] } };
function directory(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-image-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }

test('Token Plan configuration persists, shares matching key, and rejects mixed destinations', (t) => {
  const file = path.join(directory(t), 'config.json');
  const env = { CHAT_BASE_URL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', CHAT_API_KEY: 'sk-sp-test' };
  const store = createConfigStore(file, env);
  const publicValue = store.save({ imageBaseUrl: TOKEN_PLAN_IMAGE_BASE, imageUseChatKey: true, imageModel: 'qwen-image-3.0-pro' });
  assert.equal(imageConnection(createConfigStore(file, env).get()).apiKey, 'sk-sp-test');
  assert.equal(JSON.stringify(publicValue).includes('sk-sp-test'), false);
  assert.throws(() => store.save({ imageBaseUrl: DASHSCOPE_IMAGE_BASE }), /同一 Token Plan/);
  assert.throws(() => imageConnection({ imageUseChatKey: true, apiKey: 'chat-key', chatBaseUrl: 'https://example.com/v1', imageBaseUrl: TOKEN_PLAN_IMAGE_BASE }), /同一 Token Plan/);
});
test('independent image credentials are selected explicitly without inferring service from key prefix', (t) => {
  const file = path.join(directory(t), 'config.json');
  const store = createConfigStore(file, { CHAT_API_KEY: 'chat-key-must-not-be-used' });
  const customBase = 'https://images.example.com/compatible-mode/v1';
  const publicValue = store.save({ imageBaseUrl: customBase, imageApiKey: 'sk-sp-custom-secret', imageUseChatKey: false, imageModel: 'custom-image-model' });
  const connection = imageConnection(store.get());
  assert.deepEqual(connection, { baseUrl: customBase, apiKey: 'sk-sp-custom-secret', protocol: 'dashscope-multimodal' });
  assert.equal(JSON.stringify(publicValue).includes('sk-sp-custom-secret'), false);
  assert.equal(publicValue.imageBaseUrl, customBase);
  assert.equal(imageError(new Error('provider echoed sk-sp-custom-secret')), 'provider echoed [已隐藏]');
});
test('image base URL only strips the endpoint suffix for the selected protocol', (t) => {
  const store = createConfigStore(path.join(directory(t), 'config.json'), {});
  const customBase = 'https://images.example.com/compatible-mode/v1';
  assert.equal(store.save({ imageBaseUrl: customBase, imageApiKey: 'custom-key' }).imageBaseUrl, customBase);
  assert.equal(store.save({ imageProtocol: 'openai-images', imageBaseUrl: customBase + '/images/generations', imageApiKey: 'custom-key' }).imageBaseUrl, customBase);
  assert.equal(store.save({ imageProtocol: 'openai-images', imageBaseUrl: customBase + '/services/aigc/multimodal-generation/generation', imageApiKey: 'custom-key' }).imageBaseUrl, customBase + '/services/aigc/multimodal-generation/generation');
});
test('OpenAI Images uses compatible-mode endpoint and body without polling', async (t) => {
  const calls = [];
  const baseUrl = 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
  await generateImage({ protocol: 'openai-images', prompt: 'test', apiKey: 'test-key', model: 'qwen-image-3.0', baseUrl, imagesDir: directory(t), fetcher: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? json({ data: [{ url: 'https://asset.example/openai.png' }] }) : new Response(PNG);
  } });
  assert.equal(calls[0].url, baseUrl + '/images/generations');
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'qwen-image-3.0', prompt: 'test', size: '1024x1024', n: 1 });
  assert.equal(calls[0].options.headers['X-DashScope-Async'], undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers, undefined);
});
test('synchronous image succeeds without requiring task_id and downloads without auth', async (t) => {
  const calls = [];
  const generated = await generateImage({ prompt: 'test', apiKey: 'sk-sp-test', model: 'qwen-image-3.0-pro', baseUrl: TOKEN_PLAN_IMAGE_BASE, imagesDir: directory(t), fetcher: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? json(result) : new Response(PNG);
  } });
  assert.equal(calls[0].url, TOKEN_PLAN_IMAGE_BASE + '/services/aigc/multimodal-generation/generation');
  assert.equal(calls[0].options.headers['X-DashScope-Async'], undefined);
  assert.equal(JSON.parse(calls[0].options.body).model, 'qwen-image-3.0-pro');
  assert.deepEqual(JSON.parse(calls[0].options.body).parameters, { prompt_extend: true, size: '1024*1024' });
  assert.equal(calls[1].options.headers, undefined);
  assert.deepEqual(fs.readFileSync(generated.localPath), PNG);
});
test('async task receipt is polled on the same configured service', async (t) => {
  const urls = [];
  await generateImage({ protocol: 'dashscope-image-async', prompt: 'test', apiKey: 'test', model: 'qwen-image', baseUrl: TOKEN_PLAN_IMAGE_BASE, imagesDir: directory(t), pollIntervalMs: 0, fetcher: async (url, options) => {
    urls.push(url);
    if (urls.length === 1) { assert.equal(options.headers['X-DashScope-Async'], 'enable'); return json({ output: { task_id: 'task-1', task_status: 'PENDING' } }); }
    if (urls.length === 2) return json({ output: { ...result.output, task_status: 'SUCCEEDED' } });
    return new Response(PNG);
  } });
  assert.equal(urls[0], TOKEN_PLAN_IMAGE_BASE + '/services/aigc/image-generation/generation');
  assert.equal(urls[1], TOKEN_PLAN_IMAGE_BASE + '/tasks/task-1');
});
test('failed generation is not retried or routed to pay-as-you-go and redacts keys', async (t) => {
  let calls = 0;
  await assert.rejects(generateImage({ prompt: 'test', apiKey: 'sk-sp-test', model: 'qwen-image-3.0-pro', imagesDir: directory(t), fetcher: async () => { calls++; return json({ code: 'InvalidApiKey', message: 'bad sk-sp-test' }, 401); } }), (err) => /HTTP 401/.test(err.message) && !err.message.includes('sk-sp-test'));
  assert.equal(calls, 1);
});
test('non-image downloads fail rather than claiming generation success', async (t) => {
  let calls = 0;
  await assert.rejects(generateImage({ prompt: 'test', apiKey: 'test', model: 'test', imagesDir: directory(t), fetcher: async () => ++calls === 1 ? json(result) : new Response('<html>error</html>') }), /不是有效/);
});
test('directory results distinguish listed models from documentation fallback', async () => {
  const config = { imageBaseUrl: TOKEN_PLAN_IMAGE_BASE, imageApiKey: 'sk-sp-test' };
  const listed = await discoverImageModels(config, async () => json({ data: [{ id: 'qwen-image-3.0-pro' }, { id: 'text-only' }] }));
  assert.equal(listed.models[0].evidence, 'listed');
  assert.equal(listed.models.some((m) => m.id === 'text-only'), false);
  const fallback = await discoverImageModels(config, async () => json({}, 404));
  assert.equal(fallback.models.every((m) => m.evidence === 'documented'), true);
  assert.match(fallback.reason, /尚未验证/);
  await assert.rejects(discoverImageModels(config, async () => json({}, 401)), /鉴权失败/);
});
test('model discovery uses the configured OpenAI base and DashScope compatible catalog', async () => {
  const urls = [];
  await discoverImageModels({ imageProtocol: 'openai-images', imageBaseUrl: 'https://workspace.example/compatible-mode/v1', imageApiKey: 'key' }, async (url) => { urls.push(url); return json({ data: [] }); });
  await discoverImageModels({ imageProtocol: 'dashscope-multimodal', imageBaseUrl: 'https://workspace.example/api/v1', imageApiKey: 'key' }, async (url) => { urls.push(url); return json({ data: [] }); });
  assert.deepEqual(urls, ['https://workspace.example/compatible-mode/v1/models', 'https://workspace.example/compatible-mode/v1/models']);
});

test('chat image tool consumes the configured image service and produces a local image', async (t) => {
  const { default: http } = await import('node:http');
  const { runChatTurn } = await import('../server/chat.js');
  const seen = []; let chatRound = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/asset.png') { assert.equal(req.headers.authorization, undefined); res.end(PNG); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); seen.push({ path: req.url, body });
    if (req.url === '/v1/chat/completions') {
      const delta = ++chatRound === 1 ? { tool_calls: [{ index: 0, id: 'image-call', function: { name: 'image_generate', arguments: '{"prompt":"a cat"}' } }] } : { content: '图片生成完成' };
      res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
    } else {
      assert.equal(req.headers.authorization, 'Bearer mock-image-key');
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${server.address().port}/asset.png` }] }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`; const events = [];
  await runChatTurn({ config: { apiKey: 'mock-chat-key', chatBaseUrl: base + '/v1', chatModel: 'auto', imageProtocol: 'openai-images', imageBaseUrl: base + '/compatible-mode/v1', imageApiKey: 'mock-image-key', imageModel: 'qwen-image-3.0', imagesDir: directory(t) }, session: { messages: [] }, systemPrompt: 'test', userMessage: '画一只河狸', onEvent: (e) => events.push(e) });
  assert.equal(seen[1].path, '/compatible-mode/v1/images/generations');
  assert.equal(seen[1].body.model, 'qwen-image-3.0');
  assert.equal(events.some((e) => e.type === 'image' && e.url.startsWith('/images/')), true);
  assert.equal(events.find((e) => e.type === 'tool_result').ok, true);
});

test('saved verification is visible only for the exact model, endpoint and effective key', (t) => {
  const file = path.join(directory(t), 'config.json');
  const store = createConfigStore(file, { CHAT_BASE_URL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', CHAT_API_KEY: 'sk-sp-test' });
  store.save({ imageBaseUrl: TOKEN_PLAN_IMAGE_BASE, imageUseChatKey: true, imageModel: 'qwen-image-3.0-pro' });
  store.recordImageTest(store.get(), { url: '/images/test.png', testedAt: '2026-09-25T00:00:00Z', latencyMs: 10 });
  assert.equal(store.public().imageVerification.ok, true);
  assert.equal(createConfigStore(file, {}).public().imageVerification.ok, true);
  store.save({ imageModel: 'wan2.7-image' });
  assert.equal(store.public().imageVerification, undefined);
  store.save({ imageModel: 'qwen-image-3.0-pro', apiKey: 'changed-key' });
  assert.equal(store.public().imageVerification, undefined);
});
test('saved verification also requires the exact image protocol', (t) => {
  const file = path.join(directory(t), 'config.json');
  const store = createConfigStore(file, {});
  store.save({ imageBaseUrl: 'https://images.example/api/v1', imageApiKey: 'image-key', imageModel: 'qwen-image-3.0', imageProtocol: 'dashscope-multimodal' });
  store.recordImageTest(store.get(), { url: '/images/test.png', testedAt: '2026-09-27T00:00:00Z', latencyMs: 10 });
  assert.equal(store.public().imageVerification.ok, true);
  store.save({ imageProtocol: 'dashscope-image-async' });
  assert.equal(store.public().imageVerification, undefined);
});
