export const SEARCH_ORIGIN = 'https://www.xiaohongshu.com/*';
export const TYPE_LABELS = { all: '全部', image: '图文', video: '视频', unknown: '类型待确认' };

export function searchSpec(topic, type = 'image') {
  topic = String(topic || '').trim();
  if (!topic || topic.length > 80) throw new Error('请输入 1–80 字的主题');
  if (!['all', 'image', 'video'].includes(type)) throw new Error('内容类型无效');
  const url = new URL('https://www.xiaohongshu.com/search_result');
  url.searchParams.set('keyword', topic);
  return { topic, type, url: url.href };
}

export function noteLink(raw, expectedId) {
  const url = new URL(raw);
  const id = url.pathname.match(/^\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{24})\/?$/i)?.[1]?.toLowerCase();
  if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.username || url.password || url.port || !id || (expectedId && id !== expectedId)) throw new Error('笔记链接或身份无效，请重新搜索');
  return { id, url: url.href, canonical: `https://www.xiaohongshu.com/explore/${id}` };
}

// Xiaohongshu redirects signed /search_result/<id> links to the canonical
// /explore/<id> page: the same note, only the path prefix changes. Compare note
// identity for note URLs; keep exact path comparison for every other page.
export function sameNotePath(expected, actual) {
  const noteIdOf = raw => { try { return new URL(raw).pathname.match(/^\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{24})\/?$/i)?.[1]?.toLowerCase() || null; } catch { return null; } };
  const expectedId = noteIdOf(expected);
  if (!expectedId) return new URL(expected).pathname.replace(/\/$/, '') === new URL(actual).pathname.replace(/\/$/, '');
  return expectedId === noteIdOf(actual);
}

export function parseLikes(raw) {
  const match = String(raw ?? '').trim().replace(/[,，\s]/g, '').match(/^(\d+(?:\.\d+)?)(万|千|亿|w|k)?\+?$/i);
  if (!match) return null;
  const value = Number(match[1]) * ({ 万: 10000, 千: 1000, 亿: 100000000, w: 10000, k: 1000 }[match[2]?.toLowerCase()] || 1);
  return Number.isSafeInteger(Math.round(value)) ? Math.round(value) : null;
}

export function rankResults(candidates, type) {
  const unique = new Map();
  for (const item of candidates) {
    try {
      const link = noteLink(item.url, item.id);
      const next = { ...item, id: link.id, sourceUrl: link.canonical, likes: parseLikes(item.likesText) };
      if (!['image', 'video'].includes(next.type)) next.type = 'unknown';
      const previous = unique.get(next.id);
      if (!previous || (next.likes !== null && (previous.likes === null || next.likes > previous.likes))) unique.set(next.id, next);
    } catch { /* Ignore invalid external cards. */ }
  }
  const matching = [...unique.values()].filter(item => type === 'all' || item.type === type);
  const ranked = matching.filter(item => item.likes !== null).sort((a, b) => b.likes - a.likes || a.id.localeCompare(b.id));
  return { candidateCount: unique.size, matchingCount: matching.length, unknownLikes: matching.length - ranked.length,
    unknownTypes: [...unique.values()].filter(item => item.type === 'unknown').length,
    items: ranked.slice(0, 10).map((item, index) => ({ ...item, rank: index + 1 })) };
}

export function selectBatch(result, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10) throw new Error('请选择 1–10 篇图文');
  const selected = [...new Set(ids)].map(id => result?.items?.find(item => item.id === id));
  if (selected.some(item => !item || item.type !== 'image')) throw new Error('仅支持本次结果中的图文入库；视频或未知类型请查看原文');
  return selected;
}
