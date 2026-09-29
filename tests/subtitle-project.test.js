import test from 'node:test';
import assert from 'node:assert/strict';
import { subtitleProject, encodeSubtitleProject } from '../src/subtitle-project.js';
test('portable project retains timing, text and style while discarding file paths and unknown fields', () => {
  const source = { name: '中文字幕', cues: [{ start: 0.125, end: 2.345, text: '第一行\n第二行' }], fontSize: 48, color: '#ffcc00', file: '/private/video.mp4' };
  const encoded = encodeSubtitleProject(source), restored = subtitleProject(JSON.parse(encoded));
  assert.deepEqual(restored.cues, source.cues); assert.equal(restored.fontSize, 48); assert.equal(restored.color, '#ffcc00'); assert.equal(encoded.includes('/private'), false);
});
test('legacy draft migration is explicit and future versions or invalid style do not overwrite valid data', () => {
  const old = { name: '旧草稿', cues: [] };
  assert.equal(subtitleProject(old, { legacy: true }).fontSize, 32);
  assert.throws(() => subtitleProject(old));
  const valid = JSON.parse(encodeSubtitleProject(old));
  for (const extra of [{ version: 2 }, { fontSize: -1 }, { color: 'url(test)' }, { cues: [{ start: 2, end: 1, text: '无效' }] }]) assert.throws(() => subtitleProject({ ...valid, ...extra }));
});
