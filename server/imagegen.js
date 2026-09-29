import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DASHSCOPE_IMAGE_BASE, DEFAULT_IMAGE_PROTOCOL, IMAGE_PROTOCOLS, imageError } from './image-provider.js';

const GENERATION_PATHS = {
  'openai-images': '/images/generations',
  'dashscope-multimodal': '/services/aigc/multimodal-generation/generation',
  'dashscope-image-async': '/services/aigc/image-generation/generation',
};
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function providerFailure(data, status, key) {
  const code = data?.code || data?.error?.code || data?.output?.code || '';
  const detail = data?.message || data?.error?.message || data?.output?.message || '';
  const hints = { 401: 'Key 无效或与服务地址不匹配', 403: '当前 Key 没有此模型权限', 404: '模型或接口地址不存在', 429: '额度不足或请求限流' };
  return new Error(imageError(`图片生成失败${status ? `（HTTP ${status}）` : ''}：${hints[status] || code || '模型服务异常'}${detail ? ` · ${detail}` : ''}`, key));
}
function imageUrl(data) {
  return data?.data?.find((item) => typeof item.url === 'string')?.url || data?.output?.choices?.flatMap((c) => c.message?.content || []).find((part) => typeof part.image === 'string')?.image;
}
function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('模型返回的下载内容不是有效的 PNG、JPEG 或 WebP 图片');
}
async function downloadImage(url, fetcher, signal) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('模型返回了无效的图片地址'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('模型返回了不支持的图片地址');
  const res = await fetcher(url, { signal }); // Never forward the model API key to an asset URL.
  if (!res.ok) throw new Error(`图片已生成，但下载失败（HTTP ${res.status}）`);
  if (Number(res.headers.get('content-length')) > MAX_IMAGE_BYTES) throw new Error('图片超过 30 MB 下载限制');
  const chunks = []; let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error('图片超过 30 MB 下载限制');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** One submission only. The configured protocol determines request shape and whether polling is allowed. */
export async function generateImage({ prompt, apiKey, model, baseUrl = DASHSCOPE_IMAGE_BASE, protocol = DEFAULT_IMAGE_PROTOCOL, imagesDir, publicPrefix = '/images', fetcher = fetch, pollIntervalMs = 1500, timeoutMs = 360000 }) {
  if (!apiKey) throw new Error('请先配置生图 API Key');
  if (!IMAGE_PROTOCOLS.includes(protocol)) throw new Error('生图接口协议无效');
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const openai = protocol === 'openai-images';
    const asynchronous = protocol === 'dashscope-image-async';
    const createRes = await fetcher(`${baseUrl}${GENERATION_PATHS[protocol]}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(asynchronous ? { 'X-DashScope-Async': 'enable' } : {}) },
      body: JSON.stringify(openai
        ? { model, prompt, size: '1024x1024', n: 1 }
        : { model, input: { messages: [{ role: 'user', content: [{ text: prompt }] }] }, parameters: { prompt_extend: true, size: '1024*1024' } }),
    });
    let result;
    try { result = await createRes.json(); } catch { throw new Error(`生图接口返回非 JSON 内容（HTTP ${createRes.status}），请检查服务地址`); }
    if (!createRes.ok || result.code || result.error) throw providerFailure(result, createRes.status, apiKey);
    const taskId = result.output?.task_id;
    if (asynchronous && !imageUrl(result) && taskId) {
      while (!signal.aborted) {
        const status = result.output?.task_status;
        if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(status)) throw providerFailure(result, null, apiKey);
        if (status === 'SUCCEEDED') break;
        await delay(pollIntervalMs);
        const poll = await fetcher(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal });
        result = await poll.json();
        if (!poll.ok || result.code || result.error) throw providerFailure(result, poll.status, apiKey);
      }
    }
    signal.throwIfAborted();
    const url = imageUrl(result);
    if (!url) throw new Error('模型未返回图片结果，请确认所选模型支持该文生图接口');
    const bytes = await downloadImage(url, fetcher, signal);
    const extension = imageExtension(bytes);
    fs.mkdirSync(imagesDir, { recursive: true });
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const localPath = path.join(imagesDir, fileName);
    fs.writeFileSync(localPath, bytes, { flag: 'wx' });
    return { url: `${publicPrefix}/${fileName}`, localPath, prompt, model };
  } catch (e) {
    if (signal.aborted) throw new Error('生图等待超时，服务可能已受理。未自动重试，请先查看服务商用量或任务记录，避免重复消耗。');
    throw new Error(imageError(e, apiKey));
  }
}
