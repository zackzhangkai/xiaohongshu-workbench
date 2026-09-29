import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NoteStore } from '../server/notes.js';
import { importDocument } from '../server/document-import.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-import-doc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new NoteStore(dir);
}
test('imports nested Markdown with original body and path; repeated imports preserve Web edits', t => {
  const notes = setup(t);
  const input = { relativePath: 'Vault/AI/记录.md', content: '# 学习笔记\n\n正文\n[[另一篇笔记]]\n' };
  const first = importDocument(notes, input);
  assert.equal(first.status, 'imported');
  assert.equal(first.note.title, '学习笔记');
  assert.equal(first.note.content, input.content);
  assert.equal(first.note.importInfo.relativePath, input.relativePath);
  notes.update(first.note.id, { content: 'Web 中的修改' });
  const again = importDocument(notes, input);
  assert.equal(again.status, 'duplicate');
  assert.equal(again.note.content, 'Web 中的修改');
  const changed = importDocument(notes, { ...input, content: '# 文件的新版本' });
  assert.equal(changed.status, 'imported');
  assert.notEqual(changed.note.id, first.note.id);
  assert.equal(notes.get(first.note.id).content, 'Web 中的修改');
  assert.equal(notes.list().length, 2);
});
test('plain text uses filename and distinct folders remain distinct', t => {
  const notes = setup(t);
  const a = importDocument(notes, { relativePath: 'a/记录.txt', content: 'same' });
  const b = importDocument(notes, { relativePath: 'b/记录.txt', content: 'same' });
  assert.equal(a.note.title, '记录');
  assert.notEqual(a.note.id, b.note.id);
});
test('rejects invalid paths, hidden files, binary and oversized text before writing', t => {
  const notes = setup(t);
  for (const relativePath of ['/tmp/a.md', '../a.md', 'a/../b.md', '.obsidian/a.md', 'a//b.md', 'a\\b.md', 'a.png', 'a\0.md']) {
    assert.throws(() => importDocument(notes, { relativePath, content: 'hello' }));
  }
  for (const content of [null, 'a\0b', '中'.repeat(170000)]) assert.throws(() => importDocument(notes, { relativePath: 'a.md', content }));
  assert.equal(notes.list().length, 0);
});
