import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 知识库笔记：JSON 文件存储，本地知识库语义
 * （title / summary / content / tags / source / createdAt / updatedAt）。
 */
export class NoteStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'notes');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  fileFor(id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('invalid note id');
    return path.join(this.dir, `${id}.json`);
  }

  list() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8'));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  create({ title = '未命名笔记', summary = '', content = '', tags = [], source = 'manual', images, importInfo }) {
    const now = Date.now();
    const note = {
      id: crypto.randomUUID(),
      title,
      summary,
      content,
      tags,
      source,
      ...(Array.isArray(images) && images.length ? { images } : {}),
      ...(importInfo ? { importInfo } : {}),
      createdAt: now,
      updatedAt: now,
    };
    fs.writeFileSync(this.fileFor(note.id), JSON.stringify(note, null, 2));
    return note;
  }

  get(id) {
    try {
      return JSON.parse(fs.readFileSync(this.fileFor(id), 'utf-8'));
    } catch {
      return null;
    }
  }

  update(id, patch) {
    const note = this.get(id);
    if (!note) return null;
    const allowed = ['title', 'summary', 'content', 'tags'];
    for (const key of allowed) {
      if (key in patch) note[key] = patch[key];
    }
    note.updatedAt = Date.now();
    fs.writeFileSync(this.fileFor(id), JSON.stringify(note, null, 2));
    return note;
  }

  delete(id) {
    const file = this.fileFor(id);
    if (!fs.existsSync(file)) return false;
    fs.unlinkSync(file);
    return true;
  }
}
