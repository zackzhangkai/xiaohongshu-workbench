import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createZipBuffer } from '../server/zip.js';
import { safeFileName, exportEntries, materializeExport } from '../server/manuscript-export.js';

test('server zip opens with a standard archive reader, validates CRC and exact bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-manuscript-zip-'));
  try {
    const file = path.join(dir, 'result.zip');
    fs.writeFileSync(file, createZipBuffer([
      { name: '文案.md', bytes: Buffer.from('# 标题\n\n正文 #话题\n', 'utf8') },
      { name: '01-封面.png', bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 14]) },
    ]));
    const output = execFileSync('python3', ['-c', `import zipfile,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 assert z.namelist()==['文案.md','01-封面.png']
 assert z.read('文案.md').decode()=='# 标题\\n\\n正文 #话题\\n'
 assert z.read('01-封面.png')==bytes([137,80,78,71,13,10,26,10,0,255,14])
 print('ok')`, file], { encoding: 'utf8' });
    assert.equal(output.trim(), 'ok');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('exportEntries follows draft mention order, skips missing files and unsafe paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-manuscript-export-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.png'), 'image-a');
    fs.writeFileSync(path.join(dir, 'b.png'), 'image-b');
    const entries = exportEntries({
      title: '周末/露营：攻略',
      content: '先看 /images/b.png 这张，再看下一张',
      images: ['/images/a.png', '/images/b.png', '/images/gone.png', '/images/../../secret.png', 'https://example.com/x.png', '/images/a.png'],
    }, dir);
    assert.deepEqual(entries.map(e => e.name), ['周末露营：攻略.md', '01-封面.png', '02-配图.png']);
    assert.equal(entries[0].bytes.toString(), '# 周末/露营：攻略\n\n先看 /images/b.png 这张，再看下一张\n');
    assert.equal(entries[1].bytes.toString(), 'image-b', 'draft-mentioned image becomes the cover');
    assert.equal(entries[2].bytes.toString(), 'image-a');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('exportEntries with no images still yields the markdown draft', () => {
  const entries = exportEntries({ title: '纯文字稿', content: '只有文案' }, '/nonexistent-images-dir');
  assert.deepEqual(entries.map(e => e.name), ['纯文字稿.md']);
  assert.equal(entries[0].bytes.toString(), '# 纯文字稿\n\n只有文案\n');
});

test('exportEntries includes trusted original images when an imports directory is provided', () => {
  const generated = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-generated-'));
  const imports = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-imports-'));
  try {
    fs.writeFileSync(path.join(imports, 'original.webp'), 'original-bytes');
    const entries = exportEntries({ title: '改写稿', content: '只改文案', images: ['/imports/original.webp'] }, generated, imports);
    assert.deepEqual(entries.map(entry => entry.name), ['改写稿.md', '01-封面.webp']);
    assert.equal(entries[1].bytes.toString(), 'original-bytes');
  } finally { fs.rmSync(generated, { recursive: true, force: true }); fs.rmSync(imports, { recursive: true, force: true }); }
});

test('materializeExport rebuilds a fresh folder under the exports dir and is idempotent', () => {
  const imagesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-manuscript-folder-img-'));
  const exportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-manuscript-folder-out-'));
  try {
    fs.writeFileSync(path.join(imagesDir, 'pic.jpeg'), 'jpeg-bytes');
    const manuscript = { id: '01234567-89ab-cdef-0123-456789abcdef', title: '一篇稿件', content: '文案 /images/pic.jpeg', images: ['/images/pic.jpeg'] };
    const folder = materializeExport(manuscript, imagesDir, exportsDir);
    assert.equal(folder, path.join(exportsDir, '一篇稿件-01234567'));
    assert.deepEqual(fs.readdirSync(folder).sort(), ['01-封面.jpeg', '一篇稿件.md']);
    assert.equal(fs.readFileSync(path.join(folder, '01-封面.jpeg'), 'utf8'), 'jpeg-bytes');
    // A stale extra file from an earlier export disappears on re-materialize.
    fs.writeFileSync(path.join(folder, '旧文件.txt'), 'stale');
    materializeExport(manuscript, imagesDir, exportsDir);
    assert.deepEqual(fs.readdirSync(folder).sort(), ['01-封面.jpeg', '一篇稿件.md']);
  } finally { fs.rmSync(imagesDir, { recursive: true, force: true }); fs.rmSync(exportsDir, { recursive: true, force: true }); }
});

test('safeFileName strips path characters, leading dots and overlong titles', () => {
  assert.equal(safeFileName('../etc/passwd'), 'etcpasswd');
  assert.equal(safeFileName('  '), '未命名稿件');
  assert.equal(safeFileName(undefined), '未命名稿件');
  assert.equal(safeFileName('a'.repeat(100)).length, 80);
  assert.equal(safeFileName('正常标题：第 1 篇'), '正常标题：第 1 篇');
});
