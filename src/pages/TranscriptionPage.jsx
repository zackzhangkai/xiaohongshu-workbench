import React, { useEffect, useState } from 'react';
import { request, writeJson } from '../api.js';
import { exportSubtitles } from '../subtitles.js';
export default function TranscriptionPage({ onEdit }) {
  const [items, setItems] = useState([]), [ready, setReady] = useState(false), [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const load = async () => { const data = await request('/api/transcriptions'); setItems(data.items); setReady(data.ready); };
  useEffect(() => { let stopped = false; const refresh = async () => { try { const d = await request('/api/transcriptions'); if (!stopped) { setItems(d.items); setReady(d.ready); } } catch (e) { if (!stopped) setError(e.message); } }; refresh(); const timer = setInterval(refresh, 3000); return () => { stopped = true; clearInterval(timer); }; }, []);
  const running = items.some(i => ['preparing', 'running'].includes(i.status));
  const start = async () => {
    if (!file) return; setError(''); setMessage('');
    if (file.size > 100 * 1024 * 1024) return setError('文件不能超过 100MB');
    setBusy(true);
    try { await request(`/api/transcriptions?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const download = (item, format) => {
    try {
      const content = format === 'txt' ? item.text : exportSubtitles(item.segments, format);
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `${item.name.replace(/\.[^.]+$/, '')}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
  };
  return <div className="page-body"><h2>音视频转文字</h2>
    <p className="dim">使用本机 Whisper 模型识别语音，保留分段和逐词时间戳。文件复制到本机工作台，不上传云端，不改动原文件。</p>
    <p className="dim">支持 MP4、MOV、WebM、WAV、MP3、M4A、FLAC、OGG，最多 100MB / 30 分钟。自动识别语言；识别结果请人工校对。视频文案提取仅识别声音，不识别画面中的文字。</p>
    {!ready && <p role="status">未检测到本地运行环境或模型，不会自动安装或下载。</p>}
    <input aria-label="选择转写音视频" type="file" accept=".mp4,.mov,.webm,.wav,.mp3,.m4a,.flac,.ogg" onChange={e => setFile(e.target.files?.[0] || null)} />
    <button className="btn primary" disabled={!file || !ready || busy || running} onClick={start}>{busy ? '正在传给本机服务…' : '开始本地转写'}</button>
    {error && <p role="alert" className="msg-error">{error}</p>}{message && <p role="status">{message}</p>}
    <h3>转写记录</h3>{!items.length && <p className="dim">转写完成后，可下载文字和字幕，或存入知识库。</p>}
    {items.map(item => <section className="app-card" key={item.id} style={{ marginBottom: 16 }}><h3>{item.name}</h3>
      <p>{({ preparing: '正在提取音轨…', running: 'Whisper 正在本机识别，请耐心等待…', completed: '转写完成', failed: '转写失败' })[item.status]}{item.duration ? ` · ${item.duration.toFixed(1)} 秒` : ''}</p>
      {item.error && <p role="alert">{item.error}</p>}
      {item.status === 'completed' && <><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{item.text || '没有识别到语音文字'}</pre>
        {['txt', 'srt', 'vtt'].map(format => <button className="btn soft" key={format} disabled={!item.text || (format !== 'txt' && !item.segments?.length)} onClick={() => download(item, format)}>下载 {format.toUpperCase()}</button>)}
        <button className="btn soft" disabled={!item.text} onClick={async () => { try { await request(`/api/transcriptions/${item.id}/save`, writeJson('POST', {})); setMessage('已存入知识库，重复保存不会新增副本'); } catch (e) { setError(e.message); } }}>存入知识库</button>
        <button className="btn soft" disabled={!item.segments?.length} onClick={() => onEdit(item)}>编辑字幕</button>
        <p className="dim">可直接进入字幕编辑器校对，重新选择原视频后可预览和烧录。</p></>}
    </section>)}
  </div>;
}
