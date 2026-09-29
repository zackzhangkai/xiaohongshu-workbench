export function localEndpoint(value = 'http://127.0.0.1:8788') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('地址必须为 http://127.0.0.1:端口');
  return url.origin;
}
export function knowledgeNoteUrl(settings, noteId) {
  if (!/^[0-9a-f-]{36}$/.test(noteId || '')) throw new Error('知识库笔记地址无效');
  const url = new URL(localEndpoint(settings.endpoint));
  url.searchParams.set('knowledgeNote', noteId);
  url.hash = 'knowledge';
  return url.href;
}
export async function localRequest(settings, route, payload) {
  const endpoint = localEndpoint(settings.endpoint);
  if (!/^[a-f0-9]{64}$/.test(settings.key || '')) throw new Error('请先在插件设置中填写工作台配对码');
  let response;
  try {
    response = await fetch(`${endpoint}/api/collector/${route}`, {
      method: payload ? 'POST' : 'GET', headers: { Authorization: `Bearer ${settings.key}`, ...(payload ? { 'Content-Type': 'application/json' } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(20000),
    });
  } catch { throw new Error('无法连接本机工作台，请启动服务并检查端口；未确认保存成功时可重新采集'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `工作台返回错误 ${response.status}`);
  return result;
}
export async function downloadImage(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !/(^|\.)(xhscdn|rednotecdn)\.com$/.test(url.hostname) || url.username || url.password) throw new Error('图片地址不在支持的素材域名内');
  const response = await fetch(url.href, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok || !/^image\/(png|jpeg|webp|gif)(;|$)/i.test(response.headers.get('content-type') || '')) throw new Error('图片下载失败或格式不支持');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) throw new Error('单图超过 5MB');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let binary = '';
  for (const chunk of chunks) for (let i = 0; i < chunk.length; i += 8192) binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
  return { base64: btoa(binary), size };
}
