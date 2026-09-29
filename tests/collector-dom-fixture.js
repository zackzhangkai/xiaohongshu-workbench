// Manual browser fixture server; no real platform requests or user data.
// Run: node tests/collector-dom-fixture.js ; visit http://127.0.0.1:18791
import http from 'node:http';
import { extractNote } from '../extensions/xhs-collector/extract.js';
const script = `
(() => {
const location = { hostname: 'www.xiaohongshu.com', pathname: '/explore/aaaaaaaaaaaaaaaaaaaaaaaa', href: 'https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa' };
const extract = ${extractNote.toString()};
const host = document.getElementById('fixture');
const reports = [];
const expect = (ok, label) => { if (!ok) throw new Error(label); };
function check(label, fn) { try { fn(); reports.push('PASS ' + label); } catch(e) { reports.push('FAIL ' + label + ': ' + e.message); } }
const markup = '<div class="note-detail-mask" note-id="bbbbbbbbbbbbbbbbbbbbbbbb"><article id="noteContainer"><h1 id="detail-title">当前笔记</h1><div id="detail-desc">正文<br>第二段 #标签</div><div class="author"><span class="username">作者</span></div><div class="like-wrapper"><span class="count">2万</span></div><div class="swiper-slide" data-swiper-slide-index="1"><img src="https://sns.xhscdn.com/two.png"></div><div class="swiper-slide" data-swiper-slide-index="0"><img src="https://sns.xhscdn.com/one.png"></div><div class="swiper-slide swiper-slide-duplicate"><img src="https://sns.xhscdn.com/one.png"></div><div class="comment-item"><div class="name">读者</div><div class="content">需要教程</div></div><div class="comment-item"><div class="name">读者</div><div class="content">需要教程</div></div></article></div>';
check('弹层身份优先，配图排序去重，正文保留换行，评论去重', () => {
  host.innerHTML = markup;
  const result = extract(true);
  expect(result.noteId === 'bbbbbbbbbbbbbbbbbbbbbbbb', 'stale route id');
  expect(result.title === '当前笔记' && result.content.includes('\\n'), 'body');
  expect(result.imageUrls.length === 2 && result.imageUrls[0].endsWith('/one.png'), 'image order');
  expect(result.comments.length === 1 && result.stats.likes === '2万' && result.stats.comments === '', 'comments/stats');
});
check('评论未勾选时不采集', () => expect(extract(false).comments.length === 0, 'opt-in'));
check('隐藏旧弹层不误采，头像与外部图片排除', () => {
  host.innerHTML = '<div class="note-detail-mask" style="display:none" note-id="cccccccccccccccccccccccc"><div id="noteContainer"><div id="detail-desc">错误旧正文</div></div></div>' + markup;
  const root = host.querySelector('.note-detail-mask:last-child #noteContainer');
  root.insertAdjacentHTML('beforeend', '<div class="swiper-slide"><div class="avatar"><img src="https://sns.xhscdn.com/avatar.png"></div><img src="https://evil.example/image.png"></div>');
  const result = extract(true); expect(result.title === '当前笔记' && result.imageUrls.length === 2, 'scope');
});
check('列表页返回明确错误', () => { host.innerHTML = '<h1>搜索结果</h1>'; expect(extract().error?.includes('列表页'), 'should explain list page'); });
check('登录或安全验证弹窗返回明确错误', () => { host.innerHTML = markup + '<div role="dialog">安全验证</div>'; expect(extract().error?.includes('登录或验证'), 'should explain login'); });
check('视频笔记返回明确边界而非丢失结果', () => { host.innerHTML = '<div class="note-detail-mask" note-id="bbbbbbbbbbbbbbbbbbbbbbbb"><article id="noteContainer"><h1 id="detail-title">视频</h1><div id="detail-desc">视频文案</div><video></video></article></div>'; expect(extract().error?.includes('视频下载尚未接入'), 'should explain video'); });
host.innerHTML = '';
document.getElementById('results').textContent = reports.join('\\n');
document.title = reports.every(r => r.startsWith('PASS')) ? reports.length + '/' + reports.length + ' DOM fixtures passed' : 'DOM fixtures failed';
})();
`;
const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"><title>采集器 DOM 测试</title><style>body{font:16px system-ui;padding:24px}#results{white-space:pre-wrap;line-height:2}#fixture article{width:600px;min-height:100px}</style><h1>合成页面验收（非真实小红书）</h1><div id="fixture"></div><pre id="results">Running</pre><script>${script}</script>`;
http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(html); }).listen(18791, '127.0.0.1', () => console.log('DOM fixture: http://127.0.0.1:18791'));
