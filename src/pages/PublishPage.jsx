import React, { useEffect, useState } from 'react';
import { request } from '../api.js';
import { getXhsResult } from '../xhs-result.js';
import { createZip, downloadBlob, imageBytes, imageName } from '../publish-download.js';
import PostCopyPanel from '../components/PostCopyPanel.jsx';
import { postCopyFields } from '../copy-body.js';
import { ResultImage } from '../components/XhsResult.jsx';
import '../publish.css';

export default function PublishPage({ sessionId, message }) {
  const [result, setResult] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setResult(null);
    if (!sessionId || !/^\d+$/.test(message || '')) { setLoading(false); setError('素材页地址无效，请从对话结果重新打开。'); return; }
    request(`/api/sessions/${encodeURIComponent(sessionId)}`).then(session => {
      const value = getXhsResult(session.messages || [], Number(message));
      if (!value) throw new Error('找不到这条小红书结果，请返回对话查看。');
      if (!cancelled) setResult(value);
    }).catch(e => { if (!cancelled) setError(`素材读取失败：${e.message}`); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, message, retry]);
  const text = postCopyFields(result).all;
  const download = async (url, index) => {
    setBusy(true); setError('');
    try { downloadBlob(new Blob([await imageBytes(url)]), imageName(url, index)); }
    catch (e) { setError(`第 ${index + 1} 张素材下载失败：${e.message}`); }
    finally { setBusy(false); }
  };
  const zip = async () => {
    setBusy(true); setError('');
    try {
      const entries = result.incomplete ? [] : [{ name: '文案.txt', bytes: new TextEncoder().encode(text) }];
      for (const [i, url] of result.images.entries()) {
        try { entries.push({ name: imageName(url, i), bytes: await imageBytes(url) }); }
        catch (e) { throw new Error(`第 ${i + 1} 张图片：${e.message}。未下载不完整素材包。`); }
      }
      downloadBlob(createZip(entries), '小红书素材包.zip');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <main className="xhs-publish">
    <header className="xhs-publish-heading"><p>小红书 · 手动发布素材包</p><h1>{result?.title || '发布素材'}</h1><p className="xhs-muted">下载图片与文案后，自行上传到小红书。此页不会自动发布。</p>
      {result && <div className="xhs-publish-actions"><button className="xhs-primary" disabled={busy} onClick={zip}>{busy ? '正在准备素材…' : result.incomplete ? '下载已生成素材包' : '下载完整素材包'}</button><button disabled={result.incomplete} onClick={() => downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), '文案.txt')}>下载文案</button><a href="https://creator.xiaohongshu.com/publish/publish" target="_blank" rel="noopener noreferrer">去小红书发布 ↗</a></div>}
    </header>
    {loading && <p role="status">正在读取素材…</p>}
    {error && <div className="xhs-publish-error" role="alert">{error}{!result && <button onClick={() => setRetry(n => n + 1)}>重试</button>}</div>}
    {result && <><section className="xhs-publish-panel"><h2>按编号上传素材</h2><p className="xhs-muted">按展示顺序逐张保存原图，或下载上方完整素材包。</p>
      {result.images.length ? <div className="xhs-assets">{result.images.map((url, i) => <article key={url}><ResultImage url={url} title={`第 ${i + 1} 张素材`} /><div><h3>{String(i + 1).padStart(2, '0')} {i === 0 ? '封面' : '正文图'}{url.startsWith('/imports/') ? ' · 原图' : ''}</h3><p>{imageName(url, i)}</p><button disabled={busy} onClick={() => download(url, i)}>保存原图</button></div></article>)}</div> : <p className="xhs-empty">本条结果暂无配图，素材包仅包含文案。</p>}
    </section><section className="xhs-publish-panel"><PostCopyPanel result={result} /></section></>}
  </main>;
}
