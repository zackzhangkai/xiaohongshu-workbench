export function parseTimestamp(value) {
  const match = value.match(/^(?:(\d{1,3}):)?(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error(`无效字幕时间：${value}`);
  return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}
export function validateCues(cues) {
  if (!Array.isArray(cues) || cues.length > 2000) throw new Error('每个项目最多 2000 条字幕');
  return cues.map((cue, index) => {
    if (cue.start === '' || cue.end === '' || !Number.isFinite(Number(cue.start)) || !Number.isFinite(Number(cue.end))) throw new Error(`第 ${index + 1} 条字幕时间不完整`);
    const start = Math.round(Number(cue.start) * 1000) / 1000, end = Math.round(Number(cue.end) * 1000) / 1000;
    if (start < 0 || end <= start || end >= 3600000) throw new Error(`第 ${index + 1} 条字幕需满足 0 ≤ 开始 < 结束，且不超过 1000 小时`);
    if (typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 10000) throw new Error(`第 ${index + 1} 条字幕正文为空或超过 10000 字`);
    if (/\n\s*\n/.test(cue.text) || cue.text.includes('-->') || cue.text.includes('\0')) throw new Error(`第 ${index + 1} 条正文包含空段或字幕分隔符，请拆成不同条目`);
    return { start, end, text: cue.text.trim() };
  });
}
export function parseSubtitles(raw) {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  const blocks = text.split(/\n\s*\n/);
  const vtt = /^WEBVTT(?:\s|$)/.test(blocks[0]);
  if (vtt) blocks.shift();
  let warnings = 0;
  const cues = [];
  for (const block of blocks) {
    if (vtt && /^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) { warnings++; continue; }
    const lines = block.split('\n');
    const index = lines[0]?.includes('-->') ? 0 : 1;
    const match = lines[index]?.match(/^(\S+)\s+-->\s+(\S+)(.*)$/);
    if (!match) throw new Error(`第 ${cues.length + 1} 段缺少有效时间轴`);
    if (match[3].trim()) warnings++;
    cues.push({ start: parseTimestamp(match[1]), end: parseTimestamp(match[2]), text: lines.slice(index + 1).join('\n') });
  }
  if (!cues.length) throw new Error('没有找到字幕条目');
  return { cues: validateCues(cues), warnings };
}
export function formatTimestamp(seconds, vtt = false) {
  const ms = Math.round(seconds * 1000);
  const pad = (value, digits = 2) => String(value).padStart(digits, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}${vtt ? '.' : ','}${pad(ms % 1000, 3)}`;
}
export function exportSubtitles(cues, format) {
  const valid = validateCues(cues).sort((a, b) => a.start - b.start);
  if (!valid.length) throw new Error('请先添加字幕');
  if (format === 'txt') return valid.map(c => c.text).join('\n');
  if (!['srt', 'vtt'].includes(format)) throw new Error('不支持的导出格式');
  const vtt = format === 'vtt';
  return (vtt ? 'WEBVTT\n\n' : '') + valid.map((cue, i) => `${vtt ? '' : `${i + 1}\n`}${formatTimestamp(cue.start, vtt)} --> ${formatTimestamp(cue.end, vtt)}\n${cue.text}`).join('\n\n') + '\n';
}
export function offsetCues(cues, offset) {
  if (!Number.isFinite(Number(offset)) || offset === '') throw new Error('请输入有效偏移秒数');
  return validateCues(validateCues(cues).map(cue => ({ ...cue, start: cue.start + Number(offset), end: cue.end + Number(offset) })));
}
