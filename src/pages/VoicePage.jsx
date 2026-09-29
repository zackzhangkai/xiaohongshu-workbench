import React, { useEffect, useState } from 'react';
import { request, writeJson } from '../api.js';
export default function VoicePage() {
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState('');
  const [text, setText] = useState('');
  const [rate, setRate] = useState(180);
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    request('/api/voice/voices').then(data => { if (alive) { setVoices(data.voices); setVoice(data.voices.find(v => v.language === 'zh_CN')?.name || data.voices[0]?.name || ''); } }).catch(e => { if (alive) setError(e.message); });
    const refresh = async () => { try { const data = await request('/api/voice'); if (alive) setItems(data.items); } catch (e) { if (alive) setError(e.message); } };
    refresh(); const timer = setInterval(refresh, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const running = items.some(item => item.status === 'running');
  const generate = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const item = await request('/api/voice', writeJson('POST', { text, voice, rate }));
      setItems(old => [item, ...old.filter(i => i.id !== item.id)]); setNotice('任务已提交，完成后可试听和下载');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="page-body"><h2>配音工作台</h2><p className="dim">当前使用本机 macOS 系统语音生成 WAV。文案不发送到云端，不消耗模型额度；云端 AI 音色尚未接入。</p>
    {error && <p role="alert">{error}</p>}
    <form className="profile-form" onSubmit={generate}>
      <label className="field-label">配音文案<textarea className="input" rows={7} required maxLength={5000} value={text} onChange={e => setText(e.target.value)} /></label>
      <div className="manuscript-actions"><label className="field-label">音色<select className="input" value={voice} onChange={e => setVoice(e.target.value)}>{voices.map(v => <option key={v.name} value={v.name}>{v.name} · {v.language}</option>)}</select></label>
        <label className="field-label">语速<input className="input" type="number" min={80} max={350} required value={rate} onChange={e => setRate(Number(e.target.value))} /></label>
        <button className="btn primary" disabled={busy || running || !voice || !text.trim()}>{busy || running ? '正在生成…' : '生成本地配音'}</button></div><p role="status">{notice}</p>
    </form>
    <h3>生成记录</h3>{!items.length && <p className="dim">还没有生成配音</p>}
    {items.map(item => <article className="app-card voice-result" key={item.id}><p>{item.text}</p><p className="dim">{item.voice} · 语速 {item.rate} · {new Date(item.createdAt).toLocaleString()}</p>
      {item.status === 'running' && <p role="status">正在生成…</p>}{item.error && <p role="alert">{item.error}</p>}
      {item.status === 'completed' && <><audio controls preload="metadata" src={item.url} aria-label={`试听 ${item.text.slice(0, 30)}`} /><a className="btn" href={item.url} download={`配音-${item.id}.wav`}>下载 WAV</a></>}
      <button className="btn" onClick={() => { setText(item.text); setVoice(item.voice); setRate(item.rate); }}>复用文案与设置</button>
    </article>)}
  </div>;
}
