import React, { useEffect, useState } from 'react';
import { request, writeJson } from '../api.js';
import { validateCues } from '../subtitles.js';

export default function SubtitleExport({ file, cues, fontSize, color, active }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!active) return;
    let alive = true, fetching = false;
    const refresh = async () => {
      if (fetching) return; fetching = true;
      try { const data = await request('/api/renders'); if (alive) setItems(data.items); }
      catch (e) { if (alive) setError(e.message); } finally { fetching = false; }
    };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [active]);
  const render = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      if (!file) throw new Error('请先选择预览视频');
      if (file.size > 100 * 1024 * 1024) throw new Error('烧录导出支持 100MB 以内的视频');
      const valid = validateCues(cues);
      if (!valid.length || valid.length > 500) throw new Error('烧录导出支持 1 至 500 条字幕');
      setNotice('正在复制视频到本机服务…');
      const uploaded = await request('/api/renders/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const task = await request(`/api/renders/${uploaded.id}/start`, writeJson('POST', { cues: valid, fontSize, color }));
      setItems(old => [task, ...old.filter(i => i.id !== task.id)]); setNotice('导出已开始，可切换页面，稍后回来查看结果');
    } catch (e) { setError(e.message); setNotice(''); } finally { setBusy(false); }
  };
  return <section className="subtitle-export"><h3>烧录字幕导出 MP4</h3>
    <p className="dim">点击后将视频复制到本机服务，由本地 FFmpeg 处理。原文件不变，不上传云端。支持 MP4/MOV/WebM，100MB、10分钟、宽高各1920像素以内，最多500条字幕。文字和当前字号、颜色会写入画面，字号按画面宽度缩放。</p>
    <button className="btn primary" disabled={busy || items.some(i => i.status === 'running') || !file} onClick={render}>{busy ? '正在提交…' : '导出带字幕视频'}</button>
    {error && <p role="alert">{error}</p>}<p role="status">{notice}</p>
    {items.filter(i => i.status !== 'uploaded').map(item => <article className="subtitle-render-item" key={item.id}>
      <p>{new Date(item.createdAt).toLocaleString()} · {item.width}×{item.height} · {item.duration.toFixed(2)}秒</p>
      {item.status === 'running' && <p role="status">正在导出 {item.progress}%<progress max={100} value={item.progress} /></p>}
      {item.error && <p role="alert">{item.error}</p>}
      {item.status === 'completed' && <><video src={item.url} controls preload="metadata" aria-label="导出视频预览" /><a className="btn" download={`字幕成片-${item.id}.mp4`} href={item.url}>下载字幕成片</a></>}
    </article>)}
  </section>;
}
