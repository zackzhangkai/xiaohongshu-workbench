import fs from 'node:fs';
import path from 'node:path';

// Only flat local generated/original image paths can enter an export package.
const localImage = url => (typeof url === 'string' && /^\/(images|imports)\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(url) ? url : null);
const fileFor = (url, imagesDir, importsDir) => {
  const root = url.startsWith('/imports/') ? importsDir : imagesDir;
  return root ? path.join(root, path.basename(url)) : null;
};

export function safeFileName(title) {
  const cleaned = String(title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().replace(/^\.+/, '');
  return cleaned.slice(0, 80) || '未命名稿件';
}

// The export bundle mirrors the web publish preview: the markdown draft plus
// its images numbered in upload order (封面 first). Images whose files were
// cleaned up are skipped, and the survivors renumbered without gaps.
export function exportEntries(manuscript, imagesDir, importsDir) {
  const urls = [...new Set((Array.isArray(manuscript.images) ? manuscript.images : []).map(localImage).filter(Boolean))]
    .sort((a, b) => {
      const at = manuscript.content.indexOf(a), bt = manuscript.content.indexOf(b);
      return (at === -1 ? Infinity : at) - (bt === -1 ? Infinity : bt);
    })
    .filter(url => {
      const file = fileFor(url, imagesDir, importsDir);
      return Boolean(file && fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink());
    });
  const entries = [{ name: `${safeFileName(manuscript.title)}.md`, bytes: Buffer.from(`# ${manuscript.title}\n\n${manuscript.content}\n`, 'utf8') }];
  urls.forEach((url, index) => entries.push({
    name: `${String(index + 1).padStart(2, '0')}-${index === 0 ? '封面' : '配图'}.${url.split('.').pop()}`,
    bytes: fs.readFileSync(fileFor(url, imagesDir, importsDir)),
  }));
  return entries;
}

// Materialize the same bundle as a real folder for Finder reveal. The folder
// name is rebuilt from sanitized parts only, so replacing it never escapes
// the exports directory.
export function materializeExport(manuscript, imagesDir, exportsDir, importsDir) {
  const folder = path.join(exportsDir, `${safeFileName(manuscript.title)}-${String(manuscript.id).slice(0, 8)}`);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  for (const entry of exportEntries(manuscript, imagesDir, importsDir)) fs.writeFileSync(path.join(folder, entry.name), entry.bytes, { mode: 0o600 });
  return folder;
}
