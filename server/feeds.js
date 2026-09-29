import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FEED_SOURCES = [
  { id: 'ithome', name: 'IT之家', url: 'https://www.ithome.com/rss/' },
  { id: 'sspai', name: '少数派', url: 'https://sspai.com/feed' },
];
export function parseFeed(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [fileURLToPath(new URL('../scripts/parse_feed.py', import.meta.url))]);
    let output = '', error = '';
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { error += data; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(error.trim() || '订阅源解析失败'));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('订阅源解析失败')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}
export class FeedStore {
  constructor(dataDir, { fetchImpl = fetch } = {}) {
    this.dir = path.join(dataDir, 'feeds');
    fs.mkdirSync(this.dir, { recursive: true });
    this.fetch = fetchImpl;
    this.pending = new Map();
  }
  read(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.dir, `${id}.json`), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { items: [], fetchedAt: null }; throw e; }
  }
  list() {
    return FEED_SOURCES.map(source => ({ ...source, ...this.read(source.id) }));
  }
  async refresh(id) {
    const source = FEED_SOURCES.find(s => s.id === id);
    if (!source) throw new Error('资讯来源不存在');
    if (this.pending.has(id)) return this.pending.get(id);
    const job = this.load(source).finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }
  async load(source) {
    const previous = this.read(source.id);
    let result;
    try {
      const response = await this.fetch(source.url, { signal: AbortSignal.timeout(20000), redirect: 'error', headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
      if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
      const reader = response.body.getReader();
      const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2000000) { await reader.cancel(); throw new Error('订阅源内容超过 2MB'); }
        chunks.push(Buffer.from(value));
      }
      const parsed = await parseFeed(Buffer.concat(chunks));
      if (!parsed.length) throw new Error('来源没有返回有效条目');
      const items = parsed.map(item => ({ ...item, id: crypto.createHash('sha256').update(`${source.id}:${item.url}`).digest('hex'), sourceId: source.id, sourceName: source.name }));
      result = { items: [...items, ...previous.items.filter(old => !items.some(item => item.id === old.id))].slice(0, 300), fetchedAt: new Date().toISOString(), error: null };
    } catch (e) {
      result = { ...previous, error: e.message, attemptedAt: new Date().toISOString() };
    }
    const target = path.join(this.dir, `${source.id}.json`);
    fs.writeFileSync(`${target}.tmp`, JSON.stringify(result, null, 2));
    fs.renameSync(`${target}.tmp`, target);
    return { ...source, ...result };
  }
}
