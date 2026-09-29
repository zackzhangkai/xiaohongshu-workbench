import React, { useEffect, useState } from 'react';
import { ClipboardList, Captions, Images, ScanLine, ImageMinus, Mic, AudioLines, Plus, ArrowUp, ArrowUpRight, CalendarDays, FileText, ChevronRight } from 'lucide-react';
import { request, writeJson } from '../api.js';
const TOOLS = [
  ['账号运营规划', ClipboardList], ['视频文案提取', Captions], ['链接素材下载', Images],
  ['图片转 Live 图', ScanLine], ['图片去 AI 元数据', ImageMinus], ['AI 配音', Mic], ['音视频转文字', AudioLines],
];
export default function HomePage({ sessions, onSession, onNavigate, onCompose }) {
  const [tab, setTab] = useState('日报');
  const [topic, setTopic] = useState('');
  const [idea, setIdea] = useState('');
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tool, setTool] = useState(null);
  const load = () => request('/api/notes').then((d) => setNotes(d.notes ?? [])).catch((e) => setError(e.message));
  useEffect(() => {
    let cancelled = false, fetching = false;
    const refresh = async () => {
      if (fetching || document.hidden) return;
      fetching = true;
      try { const data = await request('/api/notes'); if (!cancelled) setNotes(data.notes ?? []); }
      catch (e) { if (!cancelled) setError(e.message); }
      finally { fetching = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    const close = (e) => { if (e.key === 'Escape') setTool(null); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, []);
  const topics = notes.filter((n) => n.source === 'topic');
  const addIdea = async (e) => {
    e.preventDefault();
    if (!idea.trim() || saving) return;
    setSaving(true); setError('');
    try { await request('/api/notes', writeJson('POST', { title: idea.trim(), source: 'topic', tags: ['选题'] })); setIdea(''); await load(); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  return <div className="home-page">
    <section className="home-tools">
      <div className="section-heading"><h2>小工具</h2><button className="text-button" onClick={() => onNavigate('tools')}>查看全部</button></div>
      <div className="tool-shelf">{TOOLS.map(([label, Icon], i) => <button key={label} className={`home-tool tone-${i % 3}`} onClick={() => ["音视频转文字", "视频文案提取"].includes(label) ? onNavigate("transcription") : label === 'AI 配音' ? onNavigate('voice') : label === '账号运营规划' ? onNavigate('profile') : label === '图片去 AI 元数据' ? onNavigate('image-cleaner') : setTool(label)}><span className="tool-art"><Icon size={38} strokeWidth={1.7} /></span><span>{label}</span></button>)}
        <button className="home-tool create-tool" onClick={() => setTool('创建小工具')}><span className="tool-art"><Plus size={28} /></span><span>创建</span></button></div>
    </section>
    <section className="home-start"><h1>从选题开始</h1>
      <div className="inspiration-panel">
        <div className="inspiration-tabs" role="tablist" aria-label="选题来源">{['日报', '输入主题', '从知识库找灵感'].map((label) => <button key={label} role="tab" aria-selected={tab === label} onClick={() => setTab(label)}>{label}</button>)}</div>
        <div className="inspiration-content" role="tabpanel">
          {tab === '日报' && <><div className="daily-date"><CalendarDays size={17} /><span>今天</span><span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div><div className="daily-empty"><CalendarDays size={33} strokeWidth={1.2} /><h3>今天的灵感，从这里开始</h3><p>还没有生成日报。先记下一个主题，或从已有素材中找到创作方向。</p><button className="btn soft" onClick={() => setTab('输入主题')}>输入一个主题 <ArrowUpRight size={15} /></button></div></>}
          {tab === '输入主题' && <form className="topic-composer" onSubmit={(e) => { e.preventDefault(); if (topic.trim()) onCompose(`请围绕这个主题帮我梳理创作方向：${topic.trim()}`); }}><h3>今天想聊点什么？</h3><textarea aria-label="创作主题" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="输入一个主题、想法，或你想解决的问题…" /><button className="btn soft" disabled={!topic.trim()}>去创作 <ArrowUpRight size={16} /></button></form>}
          {tab === '从知识库找灵感' && <div className="inspiration-notes">{notes.length ? notes.slice(0, 4).map((n) => <button key={n.id} className="inspiration-note" onClick={() => onCompose(`请基于以下素材梳理创作方向：\n\n${n.title}\n${n.content || n.summary || ''}`)}><FileText size={20} /><span><strong>{n.title}</strong><small>{n.summary || n.content?.slice(0, 80) || '从这条笔记开始讨论'}</small></span><ArrowUpRight size={17} /></button>) : <div className="daily-empty"><FileText size={30} /><h3>先收藏，再创作</h3><p>把想法和资料保存在知识库，让下一次创作有据可循。</p></div>}<button className="text-button" onClick={() => onNavigate('knowledge')}>打开知识库 <ChevronRight size={15} /></button></div>}
        </div>
      </div>
    </section>
    {error && <p role="alert" className="msg-error">{error}</p>}
    <section className="home-topics"><div className="section-heading"><h2>选题池</h2><button className="text-button" onClick={() => onNavigate('knowledge')}>查看全部</button></div>
      <form className="idea-input" onSubmit={addIdea}><Plus size={18} /><input aria-label="选题灵感" placeholder="记下一条选题灵感，回车保存" value={idea} onChange={(e) => setIdea(e.target.value)} /><button className="icon-button" disabled={!idea.trim() || saving} aria-label="保存选题"><ArrowUp size={18} /></button></form>
      {topics.length > 0 && <div className="topic-list">{topics.slice(0, 4).map((n) => <button key={n.id} onClick={() => onCompose(`请围绕这个选题开始创作：${n.title}`)}><span>{n.title}</span><ArrowUpRight size={17} /></button>)}</div>}
    </section>
    <div className="home-bottom"><section><div className="section-heading"><h2>继续创作</h2></div>{sessions.length ? sessions.slice(0, 3).map((s) => <button className="continue-item" key={s.id} onClick={() => onSession(s.id)}><span>{s.title}</span><ChevronRight size={16} /></button>) : <p className="quiet-empty">开始一段对话，创作记录会留在这里</p>}</section><section><div className="section-heading"><h2>最近产出</h2><button className="text-button" onClick={() => onNavigate('subjects')}>查看素材</button></div><p className="quiet-empty">在内容资产中查看已生成的图片</p></section></div>
    {tool && <div className="modal-backdrop" onClick={() => setTool(null)}><section className="small-dialog" role="dialog" aria-modal="true" aria-label={tool} onClick={(e) => e.stopPropagation()}><h2>{tool}</h2><p>这个小工具将在后续阶段接入。现在可以先使用已有技能开始创作。</p><div><button className="btn" autoFocus onClick={() => setTool(null)}>关闭</button><button className="btn soft" onClick={() => onNavigate('tools')}>查看已有技能</button></div></section></div>}
  </div>;
}
