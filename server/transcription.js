import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile);
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
export function mediaSignature(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) return false;
  return bytes.toString('ascii', 4, 8) === 'ftyp' || bytes.readUInt32BE(0) === 0x1a45dfa3 ||
    (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') ||
    ['ID3', 'fLa', 'Ogg'].includes(bytes.toString('ascii', 0, 3)) ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
}
export class TranscriptionService {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'transcriptions'); fs.mkdirSync(this.dir, { recursive: true });
    this.python = process.env.TRANSCRIBE_PYTHON || path.join(os.homedir(), '.claude/skills/media-to-text/venv/bin/python');
    const snapshots = path.join(os.homedir(), '.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo/snapshots');
    this.model = process.env.TRANSCRIBE_MODEL || (fs.existsSync(snapshots) ? fs.readdirSync(snapshots).sort().map(s => path.join(snapshots, s)).find(s => fs.existsSync(path.join(s, 'config.json'))) : '');
    this.busy = false;
    for (const item of this.list()) if (['preparing', 'running'].includes(item.status)) this.save({ ...item, status: 'failed', error: '服务退出，转写已中断，请重新提交' });
  }
  ready() { return Boolean(fs.existsSync(this.python) && this.model && fs.existsSync(path.join(this.model, 'config.json'))); }
  folder(id) { if (!validId(id)) throw new Error('无效转写编号'); return path.join(this.dir, id); }
  get(id) { return JSON.parse(fs.readFileSync(path.join(this.folder(id), 'job.json'), 'utf8')); }
  save(item) { const file = path.join(this.folder(item.id), 'job.json'); fs.writeFileSync(file + '.tmp', JSON.stringify(item), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); }
  list() { return fs.readdirSync(this.dir).filter(validId).flatMap(id => { try { return [this.get(id)]; } catch { return []; } }).sort((a, b) => b.createdAt - a.createdAt); }
  async create(bytes, name) {
    if (this.busy) throw new Error('已有转写任务正在执行，请等待完成');
    if (!this.ready()) throw new Error('未找到已有的本地 Whisper 环境和模型；不会自动安装或下载');
    if (!mediaSignature(bytes) || bytes.length > 100 * 1024 * 1024) throw new Error('请选择 100MB 以内的 MP4、MOV、WebM、WAV、MP3、M4A、FLAC 或 OGG 文件');
    const item = { id: crypto.randomUUID(), name: typeof name === 'string' ? name.slice(0, 200) : '音视频转写', createdAt: Date.now(), status: 'preparing' };
    const folder = this.folder(item.id); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'input'), bytes, { mode: 0o600 }); this.save(item);
    this.busy = true;
    this.execute(item).catch(() => {}).finally(() => { this.busy = false; });
    return item;
  }
  async execute(item) {
    const folder = this.folder(item.id), input = path.join(folder, 'input'), audio = path.join(folder, 'audio.wav');
    let stage = 'probe';
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', input], { timeout: 15000, maxBuffer: 1000000 });
      const info = JSON.parse(stdout), duration = Number(info.format?.duration);
      if (!info.streams?.some(s => s.codec_type === 'audio')) throw new Error('文件中没有音轨，无法转写');
      if (!Number.isFinite(duration) || duration <= 0 || duration > 1800) throw new Error('当前支持 30 分钟以内、时长可读取的音视频');
      item = { ...item, duration }; this.save(item); stage = 'extract';
      await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-protocol_whitelist', 'file,pipe', '-i', input, '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', '-t', '1800', audio], { timeout: 120000, maxBuffer: 1000000 });
      stage = 'transcribe'; this.save({ ...item, status: 'running' });
      await run(this.python, [fileURLToPath(new URL('../scripts/transcribe_local.py', import.meta.url)), audio, this.model, path.join(folder, 'result.json')], { timeout: 30 * 60 * 1000, maxBuffer: 2000000, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
      const result = JSON.parse(fs.readFileSync(path.join(folder, 'result.json'), 'utf8'));
      this.save({ ...item, status: 'completed', ...result, completedAt: Date.now() });
    } catch (error) {
      this.save({ ...item, status: 'failed', error: stage === 'probe' && !error.message.startsWith('Command failed') ? error.message : stage === 'transcribe' ? '本地 Whisper 转写失败或超时，请检查模型和可用内存后重新提交' : '音轨读取失败，请检查文件是否完整' });
    } finally { fs.rmSync(audio, { force: true }); }
  }
}
