import { marked } from 'marked';
import { extractPostBody, extractPostParts } from './copy-body.js';

// Only generated, flat local image paths can enter a publishing package.
export function localImage(value) {
  return typeof value === 'string' && /^\/images\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(value) ? value : null;
}
export function localOriginalImage(value) {
  return typeof value === 'string' && /^\/imports\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(value) ? value : null;
}
function titleOf(text) {
  const match = text.match(/^(?:#{1,6}\s*)?(?:\*\*)?(?:小红书)?(?:主标题|笔记标题|标题)(?:\*\*)?(?=[\s:：]|$)\s*[:：]?\s*(.*)$/m);
  if (!match) return '';
  const inline = match[1].replace(/\*\*/g, '').trim();
  return (inline || text.slice(match.index + match[0].length).trim().split('\n')[0]).replace(/^[#\s*]+|[*\s]+$/g, '');
}
function explicitImages(text) {
  const urls = [];
  marked.walkTokens(marked.lexer(text || ''), token => {
    if ((token.type === 'image' || token.type === 'link') && localImage(token.href)) urls.push(token.href);
  });
  return urls;
}
/** Derived view of a final assistant turn; never mutates the saved conversation. */
function getCompletedXhsResult(messages, index) {
  const message = messages[index];
  if (!message || message.role !== 'assistant' || message.tool_calls?.length || !message.content?.trim()) return null;
  let start = index;
  while (start >= 0 && messages[start].role !== 'user') start--;
  if (start < 0) return null;
  // There is only one final delivery per user turn.
  if (messages.slice(index + 1).some((m, i, tail) => m.role === 'assistant' && !m.tool_calls?.length && !tail.slice(0, i).some(p => p.role === 'user'))) return null;
  const user = messages[start];
  const skill = user.context?.skillId || '';
  const current = user.content || '';
  const continuation = /^(?:好[的啊]?|可以|继续|开始|确认|就这样|按[这此上]|按方案|生成|做吧|改[一一下]|修改|调整|换[一一张]|重新)/.test(current.trim());
  // Inherit a platform only for a continuation, stopping at a newer platform choice.
  let inherited = false, switchedAway = false;
  if (continuation || skill === 'knowledge-content-imitation') {
    for (let i = start - 1; i >= 0; i--) {
      const previous = messages[i];
      if (previous.role !== 'user') continue;
      const value = previous.content || '';
      if (/公众号|口播|视频/.test(value) && !/小红书/.test(value)) { switchedAway = true; break; }
      if (/小红书/.test(value) || /^xiaohongshu-(?:image-post|content-director)$/.test(previous.context?.skillId || '')) { inherited = true; break; }
    }
  }
  const originals = user.context?.referenceMode === 'text-only' ? [...new Set((user.context.publishImages || []).map(localOriginalImage).filter(Boolean))] : [];
  const xhs = /小红书/.test(current) || originals.length > 0 || (!switchedAway && (/^xiaohongshu-(?:image-post|content-director)$/.test(skill) || inherited));
  if (!xhs || /(?:只|仅).{0,5}标题/.test(current) || /(?:改为|改成|换成|写一篇).{0,5}(?:公众号|视频|口播)/.test(current)) return null;
  const normalized = message.content.replace(/^(正文配文|正文文案|正文|配文|发布文案|笔记正文|笔记文案|文案正文|话题标签|标签|话题|配图说明|配图|图片|创作说明)[：:]\s*(.*)$/gm, (_, label, value) => `## ${label}\n${value}`);
  const body = extractPostBody(normalized);
  const title = titleOf(message.content);
  if (!body || !title || /^(?:#{1,6}\s*)?(?:\*\*)?(?:仿写|创作|小红书)?方案(?:[：:＊*\s]|$)/m.test(message.content) || /(?:等待.{0,8}确认|确认后.{0,8}(?:生成|制作)|是否.{0,8}(?:确认|继续))/.test(message.content)) return null;
  const generated = new Map();
  const calls = new Set();
  for (const m of messages.slice(start + 1, index)) {
    for (const call of m.tool_calls || []) if (call.function?.name === 'image_generate') calls.add(call.id);
    if (m.role !== 'tool' || !calls.has(m.tool_call_id)) continue;
    try { const result = JSON.parse(m.content); const url = localImage(result.url); if (url && !result.error) generated.set(url, url); } catch { /* malformed tool output is not an image */ }
  }
  const explicit = explicitImages(message.content);
  const images = [...new Set([...originals, ...explicit, ...generated.keys()])];
  const parts = extractPostParts(normalized);
  return { title, body, postBody: parts.body, tags: parts.tags, images, originalImageCount: originals.length, messageIndex: index };
}
export function publishUrl(sessionId, index) {
  return `/?${new URLSearchParams({ publishSession: sessionId, message: String(index) })}`;
}

/** Recover generated assets even when the provider failed before final copy. */
export function getXhsResult(messages, index) {
  const completed = getCompletedXhsResult(messages, index);
  if (completed) return completed;
  if (messages[index]?.role !== 'tool') return null;
  let start = index;
  while (start >= 0 && messages[start].role !== 'user') start--;
  if (start < 0) return null;
  let end = index + 1;
  while (end < messages.length && messages[end].role !== 'user') end++;
  const user = messages[start];
  const skill = user.context?.skillId || '';
  const current = user.content || '';
  if (/(?:改为|改成|换成|写一篇).{0,5}(?:公众号|视频|口播)/.test(current)) return null;
  let eligible = /小红书/.test(current) || /^xiaohongshu-(?:image-post|content-director)$/.test(skill);
  if (!eligible && /^(?:好|可以|继续|开始|确认|按方案|生成)/.test(current.trim())) {
    for (let i = start - 1; i >= 0; i--) {
      if (messages[i].role !== 'user') continue;
      const text = messages[i].content || '';
      if (/公众号|视频|口播/.test(text) && !/小红书/.test(text)) break;
      if (/小红书/.test(text) || /^xiaohongshu-/.test(messages[i].context?.skillId || '')) { eligible = true; break; }
    }
  }
  for (let i = start + 1; i < end; i++) if (getCompletedXhsResult(messages, i)) return null;
  const calls = new Set(), images = new Set();
  let anchor = -1;
  for (let i = start + 1; i < end; i++) {
    const m = messages[i];
    for (const call of m.tool_calls || []) if (call.function?.name === 'image_generate') calls.add(call.id);
    if (m.role !== 'tool' || !calls.has(m.tool_call_id)) continue;
    try {
      const receipt = JSON.parse(m.content), url = localImage(receipt.url);
      if (url && !receipt.error) {
        images.add(url); anchor = i;
        if (skill === 'knowledge-content-imitation' && /小红书/.test(receipt.prompt || '')) eligible = true;
      }
    } catch { /* A malformed receipt is not a successful asset. */ }
  }
  return eligible && anchor === index && images.size ? { title: '已生成素材 · 文案待完成', body: '', images: [...images], messageIndex: index, incomplete: true } : null;
}
