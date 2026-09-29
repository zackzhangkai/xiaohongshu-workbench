// Local browser fixtures. Only synthetic content; never touches a real knowledge base.
// Run: rtk proxy node tests/collector-search-fixture.js
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { searchPage } from '../extensions/xhs-collector/search-page.js';
import { extractNote } from '../extensions/xhs-collector/extract.js';
const root = new URL('../extensions/xhs-collector/', import.meta.url);
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const bootstrap = `<script>
const data = { followedTopics: ['AI 编程','个人知识库'], discoveryResult: { runId: 'fixture', topic: 'AI 编程', type: 'all', searchedAt: Date.now(), candidateCount: 42, unknownLikes: 1, unknownTypes: 1, platformSort: '最多点赞', items: [
{id:'a'.repeat(24),rank:1,title:'用 AI 把想法变成自己的第一个工具',author:'示例作者',type:'image',likesText:'1.2万',likes:12000},
{id:'b'.repeat(24),rank:2,title:'十分钟看懂 Agent 的工作方式',author:'视频示例',type:'video',likesText:'7211',likes:7211},
{id:'c'.repeat(24),rank:3,title:'个人知识库：从收藏到真正用起来',author:'示例作者',type:'image',likesText:'4770',likes:4770},
{id:'d'.repeat(24),rank:4,title:'页面类型尚未确认的内容',author:'示例作者',type:'unknown',likesText:'4200',likes:4200}
] } };
window.chrome = { storage: { local: { get: async () => structuredClone(data), set: async x => Object.assign(data,x) }, onChanged: { addListener: () => {} } }, runtime: { sendMessage: async m => { if(m.type==='batch') document.body.dataset.selected = m.ids.join(','); return {}; }, openOptionsPage: () => {} }, permissions: {request: async () => false}, tabs: { create: async () => {} } };
</script>`;
const domScript = `
const location = {origin:'https://www.xiaohongshu.com',hostname:'www.xiaohongshu.com',pathname:'/search_result',href:'https://www.xiaohongshu.com/search_result?keyword=AI'};
const setTimeout = (fn,ms) => window.setTimeout(fn,Math.min(ms,5));
const extract = ${searchPage.toString()};
const out=document.getElementById('reports'),host=document.getElementById('fixture'),reports=[];
const card=(id,title,likes,video=false)=>'<section class="note-item" data-note-id="'+id+'"><a class="cover" href="https://www.xiaohongshu.com/search_result/'+id+'?xsec_token=fixture"><img src="data:,">'+(video?'<span class="play-icon">▶</span>':'')+'</a><a class="title">'+title+'</a><span class="author"><span class="name">作者</span></span><span class="like-wrapper"><span class="count">'+likes+'</span></span></section>';
const controls='<div id="all" class="channel active">全部</div><div id="image" class="channel">图文</div><div id="video" class="channel">视频</div><div class="filter">筛选<div class="filter-panel"><div class="tags active">综合</div><div class="tags" aria-hidden="true">最多点赞</div><div class="tags">最多点赞</div></div></div><div id="cards"></div>';
const setup=()=>{
 host.innerHTML=controls;
 const draw=()=>{const type=host.querySelector('.channel.active').id;host.querySelector('#cards').innerHTML=type==='video'?card('b'.repeat(24),'视频','2万',true):type==='image'?card('a'.repeat(24),'图文','1.2万'):card('a'.repeat(24),'图文','1.2万')+card('b'.repeat(24),'视频','2万',true);};
 host.querySelectorAll('.channel').forEach(n=>n.onclick=()=>{host.querySelector('.channel.active').classList.remove('active');n.classList.add('active');draw();});
 host.querySelector('.tags:last-child').onclick=()=>{host.querySelector('.tags.active').classList.remove('active');host.querySelector('.tags:last-child').classList.add('active');host.querySelector('#cards').innerHTML='';window.setTimeout(draw,1);};draw();
};
const check=(ok,label)=>{if(!ok)throw Error(label)};
for(const type of ['all','image','video']){try{setup();location.pathname=type==='image'?'/search_result/':'/search_result';const result=await extract('AI',type);check(!result.error,result.error);check(result.platformSort==='最多点赞','sort');check(result.candidates.length===(type==='all'?2:1),'count');check(result.candidates.every(c=>type==='all'||c.type===type),'type');reports.push('PASS '+type+' 类型筛选、排序和卡片提取');}catch(e){reports.push('FAIL '+type+': '+e.message);}}
try{setup();host.insertAdjacentHTML('beforeend','<div class="captcha-container">安全验证</div>');check((await extract('AI','image')).error?.includes('登录或验证'),'login');reports.push('PASS 登录验证中止');}catch(e){reports.push('FAIL '+e.message);}
try{setup();check((await extract('其他主题','image')).error?.includes('页面已切换'),'query');reports.push('PASS 主题不匹配拒绝旧结果');}catch(e){reports.push('FAIL '+e.message);}
host.innerHTML='';out.textContent=reports.join('\\n');document.title=reports.every(x=>x.startsWith('PASS'))?'5/5 Search DOM passed':'Search DOM failed';
`;
http.createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(route==='/search-source' || route==='/extract-source') { res.setHeader('Content-Type','text/html;charset=utf-8'); return res.end(`<pre>${escape((route==='/search-source'?searchPage:extractNote).toString())}</pre>`); }
  if(route==='/dom.html') {res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(`<!doctype html><meta charset="utf-8"><title>Search DOM</title><style>body{font:16px system-ui;padding:24px}#reports{white-space:pre-wrap}.note-item,.channel,.tags{width:300px;min-height:20px}[aria-hidden]{display:none}</style><h1>主题搜索 DOM 测试（合成数据）</h1><pre id="reports">运行中</pre><div id="fixture"></div><script type="module">${domScript}</script>`);}
  const allowed=['search.html','search.css','style.css','search-ui.js','search-core.js','transport.js'];
  const file=route.slice(1);
  if(!allowed.includes(file)){res.writeHead(404);return res.end();}
  let content=fs.readFileSync(fileURLToPath(new URL(file,root)),'utf8');
  if(file==='search.html')content=content.replace('<body class="discovery">','<body class="discovery"><p style="text-align:center;background:#eee5d6;padding:8px;margin:0">合成数据预览 · 非实际搜索结果</p>').replace('<script type="module"',bootstrap+'<script type="module"');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html;charset=utf-8');res.end(content);
}).listen(18792,'127.0.0.1',()=>console.log('Search fixtures: http://127.0.0.1:18792/search.html and /dom.html'));
