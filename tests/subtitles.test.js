import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubtitles, exportSubtitles, offsetCues, validateCues, formatTimestamp } from '../src/subtitles.js';
test('SRT preserves multiline Chinese, BOM, CRLF and millisecond precision through export', () => {
  const source = '\uFEFF1\r\n00:00:01,125 --> 00:00:03,999\r\n第一行\r\n第二行\r\n\r\n2\r\n01:02:03,004 --> 01:02:04,000\r\n下一条\r\n';
  const parsed = parseSubtitles(source);
  assert.equal(parsed.cues[0].text, '第一行\n第二行');
  assert.equal(parsed.cues[1].start, 3723.004);
  assert.deepEqual(parseSubtitles(exportSubtitles(parsed.cues, 'srt')).cues, parsed.cues);
  assert.deepEqual(parseSubtitles(exportSubtitles(parsed.cues, 'vtt')).cues, parsed.cues);
});
test('VTT accepts cue IDs, ignores declared metadata with warnings, retains overlapping cues', () => {
  const source = 'WEBVTT\n\nNOTE example\nnote body\n\ncue-id\n00:01.000 --> 00:03.000 align:start\nHello\n\n00:02.000 --> 00:04.000\nWorld';
  const parsed = parseSubtitles(source);
  assert.equal(parsed.warnings, 2);
  assert.equal(parsed.cues.length, 2);
  assert.equal(exportSubtitles(parsed.cues, 'txt'), 'Hello\nWorld');
});
test('offset is exact, preserves duration, and rejects negative results without mutating source', () => {
  const cues = [{ start: 1.125, end: 2.125, text: 'hi' }];
  const offset = offsetCues(cues, -0.125);
  assert.deepEqual(offset, [{ start: 1, end: 2, text: 'hi' }]);
  assert.throws(() => offsetCues(cues, -2));
  assert.equal(cues[0].start, 1.125);
  assert.equal(formatTimestamp(59.9999), '00:01:00,000');
});
test('malformed blocks, invalid times and blank bodies cannot silently disappear', () => {
  for (const source of ['', '1\n00:61:00,000 --> 00:62:00,000\nhi', '1\n00:00:03,000 --> 00:00:01,000\nhi', '1\n00:00:00,000 --> 00:00:01,000\n', 'garbage']) assert.throws(() => parseSubtitles(source));
  assert.throws(() => validateCues([{ start: '', end: 1, text: 'a' }]));
  assert.throws(() => validateCues([{ start: 0, end: 1, text: 'a\n\nb' }]));
  assert.throws(() => validateCues([{ start: 0, end: 1, text: 'a --> b' }]));
});
