import fs from 'node:fs';
import path from 'node:path';
import { safeFileName } from './manuscript-export.js';

const importedImage = value => (typeof value === 'string' && /^\/imports\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(value) ? value : null);

function readImportedFile(importsDir, url) {
  const requestedRoot = path.resolve(importsDir);
  if (fs.lstatSync(requestedRoot).isSymbolicLink()) throw new Error('原图目录路径不安全');
  const root = fs.realpathSync(requestedRoot);
  const file = path.join(root, path.basename(url));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(file)) !== root) throw new Error('原图路径不安全');
  return fs.readFileSync(file);
}

export function noteExportEntries(note, importsDir) {
  const title = safeFileName(note?.title);
  const meta = [note?.summary && `> ${note.summary}`, note?.tags?.length && `标签：${note.tags.map(tag => `#${tag}`).join(' ')}`].filter(Boolean);
  const body = [`# ${note?.title || '未命名笔记'}`, ...meta, note?.content || ''].filter(Boolean).join('\n\n') + '\n';
  const entries = [{ name: `${title}.md`, bytes: Buffer.from(body, 'utf8') }];
  const images = [...new Set((Array.isArray(note?.images) ? note.images : []).map(importedImage).filter(Boolean))];
  images.forEach((url, index) => {
    let bytes;
    try { bytes = readImportedFile(importsDir, url); }
    catch { throw new Error(`第 ${index + 1} 张原图缺失或不可读，未下载不完整素材包`); }
    entries.push({ name: `${String(index + 1).padStart(2, '0')}-${index === 0 ? '原图-封面' : '原图-配图'}.${url.split('.').pop()}`, bytes });
  });
  return entries;
}
