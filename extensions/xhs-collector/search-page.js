// Serialized into an isolated content-script world. Only rendered DOM is used.
export async function searchPage(topic, type) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = node => node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 && !node.closest('[aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden' && Number(getComputedStyle(node).opacity) > 0.01;
  const text = node => (node?.innerText || node?.textContent || '').trim();
  const cards = () => [...document.querySelectorAll('section.note-item')];
  const signature = () => cards().map(n => n.getAttribute('data-note-id')).join(',');
  function guard() {
    if (location.hostname !== 'www.xiaohongshu.com' || location.pathname.replace(/\/$/, '') !== '/search_result' || new URL(location.href).searchParams.get('keyword') !== topic) throw new Error('搜索页面已切换，请重新搜索');
    if ([...document.querySelectorAll('[role="dialog"], .login-container, .captcha-container')].some(n => visible(n) && /扫码登录|安全验证|拖动滑块|验证码/.test(text(n)))) throw new Error('请在小红书页面完成登录或验证，再重新搜索');
  }
  async function waitFor(read, timeout = 15000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { guard(); const value = read(); if (value) return value; await sleep(400); }
    throw new Error('搜索页面未就绪或结构发生变化，请在小红书页面检查后重试');
  }
  async function refreshed(before) {
    // Never rank the previous filter's still-visible cards.
    await waitFor(() => signature() !== before || !cards().length);
    let emptySince = 0;
    await waitFor(() => {
      if (cards().some(n => text(n.querySelector('.title')))) return true;
      if (/没有筛选到相关内容|没有找到相关/.test(document.body.innerText)) {
        emptySince ||= Date.now();
        return Date.now() - emptySince >= 2000;
      }
      emptySince = 0; return false;
    });
    await sleep(1000);
  }
  try {
    guard();
    const channel = await waitFor(() => document.querySelector(`.channel#${type}`));
    if (!channel.classList.contains('active')) {
      const before = signature(); channel.click(); await refreshed(before);
    }
    await waitFor(() => document.querySelector(`.channel#${type}.active`));
    const filter = await waitFor(() => document.querySelector('.filter'));
    filter.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const mostLiked = await waitFor(() => [...document.querySelectorAll('.filter-panel .tags')].find(n => visible(n) && text(n) === '最多点赞'));
    if (!mostLiked.classList.contains('active')) {
      const before = signature(); mostLiked.click(); await refreshed(before);
    }
    if (!mostLiked.classList.contains('active')) throw new Error('未能确认“最多点赞”排序，请重试');
    const collected = new Map();
    let unchanged = 0;
    for (let round = 0; round < 5; round++) {
      guard();
      if (!document.querySelector(`.channel#${type}.active`)) throw new Error('搜索类型已改变，请重新搜索');
      filter.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await waitFor(() => [...document.querySelectorAll('.filter-panel .tags')].some(visible));
      if (![...document.querySelectorAll('.filter-panel .tags.active')].some(n => visible(n) && text(n) === '最多点赞')) throw new Error('搜索排序已改变，请重新搜索');
      const previousSize = collected.size;
      for (const card of cards()) {
        if (!visible(card)) continue;
        const anchor = card.querySelector('a.cover');
        if (!anchor) continue;
        const url = new URL(anchor.getAttribute('href'), location.href);
        const id = url.pathname.match(/^\/(?:search_result|explore)\/([a-f0-9]{24})\/?$/i)?.[1]?.toLowerCase();
        if (url.origin !== location.origin || !id) continue;
        const title = text(card.querySelector('.title'));
        if (!title) continue;
        const video = !!card.querySelector('.play-icon, .video-icon, video');
        // A recognized, loaded card on this site's current DOM has a play badge for video.
        // Incomplete cards stay unknown; capture rechecks the detail before any write.
        const cardType = video ? 'video' : type === 'video' ? 'video' : anchor.querySelector('img') ? 'image' : 'unknown';
        let cover = anchor.querySelector('img')?.getAttribute('src') || '';
        try { const u = new URL(cover); if (u.protocol !== 'https:' || !/(^|\.)(xhscdn|rednotecdn)\.com$/.test(u.hostname)) cover = ''; } catch { cover = ''; }
        collected.set(id, { id, url: url.href, title: title.slice(0, 500), author: text(card.querySelector('.author .name')).slice(0, 120),
          likesText: text(card.querySelector('.like-wrapper .count')), type: cardType, cover });
        if (collected.size >= 60) break;
      }
      if (collected.size >= 60) break;
      unchanged = collected.size === previousSize ? unchanged + 1 : 0;
      if (unchanged >= 2 || !cards().length) break;
      cards().at(-1)?.scrollIntoView({ block: 'end' });
      await sleep(1400);
    }
    guard();
    return { candidates: [...collected.values()], platformSort: '最多点赞' };
  } catch (error) { return { error: error.message || '搜索失败' }; }
}
