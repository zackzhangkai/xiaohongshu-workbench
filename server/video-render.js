import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateCues } from '../src/subtitles.js';
const run = promisify(execFile);
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
export class VideoRenderer {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'video-renders');
    fs.mkdirSync(this.dir, { recursive: true });
    this.busy = false;
    for (const item of this.list()) if (item.status === 'running') this.save({ ...item, status: 'failed', error: '服务退出，导出已中断，可重新提交' });
  }
  folder(id) { if (!validId(id)) throw new Error('无效视频编号'); return path.join(this.dir, id); }
  save(item) {
    const file = path.join(this.folder(item.id), 'job.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(item, null, 2), { mode: 0o600 }); fs.renameSync(`${file}.tmp`, file);
  }
  get(id) { return JSON.parse(fs.readFileSync(path.join(this.folder(id), 'job.json'), 'utf8')); }
  list() { return fs.readdirSync(this.dir).filter(validId).flatMap(id => { try { return [this.get(id)]; } catch { return []; } }).sort((a, b) => b.createdAt - a.createdAt); }
  async upload(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > 100 * 1024 * 1024) throw new Error('请选择 100MB 以内的 MP4/MOV/WebM 视频');
    if (bytes.toString('ascii', 4, 8) !== 'ftyp' && bytes.readUInt32BE(0) !== 0x1a45dfa3) throw new Error('只支持 MP4/MOV/WebM 视频文件');
    const id = crypto.randomUUID(), folder = this.folder(id);
    fs.mkdirSync(folder); fs.writeFileSync(path.join(folder, 'input'), bytes, { mode: 0o600 });
    try {
      const { stdout } = await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', path.join(folder, 'input')], { timeout: 15000, maxBuffer: 1000000 });
      const info = JSON.parse(stdout), video = info.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
      if (!video) throw new Error('文件没有视频轨道');
      let { width, height } = video;
      const rotation = Number(video.side_data_list?.find(s => s.rotation !== undefined)?.rotation || 0);
      if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
      const duration = Number(info.format.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 600 || !width || !height || width > 1920 || height > 1920) throw new Error('当前导出支持 10 分钟以内、宽高均不超过 1920 的视频');
      const item = { id, width, height, duration, status: 'uploaded', createdAt: Date.now(), progress: 0 };
      this.save(item); return item;
    } catch (e) { fs.rmSync(folder, { recursive: true, force: true }); throw new Error(e.message.startsWith('Command failed') ? '视频解析失败，请选择有效视频' : e.message); }
  }
  async start(id, input) {
    if (this.busy) throw new Error('已有视频正在导出，请等待完成');
    const item = this.get(id);
    if (item.status === 'completed') throw new Error('该导出已完成，请重新选择视频创建新版本');
    const cues = validateCues(input?.cues);
    if (!cues.length || cues.length > 500) throw new Error('烧录导出需包含 1 至 500 条字幕');
    if (cues.some(c => c.end > item.duration + 0.05)) throw new Error('字幕结束时间超出视频时长，请先调整');
    const fontSize = Number(input.fontSize), color = input.color;
    if (![24, 32, 40, 48].includes(fontSize) || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('字幕样式无效');
    fs.writeFileSync(path.join(this.folder(id), 'render.json'), JSON.stringify({ ...item, cues, fontSize, color }), { mode: 0o600 });
    const running = { ...item, status: 'running', progress: 0, error: null };
    this.save(running);
    this.busy = true;
    this.render(running).catch(e => console.error('[video-render]', e.message));
    return running;
  }
  async render(item) {
    const folder = this.folder(item.id);
    try {
      await run('python3', [fileURLToPath(new URL('../scripts/render_subtitle_layers.py', import.meta.url)), folder], { timeout: 120000, maxBuffer: 1000000 });
      await new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', 'input', '-f', 'concat', '-safe', '0', '-i', 'layers.txt', '-filter_complex', '[0:v]setpts=PTS-STARTPTS[base];[base][1:v]overlay=eof_action=repeat:format=auto,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p[out]', '-map', '[out]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', '-t', String(item.duration), '-progress', 'pipe:1', 'result.mp4'], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '', buffer = '', lastProgress = 0;
        const timeout = setTimeout(() => proc.kill('SIGKILL'), 20 * 60 * 1000);
        proc.stdout.on('data', chunk => {
          buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop();
          for (const line of lines) if (line.startsWith('out_time_us=')) {
            const value = Math.min(99, Math.max(0, Math.floor(Number(line.slice(12)) / 1000000 / item.duration * 100)));
            if (value > lastProgress) { lastProgress = value; try { this.save({ ...item, progress: value }); } catch { proc.kill('SIGKILL'); } }
          }
        });
        proc.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
        proc.once('error', e => { clearTimeout(timeout); reject(e); });
        proc.once('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(stderr || '视频导出失败或超时')); });
      });
      const size = fs.statSync(path.join(folder, 'result.mp4')).size;
      if (size < 1000) throw new Error('导出文件无效');
      this.save({ ...item, status: 'completed', progress: 100, size, url: `/renders/${item.id}.mp4`, completedAt: Date.now() });
    } catch {
      fs.rmSync(path.join(folder, 'result.mp4'), { force: true });
      this.save({ ...item, status: 'failed', error: '本地导出失败。请检查字幕是否超出画面，以及 FFmpeg、Pillow 和中文字体是否可用。' });
    } finally {
      for (const file of fs.readdirSync(folder)) if (/^layer-\d+\.png$/.test(file) || file === 'layers.txt') fs.rmSync(path.join(folder, file), { force: true });
      this.busy = false;
    }
  }
}
