import fs from 'node:fs';
import path from 'node:path';

export const IMAGE_LIMITS = Object.freeze({ count: 6, perImage: 5 * 1024 * 1024, total: 20 * 1024 * 1024 });
const inside = (root, file) => path.dirname(file) === root;
function mime(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  throw new Error('格式不支持或文件头无效');
}
function readImportedImage(importsDir, ref) {
  if (typeof ref !== 'string' || !/^\/imports\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(ref)) throw new Error('仅支持本地导入的 PNG/JPEG/WebP/GIF 图片');
  const root = path.resolve(importsDir);
  // Reject a linked root and linked files; flat imported names cannot traverse parents.
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== root) throw new Error('图片目录路径不安全');
  const file = path.join(root, ref.slice('/imports/'.length));
  if (!inside(root, fs.realpathSync(file)) || fs.lstatSync(file).isSymbolicLink()) throw new Error('图片路径不安全');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('不是普通图片文件');
    if (stat.size > IMAGE_LIMITS.perImage) throw new Error('单图超过 5MB');
    // Bounded read also prevents a growing file from allocating unbounded memory.
    const buffer = Buffer.alloc(IMAGE_LIMITS.perImage + 1);
    let size = 0, read;
    do { read = fs.readSync(fd, buffer, size, buffer.length - size, null); size += read; } while (read && size < buffer.length);
    if (size > IMAGE_LIMITS.perImage) throw new Error('单图超过 5MB');
    const bytes = buffer.subarray(0, size);
    const type = mime(bytes);
    const extension = path.extname(file).toLowerCase();
    if (!({ 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'], 'image/gif': ['.gif'] })[type].includes(extension)) throw new Error('扩展名与图片格式不符');
    return { bytes, type };
  } finally { fs.closeSync(fd); }
}

// Ephemeral provider payload only: never persist base64 in session messages/context.
export function attachReferenceImages({ text, references = [], importsDir, enabled = false, manual = false, completedIds = [], deferredIds = [], rereadNoteIds = [] }) {
  const parts = [], status = [], attachedIds = []; let total = 0, count = 0;
  for (const note of references) {
    const label = `笔记 ${note.id}`;
    if (!Array.isArray(note.imageRefs)) {
      if (note.imageCount) status.push(`${label}：旧会话没有图片引用，请取消引用后重新引用，或新建会话；保留原正文快照。`);
      continue;
    }
    if (!note.imageRefs.length) { status.push(`${label}：没有图片引用。`); continue; }
    if (!manual || !enabled || !importsDir) {
      status.push(`${label}：${note.imageRefs.length} 张图片未附带（${!manual ? '非手动对话禁止图片上传' : !enabled ? '聊天图片输入未开启，请在设置开启' : '本地图片目录不可用'}）。`);
      continue;
    }
    if ((completedIds.includes(note.id) || deferredIds.includes(note.id)) && !rereadNoteIds.includes(note.id)) {
      status.push(`${label}：本轮未附原图，${deferredIds.includes(note.id) && !completedIds.includes(note.id) ? '旧会话读图情况未经确认，仅沿用历史文字' : '沿用已保存的创作文字'}；需核对原图请点击重新读图。`);
      continue;
    }
    note.imageRefs.forEach((ref, index) => {
      const name = `${label} 第 ${index + 1} 张`;
      if (count >= IMAGE_LIMITS.count) { status.push(`${name}：未附带，超过每轮 6 张限制。`); return; }
      try {
        const { bytes, type } = readImportedImage(importsDir, ref);
        if (total + bytes.length > IMAGE_LIMITS.total) throw new Error('图片总量超过 20MB');
        total += bytes.length; count++;
        if (!attachedIds.includes(note.id)) attachedIds.push(note.id);
        parts.push({ type: 'text', text: name }, { type: 'image_url', image_url: { url: `data:${type};base64,${bytes.toString('base64')}` } });
        status.push(`${name}：已附带图片像素。`);
      } catch (error) {
        const reason = error.code === 'ENOENT' ? '图片文件缺失' : error.code ? '图片不可读取或路径不安全' : error.message;
        status.push(`${name}：未附带，${reason}。`);
      }
    });
  }
  const report = `图片输入状态：已附带 ${count} 张。${status.length ? '\n' + status.join('\n') : ''}`;
  const content = `${text}\n\n${report}`;
  return { content: parts.length ? [{ type: 'text', text: content }, ...parts] : content, report, count, attachedIds };
}
