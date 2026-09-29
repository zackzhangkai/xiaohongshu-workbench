import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DASHSCOPE_IMAGE_BASE, TOKEN_PLAN_IMAGE_BASE, DEFAULT_IMAGE_PROTOCOL, IMAGE_PROTOCOLS, isTokenPlan } from './image-provider.js';

export class ConfigError extends Error {}
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\r\n\x00-\x1f]/.test(value)) throw new ConfigError(`${label}不能为空，且不能包含换行或控制字符`);
  return value.trim();
};
export function normalizeBaseUrl(value) {
  const raw = text(value, 'API 地址', 2000);
  let url;
  try { url = new URL(raw); } catch { throw new ConfigError('请输入完整的 http:// 或 https:// API 地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ConfigError('API 地址不能包含账号、密码、查询参数或片段');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new ConfigError('远程 API 地址必须使用 HTTPS；本机服务可使用 HTTP');
  return url.href.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}
export function publicConfig(config) {
  const catalog = providerCatalog(config);
  return { schemaVersion: 2, providers: catalog.providers.map(({ apiKey, ...provider }) => ({ ...provider, hasKey: Boolean(apiKey) })), routes: catalog.routes, chatBaseUrl: config.chatBaseUrl, chatModel: config.chatModel, chatImageInput: config.chatImageInput === true, imageModel: config.imageModel, hasKey: Boolean(config.apiKey), hasImageKey: Boolean(config.imageApiKey), imageBaseUrl: config.imageBaseUrl || DASHSCOPE_IMAGE_BASE, imageProtocol: config.imageProtocol || DEFAULT_IMAGE_PROTOCOL, imageUseChatKey: Boolean(config.imageUseChatKey), imageSuggestion: isTokenPlan(config.chatBaseUrl) ? { imageBaseUrl: TOKEN_PLAN_IMAGE_BASE, imageProtocol: 'dashscope-multimodal', imageUseChatKey: true, imageModel: 'qwen-image-3.0-pro' } : null };
}
const imageEndpointSuffix = {
  'openai-images': '/images/generations',
  'dashscope-multimodal': '/services/aigc/multimodal-generation/generation',
  'dashscope-image-async': '/services/aigc/image-generation/generation',
};
export function configCandidate(current, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConfigError('配置格式无效');
  if (input.providers !== undefined || input.routes !== undefined) return providerCandidate(current, input);
  const next = { ...current };
  if (input.chatImageInput !== undefined) {
    if (typeof input.chatImageInput !== 'boolean') throw new ConfigError('聊天图片输入开关格式无效');
    next.chatImageInput = input.chatImageInput;
  }
  if (input.chatBaseUrl !== undefined) next.chatBaseUrl = normalizeBaseUrl(input.chatBaseUrl);
  for (const key of ['chatModel', 'imageModel']) if (input[key] !== undefined) next[key] = text(input[key], key === 'chatModel' ? '聊天模型名称' : '生图模型名称');
  for (const key of ['apiKey', 'imageApiKey']) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new ConfigError('API Key 格式无效');
    if (input[key]?.trim()) next[key] = text(input[key], 'API Key', 8192);
  }
  if (input.clearImageKey === true) next.imageApiKey = '';
  if (input.clearChatKey === true) next.apiKey = '';
  if (next.chatBaseUrl !== current.chatBaseUrl && current.apiKey && !input.apiKey?.trim() && !input.clearChatKey) throw new ConfigError('修改 API 地址后，请重新填写该服务的 Key；本机免 Key 服务可勾选清除 Key');
  if (input.imageProtocol !== undefined) {
    if (typeof input.imageProtocol !== 'string' || !IMAGE_PROTOCOLS.includes(input.imageProtocol)) throw new ConfigError('生图接口协议无效');
    next.imageProtocol = input.imageProtocol;
  }
  const imageProtocol = next.imageProtocol || DEFAULT_IMAGE_PROTOCOL;
  if (input.imageBaseUrl !== undefined) next.imageBaseUrl = normalizeBaseUrl(input.imageBaseUrl).replace(new RegExp(`${imageEndpointSuffix[imageProtocol].replaceAll('/', '\\/')}$`), '');
  if (input.imageUseChatKey !== undefined) {
    if (typeof input.imageUseChatKey !== 'boolean') throw new ConfigError('生图 Key 来源格式无效');
    next.imageUseChatKey = input.imageUseChatKey;
  }
  if (next.imageUseChatKey && (!isTokenPlan(next.imageBaseUrl) || !isTokenPlan(next.chatBaseUrl))) throw new ConfigError('仅同一 Token Plan 服务可复用聊天 Key');
  if (next.imageBaseUrl !== current.imageBaseUrl && current.imageApiKey && !next.imageUseChatKey && !input.imageApiKey?.trim() && !input.clearImageKey) throw new ConfigError('切换生图地址后，请重新填写对应服务的生图 Key');
  if (current.schemaVersion === 2) {
    // Legacy callers are projected back into the selected routes, never ignored.
    const catalog = providerCatalog(current);
    for (const [scope, base, model, key] of [['chat', 'chatBaseUrl', 'chatModel', 'apiKey'], ['image', 'imageBaseUrl', 'imageModel', 'imageApiKey']]) {
      const changedKeys = scope === 'chat' ? ['chatBaseUrl', 'chatModel', 'apiKey', 'clearChatKey'] : ['imageBaseUrl', 'imageModel', 'imageApiKey', 'clearImageKey', 'imageProtocol', 'imageUseChatKey'];
      if (!changedKeys.some(key => input[key] !== undefined)) continue;
      const route = catalog.routes[scope];
      const provider = catalog.providers.find(p => p.id === route?.providerId);
      if (!provider) continue;
      provider.baseUrl = next[base]; provider.apiKey = scope === 'image' && next.imageUseChatKey ? next.apiKey : next[key];
      if (!provider.models.some(m => m.id === next[model])) provider.models.push({ id: next[model], capabilities: [scope] });
      catalog.routes[scope] = { providerId: provider.id, model: next[model] };
      if (scope === 'image') provider.imageProtocol = next.imageProtocol;
    }
    return projectCatalog({ ...next, ...catalog });
  }
  return next;
}

export const MODEL_CAPABILITIES = ['chat', 'transcription', 'embedding', 'image', 'video'];
export function providerCatalog(config) {
  if (config.schemaVersion === 2) return structuredClone({ providers: config.providers, routes: config.routes });
  const providers = [
    { id: 'legacy-chat', name: '聊天服务', preset: 'custom', protocol: 'openai', baseUrl: config.chatBaseUrl, apiKey: config.apiKey || '', models: [{ id: config.chatModel, capabilities: ['chat'] }], defaultModel: config.chatModel, imageProtocol: 'openai-images' },
    { id: 'legacy-image', name: '图片服务', preset: 'custom', protocol: 'openai', baseUrl: config.imageBaseUrl || DASHSCOPE_IMAGE_BASE, apiKey: config.imageUseChatKey ? config.apiKey : config.imageApiKey || '', models: [{ id: config.imageModel, capabilities: ['image'] }], defaultModel: config.imageModel, imageProtocol: config.imageProtocol || DEFAULT_IMAGE_PROTOCOL },
  ];
  return { providers, routes: { chat: { providerId: 'legacy-chat', model: config.chatModel }, image: { providerId: 'legacy-image', model: config.imageModel }, transcription: null, embedding: null, video: null } };
}
export function turnModelConfig(config, selections) {
  if (selections === undefined) return { ...config };
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) throw new ConfigError('本轮模型选择无效');
  const catalog = providerCatalog(config);
  for (const [scope, route] of Object.entries(selections)) {
    if (!['chat', 'image'].includes(scope)) throw new ConfigError('不支持的本轮模型能力');
    if (route === null) continue;
    const provider = catalog.providers.find(p => p.id === route?.providerId);
    if (!provider?.models.some(m => m.id === route?.model && m.capabilities.includes(scope))) throw new ConfigError('所选模型已移除或能力不匹配，请重新选择');
    catalog.routes[scope] = { providerId: provider.id, model: route.model };
  }
  return projectCatalog({ ...config, ...catalog });
}
function projectCatalog(config) {
  const next = { ...config, schemaVersion: 2, imageUseChatKey: false };
  for (const scope of ['chat', 'image']) {
    const route = config.routes[scope];
    const provider = config.providers.find(p => p.id === route?.providerId);
    if (scope === 'chat') Object.assign(next, { chatBaseUrl: provider?.baseUrl || '', chatModel: route?.model || '', apiKey: provider?.apiKey || '' });
    else Object.assign(next, { imageBaseUrl: provider?.baseUrl || DASHSCOPE_IMAGE_BASE, imageModel: route?.model || '', imageApiKey: provider?.apiKey || '', imageProtocol: provider?.imageProtocol || 'openai-images' });
  }
  return next;
}
function providerCandidate(current, input) {
  const existing = providerCatalog(current);
  const raw = input.providers ?? existing.providers;
  if (!Array.isArray(raw) || raw.length > 50) throw new ConfigError('供应商列表无效（最多 50 个）');
  const ids = new Set();
  const providers = raw.map(p => {
    if (!p || typeof p !== 'object') throw new ConfigError('供应商格式无效');
    const id = text(p.id, '供应商 ID', 100);
    if (ids.has(id) || id === 'official') throw new ConfigError('供应商 ID 重复或不可用');
    ids.add(id);
    const old = existing.providers.find(item => item.id === id);
    const baseUrl = normalizeBaseUrl(p.baseUrl);
    if (p.protocol !== 'openai') throw new ConfigError('当前仅支持 OpenAI 兼容协议；不支持 Anthropic / Gemini 原生协议');
    if (p.clearKey !== undefined && typeof p.clearKey !== 'boolean') throw new ConfigError('清除 Key 开关格式无效');
    if (p.apiKey !== undefined && typeof p.apiKey !== 'string') throw new ConfigError('API Key 格式无效');
    if (old?.apiKey && old.baseUrl !== baseUrl && !p.apiKey?.trim() && !p.clearKey) throw new ConfigError('修改 API 地址后，请重新填写该服务的 Key 或明确清除 Key');
    const apiKey = p.clearKey ? '' : p.apiKey?.trim() ? text(p.apiKey, 'API Key', 8192) : old?.apiKey || '';
    if (!Array.isArray(p.models) || p.models.length > 500) throw new ConfigError('模型列表无效');
    const modelIds = new Set();
    const models = p.models.map(m => {
      const modelId = text(m?.id, '模型 ID');
      if (modelIds.has(modelId)) throw new ConfigError('同一供应商中模型 ID 不可重复');
      modelIds.add(modelId);
      if (!Array.isArray(m.capabilities) || !m.capabilities.length || m.capabilities.some(c => !MODEL_CAPABILITIES.includes(c))) throw new ConfigError('模型能力无效');
      return { id: modelId, capabilities: [...new Set(m.capabilities)] };
    });
    const defaultModel = p.defaultModel || '';
    if (defaultModel && !modelIds.has(defaultModel)) throw new ConfigError('默认模型不存在');
    if (!IMAGE_PROTOCOLS.includes(p.imageProtocol)) throw new ConfigError('生图接口协议无效');
    return { id, name: text(p.name, '供应商名称'), preset: typeof p.preset === 'string' ? p.preset.slice(0, 100) : 'custom', protocol: 'openai', baseUrl, apiKey, models, defaultModel, imageProtocol: p.imageProtocol };
  });
  const rawRoutes = input.routes ?? existing.routes;
  if (!rawRoutes || typeof rawRoutes !== 'object' || Array.isArray(rawRoutes)) throw new ConfigError('能力配置无效');
  const routes = {};
  for (const capability of MODEL_CAPABILITIES) {
    const route = rawRoutes[capability];
    if (route == null) { routes[capability] = null; continue; }
    const provider = providers.find(p => p.id === route.providerId);
    if (!provider?.models.some(m => m.id === route.model && m.capabilities.includes(capability))) throw new ConfigError('能力所选供应商或模型不存在，或模型能力不匹配');
    routes[capability] = { providerId: provider.id, model: route.model };
  }
  if (input.chatImageInput !== undefined && typeof input.chatImageInput !== 'boolean') throw new ConfigError('聊天图片输入开关格式无效');
  return projectCatalog({ ...current, providers, routes, chatImageInput: input.chatImageInput ?? current.chatImageInput });
}

