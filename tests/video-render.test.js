import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { VideoRenderer } from '../server/video-render.js';

test('rejects non-video upload and invalid job paths without writing files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-render-validation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const renderer = new VideoRenderer(dir);
  assert.throws(() => renderer.folder('../etc'));
  await assert.rejects(renderer.upload(Buffer.from('#EXTM3U\nhttps://example.com/private-video')));
  assert.equal(renderer.list().length, 0);
});

test('native render burns Chinese text, clears expired subtitles, preserves audio and duration', { timeout: 30000 }, async t => {
  try { execFileSync('python3', ['-c', 'from PIL import Image']); execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { t.skip('native FFmpeg/Pillow unavailable'); return; }
  if (!fs.existsSync('/System/Library/Fonts/PingFang.ttc')) { t.skip('macOS Chinese font unavailable'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xhs-render-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixture = path.join(dir, 'fixture.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x335577:s=640x360:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixture]);
  const renderer = new VideoRenderer(dir);
  const item = await renderer.upload(fs.readFileSync(fixture));
  await assert.rejects(renderer.start(item.id, { cues: [{ start: 0, end: 9, text: 'invalid' }], fontSize: 32, color: '#ffffff' }), /超出/);
  await renderer.start(item.id, { cues: [{ start: 0, end: 1, text: '中文烧录测试' }], fontSize: 32, color: '#ffffff' });
  await assert.rejects(renderer.start(item.id, {}), /正在导出/);
  while (renderer.busy) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(renderer.get(item.id).status, 'completed');
  const folder = renderer.folder(item.id), output = path.join(folder, 'result.mp4');
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]));
  assert.ok(info.streams.some(s => s.codec_type === 'audio'));
  assert.ok(Math.abs(Number(info.format.duration) - 2) < 0.1);
  for (const [time, name] of [['0.5', 'caption.png'], ['1.5', 'clear.png']]) execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', time, '-i', output, '-frames:v', '1', path.join(folder, name)]);
  const counts = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; from PIL import Image; print(json.dumps([sum(1 for p in Image.open(f).convert("RGB").getdata() if min(p)>200) for f in sys.argv[1:]]))', path.join(folder, 'caption.png'), path.join(folder, 'clear.png')]));
  assert.ok(counts[0] > 100, 'subtitle is visible');
  assert.equal(counts[1], 0, 'subtitle disappears after end time');
  assert.ok(!fs.readdirSync(folder).some(file => file.startsWith('layer-')));
  assert.equal(new VideoRenderer(dir).get(item.id).status, 'completed');
});
