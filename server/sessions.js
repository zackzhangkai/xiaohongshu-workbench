import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * 会话持久化：每个会话一个 JSON 文件，存原始消息数组。
 */
export class SessionStore {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'sessions');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  create(title = '新会话') {
    const id = crypto.randomUUID();
    const session = { id, title, createdAt: Date.now(), messages: [] };
    this.save(session);
    return session;
  }

  fileFor(id) {
    // id 只接受我们自己生成的 uuid，防止路径穿越
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('invalid session id');
    return path.join(this.dir, `${id}.json`);
  }

  save(session) {
    fs.writeFileSync(this.fileFor(session.id), JSON.stringify(session, null, 2));
  }

  get(id) {
    const raw = readTextSafe(this.fileFor(id));
    return raw ? JSON.parse(raw) : null;
  }

  list() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8'));
          return { id: s.id, title: s.title, createdAt: s.createdAt, messageCount: s.messages.length };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}
