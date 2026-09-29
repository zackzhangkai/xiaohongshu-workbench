import { marked } from 'marked';

const bodyTitle = /^(?:小红书)?(?:正文配文|正文文案|正文|配文|发布文案|笔记正文|笔记文案|文案正文)(?:$|[（(：:\s])/;
const tagsTitle = /^(?:推荐)?(?:话题标签|标签|话题)(?:$|[（(：:\s])/;
const titleTitle = /^(?:小红书)?(?:主标题|笔记标题|标题)(?:$|[（(：:\s])/;
// “**正文**：”-style label-only lines carry their value on the next block;
// rewriting them to headings lets the section walkers recognize them.
const labelledLine = /^[ \t]*(?:\*\*|__)?((?:小红书)?(?:正文配文|正文文案|正文|配文|发布文案|笔记正文|笔记文案|文案正文|推荐话题|话题标签|标签|话题|主标题|笔记标题|标题))(?:\*\*|__)?[ \t]*[：:][ \t]*$/gm;
const normalizeLabels = (markdown) => (markdown || '').replace(labelledLine, '## $1');
function heading(token) {
  if (token.type === 'heading') return { depth: token.depth, text: token.text };
  // Some model replies use a standalone bold section label instead of a heading.
  if (token.type === 'paragraph' && token.tokens?.length === 1 && token.tokens[0].type === 'strong') {
    const text = token.tokens[0].text;
    if (/^(?:小红书)?(?:正文配文|正文文案|正文|配文|发布文案|笔记正文|笔记文案|文案正文|推荐话题|话题标签|标签|话题|主标题|笔记标题|标题|配图|图片|轮播图脚本|脚本|创作说明)(?:$|[（(：:\s])/.test(label(text))) return { depth: 7, text };
  }
  return null;
}
// Circled digits count as numbers, so the generic prefix strip keeps them;
// enumeration markers like “② 正文（整段复制）” still need their own strip.
const label = (text) => text.replace(/[*_`]/g, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^[\d①-⑳]{1,2}[、.．:：)）]?\s*/u, '').trim();

/** Only isolate explicitly labelled body sections; never guess from the prose itself. */
export function extractPostBody(markdown) {
  const tokens = marked.lexer(normalizeLabels(markdown), { gfm: true });
  const start = tokens.findIndex((t) => { const h = heading(t); return h && bodyTitle.test(label(h.text)); });
  if (start < 0) return null;
  const depth = heading(tokens[start]).depth;
  let end = start + 1;
  while (end < tokens.length && !(heading(tokens[end])?.depth <= depth)) end++;
  const body = tokens.slice(start + 1, end).filter((t) => t.type !== 'hr').map((t) => t.raw).join('').trim();
  if (!body) return null;
  // Keep a separately labelled, adjacent hashtag section with the post body.
  if (end < tokens.length && tagsTitle.test(label(heading(tokens[end]).text))) {
    const tagDepth = heading(tokens[end]).depth;
    let tagEnd = end + 1;
    while (tagEnd < tokens.length && !(heading(tokens[tagEnd])?.depth <= tagDepth)) tagEnd++;
    const tags = tokens.slice(end + 1, tagEnd).filter((t) => t.type !== 'hr').map((t) => t.raw).join('').trim();
    return tags ? `${body}\n\n${tags}` : body;
  }
  return body;
}

/** Publishing fields, without changing extractPostBody's combined-text contract. */
export function extractPostParts(markdown) {
  const tokens = marked.lexer(normalizeLabels(markdown), { gfm: true });
  const start = tokens.findIndex(t => { const h = heading(t); return h && bodyTitle.test(label(h.text)); });
  if (start < 0) return { body: '', tags: '' };
  const depth = heading(tokens[start]).depth;
  let end = start + 1;
  while (end < tokens.length && !(heading(tokens[end])?.depth <= depth)) end++;
  const bodyTokens = tokens.slice(start + 1, end).filter(t => t.type !== 'hr');
  let tags = '';
  if (end < tokens.length && tagsTitle.test(label(heading(tokens[end]).text))) {
    const tagDepth = heading(tokens[end]).depth;
    let tagEnd = end + 1;
    while (tagEnd < tokens.length && !(heading(tokens[tagEnd])?.depth <= tagDepth)) tagEnd++;
    tags = tokens.slice(end + 1, tagEnd).filter(t => t.type !== 'hr').map(t => t.raw).join('').trim();
  }
  // Only an entire trailing hashtag line in a paragraph is a topic candidate.
  // Markdown headings and fenced/indented code remain body content.
  let tail = bodyTokens.length - 1;
  while (tail >= 0 && bodyTokens[tail].type === 'space') tail--;
  const token = bodyTokens[tail];
  if (!tags && token?.type === 'paragraph') {
    const lines = token.raw.trimEnd().split('\n');
    const topicLine = /^\s*#[^\s#`]+(?:[ \t]+#[^\s#`]+)*\s*$/u;
    const topics = [];
    while (lines.length && topicLine.test(lines.at(-1))) topics.unshift(lines.pop().trim());
    if (topics.length) {
      tags = topics.join('\n');
      bodyTokens[tail] = { ...token, raw: lines.join('\n') };
    }
  }
  return { body: bodyTokens.map(t => t.raw).join('').trim(), tags };
}

/** Explicitly labelled 标题 value: same-line “标题：值”, or the labelled section's
 *  first inline-code option (标题二选一 lists) / first line. Empty when unlabelled. */
export function extractPostTitle(markdown) {
  const text = normalizeLabels(markdown);
  const inline = text.match(/^[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*|__)?(?:小红书)?(?:主标题|笔记标题|标题)(?:\*\*|__)?[ \t]*[：:][ \t]*(\S.*)$/m);
  if (inline) return inline[1].replace(/[*_`]/g, '').trim();
  const tokens = marked.lexer(text, { gfm: true });
  const start = tokens.findIndex(t => { const h = heading(t); return h && titleTitle.test(label(h.text)); });
  if (start < 0) return '';
  const depth = heading(tokens[start]).depth;
  let end = start + 1;
  while (end < tokens.length && !(heading(tokens[end])?.depth <= depth)) end++;
  const section = tokens.slice(start + 1, end).map(t => t.raw).join('').trim();
  if (!section) return '';
  const option = section.match(/`([^`]+)`/);
  return (option?.[1] ?? section.split('\n')[0]).replace(/[*_`#>]/g, '').trim();
}

export function postCopyFields(result) {
  if (!result || result.incomplete) return { title: '', body: '', tags: '', all: '' };
  const title = result.title || '', body = result.postBody ?? result.body ?? '', tags = result.tags || '';
  return { title, body, tags, all: [title, body, tags].filter(value => value.trim()).join('\n\n') };
}
