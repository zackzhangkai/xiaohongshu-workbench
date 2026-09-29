import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { NoteStore } from './notes.js';
const revision = item => crypto.createHash('sha256').update(JSON.stringify([item.id, item.title, item.content, item.updatedAt])).digest('hex');
// Publishable local assets recorded up to the saved message. Text-only
// knowledge rewrites keep their trusted /imports originals; other flows keep
// successful image_generate results. Plan drafts still stay image-free.
export function collectSessionImages(messages, messageIndex) {
  if (!Array.isArray(messages) || !Number.isInteger(messageIndex) || messageIndex < 0) return [];
  const urls = [];
  let turnStart = messageIndex;
  while (turnStart >= 0 && messages[turnStart]?.role !== 'user') turnStart--;
  const original = messages[turnStart]?.context?.referenceMode === 'text-only' ? messages[turnStart]?.context?.publishImages : [];
  for (const url of Array.isArray(original) ? original : []) {
    if (/^\/imports\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(url) && !urls.includes(url)) urls.push(url);
  }
  for (const message of messages.slice(0, messageIndex + 1)) {
    if (message?.role !== 'tool') continue;
    let result;
    try { result = JSON.parse(message.content); } catch { continue; }
    if (typeof result?.url === 'string' && result.url.startsWith('/images/') && !urls.includes(result.url)) urls.push(result.url);
  }
  return urls;
}
export class ManuscriptError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export class ManuscriptStore extends NoteStore {
  constructor(dataDir) { super(dataDir); this.historyDir = path.join(dataDir, 'versions'); fs.mkdirSync(this.historyDir, { recursive: true }); }
  withRevision(item) { return item ? { ...item, revision: revision(item) } : null; }
  get(id) { return this.withRevision(super.get(id)); }
  list() { return super.list().map(item => this.withRevision(item)); }
  create(input) { return this.withRevision(super.create(input)); }
  historyFolder(id) { this.fileFor(id); return path.join(this.historyDir, id); }
  versions(id) {
    if (!this.get(id)) throw new ManuscriptError('稿件不存在', 404);
    const folder = this.historyFolder(id);
    if (!fs.existsSync(folder)) return [];
    return fs.readdirSync(folder).filter(f => /^[0-9a-f]{64}\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(folder, f), 'utf8'))).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  update(id, patch, expectedRevision) {
    const item = this.get(id);
    if (!item) throw new ManuscriptError('稿件不存在', 404);
    if (expectedRevision !== item.revision) throw new ManuscriptError('稿件已在其他窗口更新。请先导出当前修改，再重新打开最新稿件后编辑。', 409);
    if (typeof patch.title !== 'string' || typeof patch.content !== 'string') throw new ManuscriptError('标题和正文必须是文字');
    if (item.title === patch.title && item.content === patch.content) return item;
    const folder = this.historyFolder(id); fs.mkdirSync(folder, { recursive: true });
    const snapshot = path.join(folder, `${item.revision}.json`);
    // Preserve the previous content before replacing the current file.
    if (!fs.existsSync(snapshot)) { fs.writeFileSync(snapshot + '.tmp', JSON.stringify(item), { mode: 0o600 }); fs.renameSync(snapshot + '.tmp', snapshot); }
    const next = { ...item, title: patch.title, content: patch.content, updatedAt: Math.max(Date.now(), item.updatedAt + 1) };
    delete next.revision;
    const file = this.fileFor(id); fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    return this.withRevision(next);
  }
  restore(id, versionId, expectedRevision) {
    if (typeof versionId !== 'string' || !/^[0-9a-f]{64}$/.test(versionId)) throw new ManuscriptError('版本编号无效');
    const previous = this.versions(id).find(v => v.revision === versionId);
    if (!previous) throw new ManuscriptError('历史版本不存在', 404);
    return this.update(id, { title: previous.title, content: previous.content }, expectedRevision);
  }
  // Backfill chat images onto a draft saved before this feature existed.
  // Never overwrites an existing list, and keeps revision/updatedAt stable so
  // editors opened elsewhere do not hit a false write conflict.
  attachImages(id, urls) {
    const item = this.get(id);
    if (!item) throw new ManuscriptError('稿件不存在', 404);
    if (!Array.isArray(urls) || !urls.length || item.images?.length) return item;
    const next = { ...item, images: [...new Set(urls)] };
    delete next.revision;
    const file = this.fileFor(id); fs.writeFileSync(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 }); fs.renameSync(file + '.tmp', file);
    return this.withRevision(next);
  }
}
