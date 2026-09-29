import crypto from 'node:crypto';

export class DocumentImportError extends Error {}
export function importDocument(notes, input) {
  const { relativePath, content } = input ?? {};
  if (typeof relativePath !== 'string' || relativePath.length > 1000 || !relativePath.trim() ||
    relativePath.startsWith('/') || relativePath.includes('\\') || /[\u0000-\u001f]/.test(relativePath) ||
    relativePath.split('/').some(segment => !segment || segment.startsWith('.')) ||
    !/\.(md|markdown|txt)$/i.test(relativePath)) throw new DocumentImportError('文件路径或格式不支持，请选择 Markdown 或 TXT 文档');
  if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content, 'utf8') > 500000) throw new DocumentImportError('每份文档必须是 500KB 以内的 UTF-8 文本');
  const hash = crypto.createHash('sha256').update(relativePath).update('\0').update(content).digest('hex');
  const source = `local-file:${hash}`;
  const existing = notes.list().find(note => note.source === source);
  if (existing) return { status: 'duplicate', note: existing };
  const name = relativePath.split('/').at(-1).replace(/\.[^.]+$/, '');
  const heading = content.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  const note = notes.create({ title: (heading || name).slice(0, 200), content, summary: '', tags: ['本地文档'], source,
    importInfo: { relativePath, contentHash: hash, importedAt: Date.now() } });
  return { status: 'imported', note };
}
