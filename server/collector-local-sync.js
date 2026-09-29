import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 采集笔记的本地文件夹镜像：每次采集成功后，把知识库中该笔记的最新状态
// 重建为 note.md + images/。目录是镜像输出，手工改动会在下次采集时被覆盖。
// 只镜像插件采集链路的 /imports/ 图片；历史导入的其他图片路径不处理。
const IMAGE_URL = /^\/imports\/([a-f0-9]{64}\.(?:png|jpg|webp|gif))$/;

function renderMarkdown(note, links) {
  const c = note.collector || {};
  const lines = [`# ${note.title || '未命名笔记'}`, ''];
  const facts = [];
  if (c.author) facts.push(`作者：${c.author}`);
  const counts = [['likes', '赞'], ['collects', '藏'], ['comments', '评']]
    .filter(([key]) => c.stats?.[key]).map(([key, label]) => `${label} ${c.stats[key]}`);
  if (counts.length) facts.push(counts.join(' · '));
  if (c.capturedAt) facts.push(`采集于 ${new Date(c.capturedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  if (facts.length) lines.push(`> ${facts.join('；')}`, '');
  if (note.content) lines.push(note.content, '');
  if (links.length) lines.push('## 配图', '', ...links.map((link, i) => `![图${i + 1}](${link})`), '');
  return `${lines.join('\n').trim()}\n`;
}

export function createCollectorLocalSync({ dataDir, env = process.env }) {
  const raw = env.COLLECTOR_SYNC_DIR;
  const dir = raw === undefined ? path.join(dataDir, 'exports', 'collector')
    : raw.trim() ? path.resolve(dataDir, raw.trim()) : null;
  const imports = path.join(dataDir, 'imports');

  function write(note) {
    if (!dir) return null;
    const noteId = note?.collector?.noteId;
    if (!/^[a-f0-9]{24}$/.test(noteId || '')) throw new Error('笔记 ID 非法，无法本地同步');
    const target = path.join(dir, noteId);
    const staging = `${target}.${crypto.randomUUID()}.tmp`;
    const entries = [];
    for (const url of Array.isArray(note.images) ? note.images : []) {
      const name = IMAGE_URL.exec(url)?.[1];
      if (name && fs.existsSync(path.join(imports, name))) entries.push({ name, src: path.join(imports, name) });
    }
    const names = entries.map((entry, i) => `${String(i + 1).padStart(2, '0')}-${entry.name}`);
    try {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(entries.length ? path.join(staging, 'images') : staging, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(staging, 'note.md'), renderMarkdown(note, names.map(name => `images/${name}`)), { mode: 0o600 });
      entries.forEach((entry, i) => fs.copyFileSync(entry.src, path.join(staging, 'images', names[i])));
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    }
    return target;
  }

  return { dir, write };
}
