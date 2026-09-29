import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, ArrowLeft, Trash2, FileText, Clock3, Folder, ChevronDown, ChevronRight, Tag, Layers3, Library, Rss, Upload, ArrowUpRight, Download, X } from 'lucide-react';
import { request, writeJson } from '../api.js';
import { downloadBlob } from '../publish-download.js';
import DocumentImporter from '../components/DocumentImporter.jsx';
import CopyTextButton from '../components/CopyTextButton.jsx';
import CollectorSetup from '../components/CollectorSetup.jsx';
const fmtTime = (ts) => new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
const noteType = (n) => n.source === 'topic' ? '选题' : n.source === 'manuscript' ? '稿件' : /xiaohongshu|xhs/.test(String(n.source)) ? '小红书图文' : '文档';

export default function KnowledgePage({ active, busy, searchKey, initialCollectorOpen = false, initialNoteId = null, onAssets, onCompose, onRewriteCopy }) {
  const [notes, setNotes] = useState([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('全部');
  const [tag, setTag] = useState(null);
  const [sort, setSort] = useState('updatedAt');
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [packageBusy, setPackageBusy] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const inputRef = useRef(null);
  const openedInitialNote = useRef(false);
  const [importOpen, setImportOpen] = useState(false);
  const [collectorOpen, setCollectorOpen] = useState(initialCollectorOpen);
  const load = async () => {
    const data = await request('/api/notes'); setNotes(data.notes ?? []); setRefreshError('');
  };
  useEffect(() => {
    if (!active) return;
    let cancelled = false, fetching = false;
    const refresh = async () => {
      if (fetching || document.hidden) return;
      fetching = true;
      try {
        const data = await request('/api/notes');
        if (!cancelled) { setNotes(data.notes ?? []); setRefreshError(''); }
      } catch { if (!cancelled) setRefreshError('暂时无法刷新知识库，正在重试'); }
      finally { fetching = false; if (!cancelled) setLoading(false); }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [active]);
  useEffect(() => { if (searchKey) inputRef.current?.focus(); }, [searchKey]);
  useEffect(() => {
    if (!initialNoteId || openedInitialNote.current) return;
    const note = notes.find((item) => item.id === initialNoteId);
    if (!note) return;
    openedInitialNote.current = true;
    setEditing({ ...note }); setConfirmDelete(false);
  }, [initialNoteId, notes]);
  const tags = useMemo(() => {
    const counts = new Map();
    notes.forEach((n) => [...new Set(n.tags ?? [])].forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [notes]);
  const types = ['全部', ...['小红书图文', '文档', '选题', '稿件'].filter((t) => notes.some((n) => noteType(n) === t))];
  const filtered = useMemo(() => notes.filter((n) => {
    if (type !== '全部' && noteType(n) !== type) return false;
    if (tag === '__none' && n.tags?.length) return false;
    if (tag && tag !== '__none' && !n.tags?.includes(tag)) return false;
    return `${n.title}\n${n.summary}\n${n.content}\n${n.importInfo?.relativePath || ''}\n${(n.tags ?? []).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0)), [notes, type, tag, sort, query]);
  const newNote = () => { setEditing({ title: '', summary: '', content: '', tags: [], source: 'manual' }); setError(''); setConfirmDelete(false); };
  const save = async ({ compose = false, rewriteCopy = false } = {}) => {
    if (!editing || saving) return; setSaving(true); setError('');
    const value = { title: editing.title.trim() || '未命名笔记', summary: editing.summary, content: editing.content,
      tags: typeof editing.tags === 'string' ? [...new Set(editing.tags.split(/[,，\s]+/).filter(Boolean))] : editing.tags ?? [] };
    try {
      const saved = editing.id ? await request(`/api/notes/${editing.id}`, writeJson('PATCH', value))
        : await request('/api/notes', writeJson('POST', { ...value, source: editing.source || 'manual' }));
      await load(); setEditing(null);
      if (rewriteCopy) onRewriteCopy(saved);
      else if (compose) onCompose(saved);
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const original = editing?.id && notes.find((n) => n.id === editing.id);
  const hasEdits = original && ['title', 'summary', 'content', 'tags'].some((key) => JSON.stringify(original[key]) !== JSON.stringify(editing[key]));
  const remove = async () => {
    if (!editing?.id || saving) return;
    setSaving(true); setError('');
    try { await request(`/api/notes/${editing.id}`, { method: 'DELETE' }); await load(); setEditing(null); setConfirmDelete(false); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  };
  const downloadPackage = async () => {
    if (!editing?.id || packageBusy || hasEdits) return;
    setPackageBusy(true); setError('');
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(editing.id)}/zip`);
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `下载失败（${response.status}）`);
      downloadBlob(await response.blob(), `${(editing.title || '未命名笔记').replace(/[\\/:*?"<>|]/g, '_')}.zip`);
    } catch (e) { setError(e.message); } finally { setPackageBusy(false); }
  };
  return <div className="knowledge-page">
    <aside className="knowledge-sidebar" aria-label="知识库分类">
      <div className="knowledge-sidebar-title"><span>灵感库</span><button className="icon-button" aria-label="新建笔记" onClick={newNote}><Plus size={16} /></button></div>
      <button className="knowledge-nav" onClick={onAssets}><Layers3 size={18} />内容资产</button>
      <div className="knowledge-mine"><button className="icon-button" aria-label={expanded ? '收起我的' : '展开我的'} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button><button onClick={() => { setType('全部'); setTag(null); setQuery(''); }}><Library size={18} />我的<span className="count">{notes.length}</span></button></div>
      {expanded && <div className="source-folders"><button className={type === '文档' ? 'selected' : ''} onClick={() => setType(type === '文档' ? '全部' : '文档')}><Folder size={17} />我的笔记<span>{notes.filter((n) => noteType(n) === '文档').length}</span></button><button className={type === '选题' ? 'selected' : ''} onClick={() => setType(type === '选题' ? '全部' : '选题')}><Folder size={17} />选题池<span>{notes.filter((n) => noteType(n) === '选题').length}</span></button></div>}
      <button className="knowledge-nav subscription" onClick={() => setSourcesOpen(!sourcesOpen)} aria-expanded={sourcesOpen}><ChevronRight size={15} /><Rss size={18} />订阅</button>
      {sourcesOpen && <p className="sidebar-empty">尚未接入订阅源</p>}
      <div className="tags-heading">标签 <Tag size={14} /></div>
      <div className="knowledge-tags">
        <button className={!tag ? 'selected' : ''} onClick={() => setTag(null)}><Tag size={15} />全部标签</button>
        <button className={tag === '__none' ? 'selected' : ''} onClick={() => setTag('__none')}><span>∅</span>无标签<small>{notes.filter((n) => !n.tags?.length).length}</small></button>
        {tags.map(([label, count]) => <button key={label} className={tag === label ? 'selected' : ''} onClick={() => setTag(label)}><span>#</span><span className="tag-name">{label}</span><small>{count}</small></button>)}
      </div>
    </aside>
    <div className="knowledge-main">
      {collectorOpen && <CollectorSetup onClose={() => setCollectorOpen(false)} />}
      {error && <p className="msg-error" role="alert">{error}</p>}
      {editing ? <div className="note-detail">
        <div className="note-detail-toolbar"><button className="text-button" disabled={saving} onClick={() => { setEditing(null); setConfirmDelete(false); }}><ArrowLeft size={17} />返回知识库</button><span />
          {editing.id && <button className="icon-button" aria-label="删除笔记" disabled={saving} onClick={() => setConfirmDelete(true)}><Trash2 size={17} /></button>}
          <button className="btn soft" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存笔记'}</button></div>
        {confirmDelete && <div className="delete-confirm" role="alert">删除后无法恢复这条笔记。<button className="btn" onClick={() => setConfirmDelete(false)}>取消</button><button className="btn danger" disabled={saving} onClick={remove}>确认删除</button></div>}
        <label className="field-label">标题<input className="note-title-input" autoFocus value={editing.title ?? ''} placeholder="未命名笔记" onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
        <label className="field-label">摘要<input className="input" placeholder="用一句话记录这篇内容" value={editing.summary ?? ''} onChange={(e) => setEditing({ ...editing, summary: e.target.value })} /></label>
        <label className="field-label">标签<input className="input" placeholder="多个标签用逗号分隔" value={Array.isArray(editing.tags) ? editing.tags.join(', ') : editing.tags ?? ''} onChange={(e) => setEditing({ ...editing, tags: e.target.value })} /></label>
        <label className="field-label">正文<textarea className="note-content" placeholder="记下想法，或粘贴需要整理的素材…" value={editing.content ?? ''} onChange={(e) => setEditing({ ...editing, content: e.target.value })} /></label>
        <div className="note-copy-actions"><CopyTextButton text={editing.content || ''} /></div>
        {editing.collector && <section className="collector-snapshot"><p>插件采集 · {editing.collector.author || '作者未识别'} · {new Date(editing.collector.capturedAt).toLocaleString('zh-CN')} · <a href={`https://www.xiaohongshu.com/explore/${editing.collector.noteId}`} target="_blank" rel="noreferrer">查看原文 ↗</a></p>
          <p>点赞 {editing.collector.stats?.likes ?? '未知'} · 收藏 {editing.collector.stats?.collects ?? '未知'} · 评论 {editing.collector.stats?.comments ?? '未知'}</p>
          <details><summary>最新采集快照（已加载评论 {editing.collector.comments?.length || 0} 条）</summary><h3>{editing.collector.title}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{editing.collector.body}</p>{editing.collector.comments?.map((c, i) => <p key={i}>{c.author || '匿名'}：{c.text}</p>)}{editing.collector.warnings?.map((w, i) => <p className="dim" key={i}>{w}</p>)}</details>
        </section>}
        {editing.images?.length > 0 && <div className="imported-note-images" aria-label="原始配图">{editing.images.filter((url) => url.startsWith('/imports/')).map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`原始配图 ${index + 1}`} loading="lazy" /></a>)}</div>}
        <div className="note-meta">{editing.createdAt && <span>创建于 {fmtTime(editing.createdAt)}</span>}<span>内容保存在本机</span>{editing.importInfo?.relativePath && <span>导入路径：{editing.importInfo.relativePath}</span>}</div>
        {editing.id && <div className="note-detail-actions">
          <button className="btn soft" disabled={saving || packageBusy || hasEdits} title={hasEdits ? '请先保存修改，再下载包含 Markdown 和原始配图的 ZIP' : '下载 Markdown 和原始配图'} onClick={downloadPackage}><Download size={15} />{packageBusy ? '正在打包…' : hasEdits ? '保存后下载包' : '下载笔记包'}</button>
          <button className="btn soft" disabled={saving || busy} title="只把文字快照发给 AI，不传原图、不生图；发布时仍会带上原图" onClick={() => hasEdits ? save({ rewriteCopy: true }) : onRewriteCopy(editing)}>{hasEdits ? '保存并只改文案' : 'AI 只改文案'} <ArrowUpRight size={15} /></button>
          <button className="btn soft note-compose" disabled={saving || busy} title="引用这篇笔记，使用知识库仿写技能，可按设置读取原图" onClick={() => hasEdits ? save({ compose: true }) : onCompose(editing)}>{hasEdits ? '保存并 AI 仿写' : 'AI 仿写'} <ArrowUpRight size={15} /></button>
        </div>}
      </div> : <>
        <div className="knowledge-type-tabs" role="tablist" aria-label="内容类型">{[...new Set([...types, ...(type !== '全部' && !types.includes(type) ? [type] : [])])].map((t) => <button key={t} role="tab" aria-selected={type === t} onClick={() => setType(t)}>{t}<span>{t === '全部' ? notes.length : notes.filter((n) => noteType(n) === t).length}</span></button>)}</div>
        <div className="knowledge-toolbar"><div className="knowledge-search"><Search size={16} /><input ref={inputRef} aria-label="搜索知识库内容" placeholder="搜索知识库…" value={query} onChange={(e) => setQuery(e.target.value)} />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14} /></button>}</div>
          <select className="sort-select" aria-label="排序" value={sort} onChange={(e) => setSort(e.target.value)}><option value="updatedAt">最近更新</option><option value="createdAt">创建时间</option></select>
          <button className="text-button" onClick={() => setImportOpen(true)}><Upload size={16} />导入文档</button>
          <button className="text-button" onClick={() => setCollectorOpen(!collectorOpen)}>采集插件</button>
          <button className="btn soft" onClick={newNote}><Plus size={16} />新建笔记</button>
        </div>
        <div className="knowledge-folders"><button onClick={() => setType(type === '文档' ? '全部' : '文档')}><span className="folder-art"><Folder size={64} strokeWidth={1.2} /></span><strong>我的笔记</strong></button><button onClick={() => setType(type === '选题' ? '全部' : '选题')}><span className="folder-art topic-folder"><Folder size={64} strokeWidth={1.2} /></span><strong>选题池</strong></button></div>
        {loading ? <div className="empty-state">正在读取知识库…</div> : filtered.length ? <div className="knowledge-grid">{filtered.map((n) => <button key={n.id} className="knowledge-card" onClick={() => { setEditing({ ...n }); setConfirmDelete(false); }}><div className={`note-preview ${n.cover?.startsWith('/imports/') ? 'has-cover' : ''}`}>{n.cover?.startsWith('/imports/') && <img className="note-cover" src={n.cover} alt="" loading="lazy" />}<span className="note-kind"><FileText size={12} />{noteType(n)}</span><h3>{n.title || '未命名笔记'}</h3><p>{n.summary || n.content?.slice(0, 240) || '尚未添加正文'}</p><div className="preview-lines"><i /><i /><i /></div></div><div className="note-card-caption"><strong>{n.title || '未命名笔记'}</strong><span><Clock3 size={11} />{fmtTime(n.updatedAt)}{n.tags?.length > 0 && <small>#{n.tags[0]}</small>}</span></div></button>)}</div>
          : <div className="empty-state"><FileText size={32} strokeWidth={1.3} /><h3>{notes.length ? '没有找到匹配的内容' : '收藏灵感，让创作有据可循'}</h3><p>{notes.length ? '试试其他关键词、标签或内容类型' : '新建笔记，或导入 Markdown / TXT 文档'}</p>{!notes.length && <button className="btn soft" onClick={newNote}>新建第一篇笔记</button>}</div>}
      </>}
      {importOpen && <DocumentImporter onClose={() => setImportOpen(false)} onImported={load} />}
    </div>
  </div>;
}
