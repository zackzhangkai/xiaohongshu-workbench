import { validateCues } from './subtitles.js';
export function subtitleProject(input, { legacy = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('字幕工程内容无效');
  if (!(legacy && input.version === undefined) && (input.type !== 'subtitle-project' || input.version !== 1)) throw new Error('不支持的字幕工程格式或版本');
  const fontSize = input.fontSize ?? 32, color = input.color ?? '#ffffff';
  if (![24, 32, 40, 48].includes(fontSize) || typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('字幕工程样式无效');
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200) throw new Error('字幕工程名称无效');
  return { type: 'subtitle-project', version: 1, name: input.name, cues: validateCues(input.cues), fontSize, color };
}
export function encodeSubtitleProject(input) {
  const output = JSON.stringify(subtitleProject({ ...input, type: 'subtitle-project', version: 1 }), null, 2);
  if (new TextEncoder().encode(output).length > 20000000) throw new Error('工程文件超过 20MB，请拆分字幕');
  return output;
}
