import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { createCollectorLocalSync } from './collector-local-sync.js';

const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;
const fields = ['title', 'summary', 'content', 'tags'];
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, limit = 30000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function xhsIdentity(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !['www.xiaohongshu.com', 'www.rednote.com'].includes(url.hostname) || url.username || url.password) throw new Error('仅支持小红书笔记详情页');
  const id = url.pathname.match(/^\/(?:explore|discovery\/item|search_result)\/([a-f0-9]{24})\/?$/i)?.[1]?.toLowerCase();
  if (!id) throw new Error('请先打开一篇小红书笔记');
  return { id, url: `https://www.xiaohongshu.com/explore/${id}` };
}
function imageBytes(value) {
  const encoded = typeof value === 'string' ? value : '';
  if (!encoded || encoded.length > Math.ceil(MAX_IMAGE / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('图片数据无效或单图超过 5MB');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_IMAGE) throw new Error('单图超过 5MB');
  let ext;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') ext = 'png';
  else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ext = 'jpg';
  else if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') ext = 'webp';
  else if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) ext = 'gif';
  else throw new Error('图片文件头不支持');
  return { bytes, name: `${crypto.createHash('sha256').update(bytes).digest('hex')}.${ext}` };
}

export function createCollector({ dataDir, notes, env = process.env }) {
  const router = express.Router();
  const localSync = createCollectorLocalSync({ dataDir, env });
  const keyFile = path.join(dataDir, 'collector-key.json');
  let key;
  const getKey = () => {
    if (!key) {
      if (fs.existsSync(keyFile)) key = JSON.parse(fs.readFileSync(keyFile, 'utf8')).key;
      else { key = crypto.randomBytes(32).toString('hex'); atomic(keyFile, { key }); }
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('插件配对配置损坏');
    }
    return key;
  };
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.status(403).json({ error: '仅允许本机访问' });
    const origin = req.get('origin');
    if (origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin) && req.path !== '/pairing') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    } else {
      let same = !origin;
      try { if (origin) same = new URL(origin).host === req.get('host'); } catch {}
      if (!same || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '请从本机工作台访问' });
    }
    next();
  });
  router.get('/pairing', (_req, res) => res.json({ key: getKey() }));
  router.use((req, res, next) => {
    const provided = Buffer.from(req.get('authorization') || '');
    const expected = Buffer.from(`Bearer ${getKey()}`);
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return res.status(401).json({ error: '配对码不正确，请从工作台重新复制' });
    next();
  });
  router.get('/health', (_req, res) => res.json({ ok: true, service: 'xhs-collector', version: 1 }));
  router.post('/capture', express.json({ limit: '35mb' }), (req, res) => {
    try { res.json(save(req.body)); }
    catch (error) { res.status(400).json({ error: error.code ? '本机保存失败，请检查磁盘空间和目录权限' : error.message }); }
  });
  router.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type === 'entity.too.large' ? '素材总量过大，请减少图片后重试' : '采集请求无法处理' }));

  function save(input) {
    if (!input || typeof input !== 'object') throw new Error('采集内容为空');
    const identity = xhsIdentity(input.sourceUrl);
    if (input.noteId !== identity.id) throw new Error('笔记身份不一致，请重新打开插件');
    const title = text(input.title, 500), body = text(input.content);
    if (!title || !body) throw new Error('未识别到完整标题和正文，请打开笔记详情后重试');
    if (!Array.isArray(input.images) || input.images.length > 20) throw new Error('最多保存 20 张图片');
    const images = input.images.map(imageBytes);
    if (images.reduce((n, item) => n + item.bytes.length, 0) > MAX_TOTAL) throw new Error('图片总量超过 24MB');
    const comments = (input.includeComments === true && Array.isArray(input.comments) ? input.comments : []).slice(0, 100).map(c => ({
      author: text(c?.author, 120), text: text(c?.text, 2000), likes: text(c?.likes, 40),
    })).filter(c => c.text);
    const uniqueComments = [...new Map(comments.map(c => [`${c.author}\n${c.text}`, c])).values()];
    const author = text(input.author, 120);
    const stats = Object.fromEntries(['likes', 'collects', 'comments'].map(k => [k, text(input.stats?.[k], 40) || null]));
    // Match pre-existing imported records too, but never change their source identity or baselines.
    const existing = notes.list().find(n => n.collector?.noteId === identity.id || (() => {
      try { return xhsIdentity(n.sourceUrl).id === identity.id; } catch { return false; }
    })());
    const previous = existing?.collector;
    const mergedComments = [...new Map([...(previous?.comments || []), ...uniqueComments].map(c => [`${c.author}\n${c.text}`, c])).values()].slice(0, 100);
    const content = [body, author && `作者：${author}`, `原文：${identity.url}`,
      mergedComments.length && `评论快照（已加载 ${mergedComments.length} 条，非完整评论区）：\n${mergedComments.map(c => `${c.author || '匿名'}：${c.text}${c.likes ? `（赞 ${c.likes}）` : ''}`).join('\n\n')}`].filter(Boolean).join('\n\n');
    const captured = { title, summary: body.slice(0, 180), content, tags: ['小红书', '插件采集'] };
    const urls = images.map(i => `/imports/${i.name}`);
    const next = existing ? structuredClone(existing) : { id: crypto.randomUUID(), source: 'xiaohongshu', createdAt: Date.now(), ...captured };
    const preserved = [];
    if (existing) for (const field of fields) {
      if (previous?.baseline?.[field] === digest(existing[field])) next[field] = captured[field];
      else preserved.push(field);
    }
    next.sourceUrl ||= identity.url;
    next.images = [...new Set([...urls, ...(existing?.images || [])])];
    next.cover ||= next.images[0] || '';
    next.collector = { noteId: identity.id, author, stats, comments: mergedComments, body, title,
      capturedAt: Date.now(), commentsScope: 'loaded-only', baseline: Object.fromEntries(fields.map(k => [k, digest(captured[k])])),
      warnings: (Array.isArray(input.warnings) ? input.warnings : []).slice(0, 30).map(w => text(w, 200)) };
    // Validate everything before persisting, back up before changing an existing record.
    const imports = path.join(dataDir, 'imports');
    fs.mkdirSync(imports, { recursive: true });
    for (const item of images) {
      const dest = path.join(imports, item.name);
      if (!fs.existsSync(dest)) fs.writeFileSync(dest, item.bytes, { flag: 'wx', mode: 0o600 });
    }
    if (existing) atomic(path.join(dataDir, 'collector-backups', `${next.id}-${Date.now()}-${crypto.randomUUID()}.json`), existing);
    next.updatedAt = Date.now();
    atomic(notes.fileFor(next.id), next);
    const readBack = notes.get(next.id);
    if (!readBack || readBack.collector.noteId !== identity.id) throw new Error('保存回读失败');
    // 本地镜像失败不阻断采集入库；错误通过响应与日志透出。
    let localSyncResult = null;
    if (localSync.dir) {
      try { localSyncResult = { ok: true, dir: localSync.write(readBack) }; }
      catch (error) { console.error('[collector] 本地同步失败：', error); localSyncResult = { ok: false, error: `本地同步失败：${error.message || '未知错误'}` }; }
    }
    return { ok: true, noteId: next.id, duplicate: Boolean(existing), images: next.images.length, comments: mergedComments.length, preserved, warnings: next.collector.warnings, localSync: localSyncResult };
  }
  return router;
}
