// Runs on demand in Chrome's isolated world. No page scripts, storage or cookies are read.
export function extractNote(includeComments = false) {
  // Keep this boundary inside the injected function: Chrome does not reliably
  // relay a page-side exception as an executeScript rejection/result.
  try {
    return readNote();
  } catch (error) {
    return { error: error?.message || '读取笔记失败，请重新打开笔记详情后重试' };
  }

  function readNote() {
  const clean = value => String(value || '').replace(/\r/g, '').trim();
  const visible = node => node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && getComputedStyle(node).visibility !== 'hidden';
  const read = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const value = clean(node?.innerText || node?.textContent);
      if (value) return value;
    }
    return '';
  };
  if (!['www.xiaohongshu.com', 'www.rednote.com'].includes(location.hostname)) throw new Error('请在小红书网页版打开一篇图文笔记');
  const modal = [...document.querySelectorAll('[role="dialog"], .login-container, .captcha-container')].find(n => visible(n) && /扫码登录|安全验证|拖动滑块|验证码/.test(n.innerText || ''));
  if (modal) throw new Error('请先在小红书页面完成登录或验证，再重新采集');
  const masks = [...document.querySelectorAll('.note-detail-mask')].filter(visible);
  const mask = masks.at(-1);
  const candidates = [...(mask || document).querySelectorAll('#noteContainer, .note-container')].filter(visible);
  const root = candidates.find(n => n.querySelector('#detail-desc, .note-text'));
  if (!root) throw new Error('未找到笔记正文，请点开一篇笔记再试；列表页不能采集为笔记');
  const routeId = location.pathname.match(/^\/(?:explore|discovery\/item|search_result)\/([a-f0-9]{24})(?:\/|$)/i)?.[1];
  const noteId = clean(mask?.getAttribute('note-id') || root.getAttribute('note-id') || routeId).toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(noteId)) throw new Error('无法确认当前笔记身份，请打开笔记详情页后重试');
  const content = read(root, ['#detail-desc', '.note-content .desc', '.note-content .note-text']);
  if (!content) throw new Error('正文尚未加载，或页面结构已变化，请加载完整笔记后重试');
  const title = read(root, ['#detail-title', '.note-title']) || content.slice(0, 50);
  const author = read(root, ['.author-wrapper .username', '.author .username']);
  const stats = {
    likes: read(root, ['.interact-container .like-wrapper .count', '.like-wrapper .count']),
    collects: read(root, ['.interact-container .collect-wrapper .count', '.collect-wrapper .count']),
    comments: read(root, ['.interact-container .chat-wrapper .count', '.chat-wrapper .count']),
  };
  const slides = [...root.querySelectorAll('.swiper-slide')].filter(n => !n.classList.contains('swiper-slide-duplicate') && !n.closest('.comments-container, .comment-item'));
  slides.sort((a, b) => (Number(a.getAttribute('data-swiper-slide-index')) || 0) - (Number(b.getAttribute('data-swiper-slide-index')) || 0));
  const media = slides.length ? slides.flatMap(n => [...n.querySelectorAll('img')]) : [...root.querySelectorAll('.img-container img')];
  const imageUrls = [];
  for (const img of media) {
    if (img.closest('.avatar, .comment-item, .comments-container')) continue;
    try {
      const url = new URL(img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src'), location.href);
      if (!['http:', 'https:'].includes(url.protocol) || !/(^|\.)(xhscdn|rednotecdn)\.com$/i.test(url.hostname) || url.username || url.password) continue;
      url.protocol = 'https:';
      if (!imageUrls.includes(url.href)) imageUrls.push(url.href);
    } catch {}
  }
  if (root.querySelector('video')) throw new Error('这一版支持图文笔记，视频下载尚未接入');
  const comments = [];
  if (includeComments) {
    for (const node of root.querySelectorAll('.comment-item')) {
      const value = {
        author: read(node, ['.author-wrapper .name', '.author .name', '.name']),
        text: read(node, ['.content .note-text', '.content', '.comment-text']),
        likes: read(node, ['.like .count', '.like-wrapper .count']),
      };
      if (value.text && !comments.some(c => c.author === value.author && c.text === value.text)) comments.push(value);
      if (comments.length === 100) break;
    }
  }
  const warnings = ['配图来自当前已加载页面；尚未加载的图片不会自动补抓'];
  if (!imageUrls.length) warnings.push('未识别到配图，本次仅保存文字');
  if (imageUrls.length > 20) warnings.push('配图超过 20 张，仅保存前 20 张');
  if (includeComments) warnings.push(`评论为已加载快照（${comments.length} 条），不代表完整评论区；可滚动评论后再次采集补充`);
  return { noteId, sourceUrl: `https://www.xiaohongshu.com/explore/${noteId}`, title: title.slice(0, 500), content: content.slice(0, 30000), author: author.slice(0, 120), stats, imageUrls: imageUrls.slice(0, 20), comments, includeComments, warnings };
  }
}
