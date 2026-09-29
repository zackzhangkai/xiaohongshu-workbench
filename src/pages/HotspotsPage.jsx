import React, { useEffect, useState } from 'react';
import { request, writeJson } from '../api.js';

export default function HotspotsPage({ onCompose }) {
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [saved, setSaved] = useState({});
  useEffect(() => {
    request('/api/feeds').then(d => setSources(d.sources)).catch(e => setError(e.message));
  }, []);
  const refresh = async source => {
    setBusy(source.id); setError('');
    try {
      const result = await request(`/api/feeds/${source.id}/refresh`, writeJson('POST', {}));
      setSources(old => old.map(s => s.id === result.id ? result : s));
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const save = async (item, compose = false) => {
    setBusy(item.id); setError('');
    try {
      const note = await request(`/api/feeds/${item.id}/save`, writeJson('POST', {}));
      setSaved(old => ({ ...old, [item.id]: true }));
      if (compose) onCompose(note);
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const items = sources.filter(s => sourceId === 'all' || s.id === sourceId).flatMap(s => s.items)
    .filter(item => `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  return <div className="page-body hotspots-page">
    <h2>热点与资讯</h2><p className="dim">公开订阅源更新，按发布时间排列。内容为来源摘要，不代表平台热度排名。</p>
    {error && <p role="alert">{error}</p>}
    <div className="feed-sources">{sources.map(source => <section className="app-card" key={source.id}>
      <h3>{source.name}</h3><p className="dim">{source.fetchedAt ? `上次成功更新：${new Date(source.fetchedAt).toLocaleString()}` : '尚未获取'}</p>
      {source.error && <p role="alert">更新失败：{source.error}。{source.items.length ? '当前显示上次成功保存的内容。' : ''}</p>}
      <button className="btn" disabled={!!busy} onClick={() => refresh(source)}>{busy === source.id ? '正在更新…' : '更新来源'}</button>
    </section>)}</div>
    <div className="feed-toolbar"><label>资讯来源<select className="input" value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="all">全部来源</option>{sources.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
      <label>搜索资讯<input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="输入关键词…" /></label><span>{items.length} 条</span></div>
    {!items.length && <p className="empty-state">暂无匹配资讯，点击“更新来源”获取内容</p>}
    {items.map(item => <article className="app-card feed-item" key={item.id}>
      <p className="dim">{item.sourceName} · {Number.isFinite(Date.parse(item.publishedAt)) ? new Date(item.publishedAt).toLocaleString() : '未提供发布时间'}</p>
      <h3><a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a></h3>
      <p className="feed-summary">{item.summary}</p>
      <div className="manuscript-actions"><a href={item.url} target="_blank" rel="noopener noreferrer">阅读原文</a>
        <button className="btn" disabled={!!busy || saved[item.id]} onClick={() => save(item)}>{saved[item.id] ? '已保存到知识库' : '保存到知识库'}</button>
        <button className="btn primary" disabled={!!busy} onClick={() => save(item, true)}>基于资讯创作</button></div>
    </article>)}
  </div>;
}
