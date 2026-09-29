import test from 'node:test';
import assert from 'node:assert/strict';
import { turnModelConfig } from '../server/config.js';

const config = {
  schemaVersion: 2, chatImageInput: false,
  providers: [
    { id: 'a', baseUrl: 'http://localhost:1001/v1', apiKey: 'key-a', models: [{ id: 'same', capabilities: ['chat'] }] },
    { id: 'b', baseUrl: 'http://localhost:1002/v1', apiKey: 'key-b', imageProtocol: 'openai-images', models: [{ id: 'same', capabilities: ['chat'] }, { id: 'picture', capabilities: ['image'] }] },
  ],
  routes: { chat: { providerId: 'a', model: 'same' }, image: null },
  chatBaseUrl: 'http://localhost:1001/v1', chatModel: 'same', apiKey: 'key-a',
};

test('turn routes resolve provider credentials and protocol without changing defaults', () => {
  const before = structuredClone(config);
  const selected = turnModelConfig(config, { chat: { providerId: 'b', model: 'same' }, image: { providerId: 'b', model: 'picture' } });
  assert.equal(selected.chatBaseUrl, config.providers[1].baseUrl);
  assert.equal(selected.apiKey, 'key-b');
  assert.equal(selected.imageApiKey, 'key-b');
  assert.equal(selected.imageModel, 'picture');
  assert.equal(selected.imageProtocol, 'openai-images');
  assert.equal(selected.chatImageInput, false);
  assert.deepEqual(config, before);
  assert.equal(turnModelConfig(config, { chat: null, image: null }).apiKey, 'key-a');
  assert.deepEqual(turnModelConfig(config), config);
});

test('removed models, unknown providers and capability mismatches fail closed', () => {
  for (const selection of [null, [], { video: null }, { chat: {} }, { chat: { providerId: 'missing', model: 'same' } }, { chat: { providerId: 'b', model: 'picture' } }, { image: { providerId: 'b', model: 'deleted' } }]) {
    assert.throws(() => turnModelConfig(config, selection));
  }
});

test('legacy image key reuse remains tied to original provider when chat changes', () => {
  const legacy = { chatModel: 'text', chatBaseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', apiKey: 'legacy-key', imageUseChatKey: true, imageModel: 'image', imageProtocol: 'dashscope-multimodal' };
  const result = turnModelConfig(legacy, { chat: null, image: { providerId: 'legacy-image', model: 'image' } });
  assert.equal(result.imageApiKey, 'legacy-key');
  assert.equal(result.imageUseChatKey, false);
  assert.equal(result.imageProtocol, 'dashscope-multimodal');
});
