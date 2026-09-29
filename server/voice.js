import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

export class VoiceService {
  constructor(dataDir, run = execute) {
    this.dir = path.join(dataDir, 'audio');
    this.run = run;
    this.busy = false;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const record of this.list()) if (record.status === 'running') {
      this.save({ ...record, status: 'failed', error: '服务重启，生成已中断。请重新提交。' });
    }
  }
  async voices() {
    const { stdout } = await this.run('/usr/bin/say', ['-v', '?'], { timeout: 10000, maxBuffer: 100000 });
    return stdout.split('\n').flatMap(line => {
      const match = line.match(/^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#\s*(.*)$/);
      return match ? [{ name: match[1].trim(), language: match[2], sample: match[3] }] : [];
    }).sort((a, b) => Number(b.language.startsWith('zh')) - Number(a.language.startsWith('zh')) || a.name.localeCompare(b.name));
  }
  list() {
    return fs.readdirSync(this.dir).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(this.dir, name), 'utf8'))).sort((a, b) => b.createdAt - a.createdAt);
  }
  save(record) {
    const file = path.join(this.dir, `${record.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record, null, 2), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  }
  async create(input) {
    if (this.busy) throw new Error('已有配音任务正在生成，请等待完成');
    const { text, voice, rate } = input ?? {};
    if (typeof text !== 'string' || !text.trim() || text.length > 5000 || text.includes('[[') || text.includes('\0')) throw new Error('请输入 1 至 5000 字的普通文案，不支持语音控制标记');
    if (!Number.isInteger(rate) || rate < 80 || rate > 350) throw new Error('语速必须为 80 至 350');
    this.busy = true;
    try {
      const voices = await this.voices();
      if (!voices.some(item => item.name === voice)) throw new Error('请选择本机可用音色');
      const record = { id: crypto.randomUUID(), text: text.trim(), voice, rate, status: 'running', createdAt: Date.now() };
      this.save(record);
      this.generate(record).catch(error => console.error('[voice]', error.message));
      return record;
    } catch (e) { this.busy = false; throw e; }
  }
  async generate(record) {
    const textFile = path.join(this.dir, `${record.id}.txt`);
    const audioFile = path.join(this.dir, `${record.id}.wav`);
    try {
      fs.writeFileSync(textFile, record.text, { mode: 0o600 });
      await this.run('/usr/bin/say', ['-v', record.voice, '-r', String(record.rate), '-f', textFile, '--file-format=WAVE', '--data-format=LEI16@22050', '-o', audioFile], { timeout: 180000, maxBuffer: 100000 });
      const bytes = fs.readFileSync(audioFile);
      if (bytes.length < 45 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('没有生成有效 WAV 音频');
      this.save({ ...record, status: 'completed', completedAt: Date.now(), url: `/audio/${record.id}.wav`, size: bytes.length });
    } catch (e) {
      fs.rmSync(audioFile, { force: true });
      this.save({ ...record, status: 'failed', error: e.killed ? '配音生成超时' : '本地语音生成失败，请检查音色是否可用后重试' });
    } finally { fs.rmSync(textFile, { force: true }); this.busy = false; }
  }
}
