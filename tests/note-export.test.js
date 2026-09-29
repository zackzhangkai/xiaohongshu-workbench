import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { noteExportEntries } from '../server/note-export.js';

test('knowledge note package contains markdown and ordered original images only', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-note-export-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.png'), 'image-a');
  fs.writeFileSync(path.join(dir, 'b.jpg'), 'image-b');
  const entries = noteExportEntries({ title: '周末/笔记', summary: '摘要', tags: ['小红书'], content: '原始正文', images: ['/imports/a.png', '/images/generated.png', '../secret', '/imports/b.jpg', '/imports/a.png'] }, dir);
  assert.deepEqual(entries.map(item => item.name), ['周末笔记.md', '01-原图-封面.png', '02-原图-配图.jpg']);
  assert.match(entries[0].bytes.toString(), /# 周末\/笔记[\s\S]*原始正文/);
  assert.equal(entries[1].bytes.toString(), 'image-a');
  assert.equal(entries[2].bytes.toString(), 'image-b');
});

test('knowledge note package fails closed when an original image is missing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-note-export-missing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => noteExportEntries({ title: '缺图', content: '正文', images: ['/imports/missing.png'] }, dir), /未下载不完整素材包/);
});
