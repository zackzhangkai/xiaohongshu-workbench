import React, { useEffect, useRef, useState } from 'react';
import SubtitleExport from '../components/SubtitleExport.jsx';
import { subtitleProject, encodeSubtitleProject } from '../subtitle-project.js';
import { parseSubtitles, validateCues, exportSubtitles, offsetCues } from '../subtitles.js';
const STORAGE = 'xhs-subtitle-editor-v1';
export default function SubtitlesPage({ active, openRequest, onTranscribe }) {
  const [pending, setPending] = useState(null);
  const handled = useRef(null);
  const [cues, setCues] = useState([]);
  const [name, setName] = useState('字幕');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offset, setOffset] = useState('0');
  const [media, setMedia] = useState(null);
  const [time, setTime] = useState(0);
  const [size, setSize] = useState(32);
  const [color, setColor] = useState('#ffffff');
  const [undo, setUndo] = useState([]);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const player = useRef(null);
  const mediaUrl = useRef(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) { const saved = subtitleProject(JSON.parse(raw), { legacy: true }); setCues(saved.cues); setName(saved.name); setSize(saved.fontSize); setColor(saved.color); setNotice('已恢复本浏览器保存的字幕草稿和样式，请重新选择视频'); }
    } catch { setError('保存的字幕草稿无法恢复；未覆盖原缓存，请先导入有效字幕'); }
    setReady(true);
    return () => { if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current); };
  }, []);
  useEffect(() => { if (!active) player.current?.pause(); }, [active]);
  const acceptRequest = request => {
    try {
      const incoming = validateCues(request.cues);
      player.current?.pause();
      if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
      mediaUrl.current = null; setMedia(null); setTime(0);
      setCues(incoming); setName(request.name.replace(/\.[^.]+$/, '')); setUndo([]); setDirty(true); setPending(null); setError('');
      if (request.project) { setName(request.name); setSize(request.fontSize); setColor(request.color); }
      setNotice(`已载入${request.project ? '字幕工程和样式' : '转写字幕'}，请选择对应原视频。原有本地草稿在点击保存前不会覆盖。`);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => {
    if (!ready || !openRequest || handled.current === openRequest.key) return;
    handled.current = openRequest.key;
    if (cues.length || dirty) setPending(openRequest);
    else acceptRequest(openRequest);
  }, [openRequest, ready]);
  useEffect(() => {
    const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = next => { setDirty(true); setUndo(old => [...old.slice(-19), cues]); setCues(next); setNotice('有未保存修改'); setError(''); };
  const load = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (!/\.(srt|vtt)$/i.test(file.name) || file.size > 2000000) throw new Error('请选择 2MB 以内的 UTF-8 SRT/VTT 文件');
      const parsed = parseSubtitles(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()));
      change(parsed.cues); setName(file.name.replace(/\.[^.]+$/, ''));
      setNotice(`已导入 ${parsed.cues.length} 条字幕。${parsed.warnings ? '源文件的样式、位置或注释未保留。' : ''}`);
    } catch (e) { setError(e.message); }
  };
  const chooseMedia = event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (mediaUrl.current) URL.revokeObjectURL(mediaUrl.current);
    mediaUrl.current = URL.createObjectURL(file); setMedia({ url: mediaUrl.current, name: file.name, file }); setTime(0); setError('');
  };
  const save = () => {
    try { localStorage.setItem(STORAGE, encodeSubtitleProject({ name, cues, fontSize: size, color })); setDirty(false); setNotice('字幕草稿和样式已保存在本浏览器'); setError(''); }
    catch (e) { setError(e.message); }
  };
  const download = format => {
    try {
      const output = format === 'subtitle-project.json' ? encodeSubtitleProject({ name, cues, fontSize: size, color }) : exportSubtitles(cues, format);
      const url = URL.createObjectURL(new Blob([output], { type: format === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = `${name.replace(/[\\/:*?"<>|]/g, '_')}.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setError('');
    } catch (e) { setError(e.message); }
  };
  const loadProject = async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > 20000000) throw new Error('请选择 20MB 以内的字幕工程');
      const project = { ...subtitleProject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()))), project: true };
      if (cues.length || dirty) setPending(project); else acceptRequest(project);
    } catch (e) { setError(`工程读取失败：${e.message}`); }
  };
  const current = cues.filter(c => Number(c.start) <= time && Number(c.end) > time);
  return <div className="page-body subtitle-page"><h2>字幕编辑工作台</h2>
    <p className="dim">导入 SRT/VTT 或本地自动转写结果，配合原视频修改字幕并导出。预览在浏览器内完成；烧录成片仅在本机服务处理。</p>
    <button className="btn soft" onClick={onTranscribe}>音视频自动转写</button>
    {pending && <section role="alert" className="app-card"><p>编辑器中已有字幕{dirty ? '，包含未保存修改' : ''}。载入「{pending.name}」会替换当前编辑内容。可先保存或导出现有字幕，再载入。</p><button className="btn" onClick={() => setPending(null)}>保留当前字幕</button><button className="btn soft" onClick={() => acceptRequest(pending)}>{pending.project ? '载入字幕工程' : '载入转写字幕'}</button></section>}
    <div className="subtitle-controls"><label>打开字幕工程<input type="file" accept=".json" aria-label="打开字幕工程" onChange={loadProject} /></label><button className="btn" onClick={() => download('subtitle-project.json')}>导出字幕工程</button></div>
    <p className="dim">工程文件包含字幕、时间轴、字号和颜色，不包含原视频；换设备后需重新选择原视频。</p>
    <div className="subtitle-controls"><label>导入字幕<input type="file" accept=".srt,.vtt" onChange={load} aria-label="导入字幕文件" /></label><label>选择预览视频<input type="file" accept="video/*,audio/*" onChange={chooseMedia} aria-label="选择预览视频" /></label></div>
    {error && <p role="alert">{error}</p>}<p role="status">{notice}</p>
    <div className="subtitle-workspace"><section className="subtitle-preview">
      {media ? <><div className="subtitle-video"><video ref={player} src={media.url} controls onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onSeeked={e => setTime(e.currentTarget.currentTime)} onError={() => setError('浏览器无法解码此媒体，请选择兼容的 MP4/WebM 或音频文件')} /><div className="subtitle-overlay" style={{ fontSize: size, color }}>{current.map((c, i) => <span key={i}>{c.text}</span>)}</div></div><p>{media.name} · {time.toFixed(3)} 秒</p></> : <p className="empty-state">选择视频后可同步预览字幕</p>}
      <div className="subtitle-controls"><label>预览字号<select value={size} onChange={e => { setSize(Number(e.target.value)); setDirty(true); setNotice('有未保存样式修改'); }}>{[24, 32, 40, 48].map(v => <option key={v}>{v}</option>)}</select></label><label>预览文字颜色<input type="color" value={color} onChange={e => { setColor(e.target.value); setDirty(true); setNotice('有未保存样式修改'); }} /></label></div>
      <p className="dim">预览样式不写入 SRT/VTT；字幕文本中的标记按原文显示。</p>
      <label className="field-label">导出名称<input className="input" value={name} maxLength={100} onChange={e => { setName(e.target.value); setDirty(true); }} /></label>
      <div className="manuscript-actions"><button className="btn" disabled={!ready} onClick={save}>保存字幕草稿</button>{['srt', 'vtt', 'txt'].map(format => <button className="btn" key={format} onClick={() => download(format)}>导出 {format.toUpperCase()}</button>)}</div>
      <div className="subtitle-controls"><label>整体偏移（秒）<input type="number" step="0.001" value={offset} onChange={e => setOffset(e.target.value)} /></label><button className="btn" onClick={() => { try { change(offsetCues(cues, offset)); } catch (e) { setError(e.message); } }}>应用偏移</button></div>
    <SubtitleExport file={media?.file} cues={cues} fontSize={size} color={color} active={active} /></section><section className="subtitle-editor"><div className="manuscript-actions"><strong>{cues.length} 条字幕</strong><button className="btn" disabled={cues.length >= 2000} onClick={() => change([...cues, { start: Number(time.toFixed(3)), end: Number((time + 2).toFixed(3)), text: '新字幕' }])}>在播放位置添加</button><button className="btn" disabled={!undo.length} onClick={() => { setCues(undo.at(-1)); setUndo(old => old.slice(0, -1)); setDirty(true); setNotice('已撤销修改'); }}>撤销</button></div>
      {cues.map((cue, index) => <article className={`subtitle-cue ${Number(cue.start) <= time && Number(cue.end) > time ? 'playing' : ''}`} key={index}>
        <div className="subtitle-controls"><button className="btn" disabled={!media} onClick={() => { if (Number.isFinite(Number(cue.start))) { player.current.currentTime = Number(cue.start); setTime(Number(cue.start)); } }}>定位 {index + 1}</button>
          <label>开始（秒）<input aria-label={`第${index + 1}条开始时间`} type="number" min="0" step="0.001" value={cue.start} onChange={e => change(cues.map((c, i) => i === index ? { ...c, start: e.target.value } : c))} /></label>
          <label>结束（秒）<input aria-label={`第${index + 1}条结束时间`} type="number" min="0" step="0.001" value={cue.end} onChange={e => change(cues.map((c, i) => i === index ? { ...c, end: e.target.value } : c))} /></label>
          <button className="btn" onClick={() => change(cues.filter((_, i) => i !== index))}>移除 {index + 1}</button></div>
        <textarea className="input" aria-label={`第${index + 1}条字幕正文`} rows={2} maxLength={10000} value={cue.text} onChange={e => change(cues.map((c, i) => i === index ? { ...c, text: e.target.value } : c))} />
      </article>)}
    </section></div>
  </div>;
}
