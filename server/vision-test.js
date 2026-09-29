import { deflateSync } from 'node:zlib';
import { ConfigError } from './config.js';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}
// Non-private built-in fixture: left red, right blue. The answer is not in the prompt.
export function visionSample() {
  const width = 96, height = 64, header = Buffer.alloc(13), pixels = Buffer.alloc(height * (width * 3 + 1));
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * (width * 3 + 1) + 1 + x * 3 + (x < width / 2 ? 0 : 2)] = 255;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export async function testVisionConnection(config, fetcher = fetch) {
  const started = Date.now();
  if (!config.chatImageInput) throw new ConfigError('请先勾选聊天图片输入，再运行视觉测试');
  let response;
  try {
    response = await fetcher(`${config.chatBaseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify({ model: config.chatModel, messages: [{ role: 'user', content: [
        { type: 'text', text: 'What are the two solid colors in this image, from left to right? Reply with only the two English color names separated by one space.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${visionSample().toString('base64')}` } },
      ] }], max_tokens: 32, stream: false }),
    });
  } catch { throw new ConfigError('视觉测试连接失败或超时（30 秒），未保存配置'); }
  if (!response.ok) throw new ConfigError(`视觉测试失败：HTTP ${response.status}；请核对模型是否支持图片输入及额度`);
  let result; try { result = await response.json(); } catch { throw new ConfigError('视觉测试返回非 JSON 内容'); }
  const reply = result.choices?.[0]?.message?.content;
  if (result.error || typeof reply !== 'string' || !/^red[\s,，]+blue[.!。]?$/i.test(reply.trim())) throw new ConfigError('未正确识别内置图片，视觉验证未通过；文字连通不代表支持图片');
  return { ok: true, model: config.chatModel, testedAt: new Date().toISOString(), latencyMs: Date.now() - started };
}