export async function discoverProviderModels(config, providerId, fetcher = fetch) {
  const provider = providerCatalog(config).providers.find(p => p.id === providerId);
  if (!provider) throw new ConfigError('供应商不存在');
  let response;
  try {
    response = await fetcher(`${provider.baseUrl}/models`, { headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}, redirect: 'error', signal: AbortSignal.timeout(12000) });
  } catch { throw new ConfigError('无法连接模型目录，可手动添加模型后保存'); }
  if (!response.ok) throw new ConfigError(`模型目录不可用（HTTP ${response.status}），可手动添加模型`);
  let body; try { body = await response.json(); } catch { throw new ConfigError('模型目录返回格式无效'); }
  if (!Array.isArray(body.data)) throw new ConfigError('服务未返回模型目录，可手动添加模型');
  return { models: [...new Set(body.data.map(m => m?.id).filter(id => typeof id === 'string' && id.length <= 200))].slice(0, 500) };
}
export function createConfigStore(filePath, env = process.env) {
  let current = {
    apiKey: env.CHAT_API_KEY || env.DASHSCOPE_API_KEY || '',
    chatBaseUrl: normalizeBaseUrl(env.CHAT_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
    chatModel: env.CHAT_MODEL || 'qwen-plus',
    chatImageInput: false,
    imageModel: env.IMAGE_MODEL || 'qwen-image',
    imageBaseUrl: DASHSCOPE_IMAGE_BASE,
    imageProtocol: DEFAULT_IMAGE_PROTOCOL,
    imageUseChatKey: false,
    imageApiKey: env.IMAGE_API_KEY || env.DASHSCOPE_API_KEY || '',
  };
  if (fs.existsSync(filePath)) {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (saved.schemaVersion === 2) {
      // Disk v2 is a complete catalog, not a redacted edit request. Never merge
      // its empty keys with environment-derived legacy provider credentials.
      if (!Array.isArray(saved.providers) || !saved.routes || typeof saved.routes !== 'object' || Array.isArray(saved.routes)) throw new ConfigError('已保存的供应商配置格式无效');
      current = providerCandidate({ ...current, schemaVersion: 2, providers: [], routes: {} }, saved);
    } else {
      current = configCandidate(current, { ...saved, clearChatKey: saved.apiKey === '', clearImageKey: saved.imageApiKey === '' });
    }
  }
  const visionEvidenceFile = path.join(path.dirname(filePath), 'vision-verification.json');
  const visionFingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify([value.chatBaseUrl, value.chatModel, value.apiKey, value.chatImageInput === true])).digest('hex');
  const evidenceFile = path.join(path.dirname(filePath), 'image-verification.json');
  const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify([value.imageBaseUrl, value.imageProtocol || DEFAULT_IMAGE_PROTOCOL, value.imageModel, value.imageUseChatKey ? value.apiKey : value.imageApiKey])).digest('hex');
  const getPublic = () => {
    const value = publicConfig(current);
    value.visionVerification = null;
    try {
      const evidence = JSON.parse(fs.readFileSync(visionEvidenceFile, 'utf8'));
      if (evidence.fingerprint === visionFingerprint(current)) value.visionVerification = evidence.result;
    } catch { /* Unverified or configuration changed. */ }
    try {
      const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
      if (evidence.fingerprint === fingerprint(current)) value.imageVerification = evidence.result;
    } catch { /* No matching completed test yet. */ }
    return value;
  };
  return {
    get: () => ({ ...current }),
    public: getPublic,
    recordVisionTest(config, result) {
      const record = { fingerprint: visionFingerprint(config), result: { ok: true, model: config.chatModel, testedAt: result.testedAt, latencyMs: result.latencyMs } };
      fs.mkdirSync(path.dirname(visionEvidenceFile), { recursive: true });
      fs.writeFileSync(visionEvidenceFile + '.tmp', JSON.stringify(record, null, 2), { mode: 0o600 });
      fs.chmodSync(visionEvidenceFile + '.tmp', 0o600);
      fs.renameSync(visionEvidenceFile + '.tmp', visionEvidenceFile);
    },
    recordImageTest(config, result) {
      const record = { fingerprint: fingerprint(config), result: { ok: true, model: config.imageModel, url: result.url, testedAt: result.testedAt, latencyMs: result.latencyMs } };
      fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
      fs.writeFileSync(evidenceFile + '.tmp', JSON.stringify(record, null, 2), { mode: 0o600 });
      fs.renameSync(evidenceFile + '.tmp', evidenceFile);
    },
    save(input) {
      const next = configCandidate(current, input);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (current.schemaVersion !== 2 && next.schemaVersion === 2 && fs.existsSync(filePath)) {
        const backup = `${filePath}.v1-backup`;
        if (!fs.existsSync(backup)) { fs.copyFileSync(filePath, backup, fs.constants.COPYFILE_EXCL); fs.chmodSync(backup, 0o600); }
      }
      const tmp = `${filePath}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
        fs.chmodSync(tmp, 0o600);
        fs.renameSync(tmp, filePath);
      } catch { throw new Error('无法保存本机配置，请检查数据目录写入权限'); }
      if (visionFingerprint(next) !== visionFingerprint(current)) {
        // Keep evidence from an explicit test of this exact candidate, otherwise invalidate.
        try {
          const evidence = JSON.parse(fs.readFileSync(visionEvidenceFile, 'utf8'));
          if (evidence.fingerprint !== visionFingerprint(next)) fs.unlinkSync(visionEvidenceFile);
        } catch { /* No prior verification. */ }
      }
      current = next;
      return getPublic();
    },
  };
}
export async function testChatConnection(config, fetcher = fetch) {
  if (!config.chatModel || !config.chatBaseUrl) throw new ConfigError('请先配置对话与智能体的供应商和模型');
  const started = Date.now();
  let response;
  try {
    response = await fetcher(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.chatModel, messages: [{ role: 'user', content: 'Reply with OK only.' }], max_tokens: 16, stream: false }),
    });
  } catch (e) { throw new ConfigError(e.name === 'TimeoutError' ? '连接超时（20 秒），请检查地址和服务状态' : '无法连接模型服务，请检查地址、网络或代理设置'); }
  if (!response.ok) {
    const hints = { 401: 'Key 无效或已过期', 403: 'Key 没有访问权限', 404: '地址或模型名称不正确', 429: '请求限流或额度不足' };
    throw new ConfigError(`连接测试失败：HTTP ${response.status}，${hints[response.status] || '服务拒绝了请求，请检查模型名称和接口兼容性'}`);
  }
  let result;
  try { result = await response.json(); } catch { throw new ConfigError('服务返回了非 JSON 内容，请检查 API 地址'); }
  const reply = result.choices?.[0]?.message?.content;
  if (result.error || typeof reply !== 'string' || !reply.trim()) throw new ConfigError('服务未返回有效的聊天内容，请确认支持 /chat/completions');
  return { ok: true, latencyMs: Date.now() - started, model: config.chatModel, reply: reply.trim().slice(0, 200) };
}

export async function testAndSaveChatConfig(store, input, fetcher = fetch) {
  const candidate = configCandidate(store.get(), input);
  const result = await testChatConnection(candidate, fetcher);
  const config = store.save(input);
  return { ...result, config };
}
