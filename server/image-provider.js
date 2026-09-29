export const TOKEN_PLAN_IMAGE_BASE = 'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1';
export const DASHSCOPE_IMAGE_BASE = 'https://dashscope.aliyuncs.com/api/v1';
export const IMAGE_PROTOCOLS = ['openai-images', 'dashscope-multimodal', 'dashscope-image-async'];
export const DEFAULT_IMAGE_PROTOCOL = 'dashscope-multimodal';
export const IMAGE_CATALOG_SOURCE = 'https://help.aliyun.com/zh/model-studio/token-plan-personal-overview';
export const TOKEN_PLAN_IMAGE_MODELS = ['qwen-image-3.0-pro', 'wan2.7-image', 'wan2.7-image-pro'];
export function isTokenPlan(base) {
  try { return new URL(base).hostname === 'token-plan.cn-beijing.maas.aliyuncs.com'; } catch { return false; }
}
export function imageConnection(config) {
  if (config.schemaVersion === 2 && !config.routes?.image) throw new Error('请先配置图片生成的供应商和模型');
  const baseUrl = config.imageBaseUrl || DASHSCOPE_IMAGE_BASE;
  const protocol = config.imageProtocol || DEFAULT_IMAGE_PROTOCOL;
  if (config.imageUseChatKey && (!isTokenPlan(baseUrl) || !isTokenPlan(config.chatBaseUrl))) throw new Error('仅同一 Token Plan 服务可复用聊天 Key');
  const apiKey = config.imageUseChatKey ? config.apiKey : config.imageApiKey;
  if (!apiKey) throw new Error('请先配置生图 API Key，或选择复用 Token Plan 聊天 Key');
  return { baseUrl, apiKey, protocol };
}
export function imageError(error, key = '') {
  let text = String(error?.message || error);
  if (key) text = text.split(key).join('[已隐藏]');
  return text.replace(/sk-[a-zA-Z0-9_-]+/g, '[已隐藏]').slice(0, 600);
}
export async function discoverImageModels(config, fetcher = fetch) {
  const { baseUrl, apiKey, protocol } = imageConnection(config);
  const tokenPlan = isTokenPlan(baseUrl);
  const recommended = tokenPlan ? TOKEN_PLAN_IMAGE_MODELS : ['qwen-image-3.0-pro', 'qwen-image-3.0', 'qwen-image-max', 'qwen-image-plus'];
  let listed = [], reason = '';
  try {
    const modelsUrl = protocol === 'openai-images' ? `${baseUrl}/models` : `${new URL(baseUrl).origin}/compatible-mode/v1/models`;
    const response = await fetcher(modelsUrl, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(12000) });
    if (response.status === 401 || response.status === 403) throw new Error(`模型目录鉴权失败（HTTP ${response.status}），请检查 Key 与服务地址是否匹配`);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.data)) listed = data.data.map((m) => m.id).filter((id) => typeof id === 'string' && /^(qwen-image|wan[\d.]+-image)/.test(id) && !/edit|i2v|t2v/i.test(id));
      reason = listed.length ? '接口目录已返回候选模型，仍需试生成确认权限和额度。' : '接口目录未列出图片模型，以下为官方文档候选，尚未验证当前 Key 的权限。';
    } else reason = `模型目录暂不可用（HTTP ${response.status}），以下为官方文档候选，尚未验证当前 Key 的权限。`;
  } catch (e) {
    if (/鉴权失败/.test(e.message)) throw e;
    reason = '模型目录无法连接，以下为官方文档候选，尚未验证当前 Key 的权限。';
  }
  return { models: [...new Set([...listed, ...recommended])].map((id) => ({ id, evidence: listed.includes(id) ? 'listed' : 'documented' })), reason, sourceUrl: tokenPlan ? IMAGE_CATALOG_SOURCE : 'https://help.aliyun.com/zh/model-studio/qwen-image-api', catalogDate: '2026-09-25' };
}
