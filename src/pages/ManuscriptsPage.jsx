import React, { useEffect, useState } from 'react';
import { request, writeJson } from '../api.js';
import { downloadBlob } from '../publish-download.js';

// Clipboard image write is only guaranteed for PNG; convert other formats.
async function toPng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('图片转换失败'))), 'image/png'));
}

export default function ManuscriptsPage({ active, openRequest }) {
  const [pending, setPending] = useState(null);
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [versions, setVersions] = useState(null);
  const [version, setVersion] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  useEffect(() => { setVersions(null); setVersion(null); }, [draft?.id, draft?.revision]);
  useEffect(() => { if (active) request('/api/manuscripts').then(d => setItems(d.manuscripts)).catch(e => setError(e.message)); }, [active, openRequest]);
  useEffect(() => {
    if (!openRequest) return;
    if (dirty) setPending(openRequest.draft);
    else { setDraft(openRequest.draft); setPending(null); setQuery(''); setNotice('已打开对话稿件'); }
  }, [openRequest]);
  useEffect(() => {
    const handler = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const select = item => {
    if (dirty && !window.confirm('当前稿件尚未保存，放弃修改？')) return;
    setDraft(item); setPending(null); setDirty(false); setNotice(''); setError('');
  };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const saved = await request(draft.id ? `/api/manuscripts/${draft.id}` : '/api/manuscripts', writeJson(draft.id ? 'PATCH' : 'POST', { title: draft.title.trim() || '未命名稿件', content: draft.content, revision: draft.revision }));
      setItems(prev => [saved, ...prev.filter(i => i.id !== saved.id)]); setDraft(saved); setDirty(false); setNotice('已保存到本地');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const loadVersions = async () => {
    setBusy(true); setError('');
    try { setVersions((await request(`/api/manuscripts/${draft.id}/versions`)).versions); setVersion(null); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const restore = async () => {
    setBusy(true); setError('');
    try {
      const saved = await request(`/api/manuscripts/${draft.id}/restore`, writeJson('POST', { versionId: version.revision, revision: draft.revision }));
      setItems(prev => [saved, ...prev.filter(i => i.id !== saved.id)]); setDraft(saved); setDirty(false); setNotice('已恢复历史版本，恢复前的内容也保留在版本历史中'); setVersions(null); setVersion(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const exportDraft = () => {
    const url = URL.createObjectURL(new Blob([`# ${draft.title}\n\n${draft.content}\n`], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(draft.title || '未命名稿件').replace(/[\\/:*?"<>|]/g, '_')}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const [copyFeedback, setCopyFeedback] = useState('');
  // Follow the order the draft itself mentions (e.g. a P1–P6 upload list),
  // so the preview matches the publishing instructions in the text.
  const images = [...(draft?.images ?? [])].sort((a, b) => {
    const order = url => { const at = draft.content.indexOf(url); return at === -1 ? Infinity : at; };
    return order(a) - order(b);
  });
  const copyText = async () => {
    try { await navigator.clipboard.writeText(draft.content); setCopyFeedback('文案已复制，去小红书正文框粘贴即可'); }
    catch { setError('复制失败，请在下方预览中手动选择文本'); }
  };
  const copyImage = async (url, index) => {
    try {
      const blob = await (await fetch(url)).blob();
      const payload = blob.type === 'image/png' ? blob : await toPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ [payload.type]: payload })]);
      setCopyFeedback(`第 ${index + 1} 张已复制，可直接粘贴到小红书上传框`);
    } catch { setError('复制图片失败，请点「原图」打开后拖拽或右键保存'); }
  };
  // One gesture, two effects: the publish tab must open inside the click, and
  // the clipboard write that follows stays within the same activation.
  const publishXhs = async () => {
    const win = window.open('https://creator.xiaohongshu.com/publish/publish', '_blank');
    if (win) win.opener = null;
    try {
      await navigator.clipboard.writeText(`${draft.title}\n\n${draft.content}`);
      setCopyFeedback(win ? '标题和正文已按发布格式复制，去小红书粘贴即可' : '标题和正文已复制；新窗口被浏览器拦截，请手动打开发布页');
    } catch { setError('复制失败，请用「复制文案」或手动复制标题与正文'); }
  };
  const downloadZip = async () => {
    setExportBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/manuscripts/${draft.id}/zip`);
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || `下载失败（${response.status}）`);
      downloadBlob(await response.blob(), `${(draft.title || '未命名稿件').replace(/[\\/:*?"<>|]/g, '_')}.zip`);
      setNotice('已下载稿件 ZIP 包（文案 + 配图）');
    } catch (e) { setError(e.message); } finally { setExportBusy(false); }
  };
  const revealFolder = async () => {
    setExportBusy(true); setError(''); setNotice('');
    try { setNotice(`已在 Finder 中打开：${(await request(`/api/manuscripts/${draft.id}/reveal`, { method: 'POST' })).folder}`); }
    catch (e) { setError(e.message); } finally { setExportBusy(false); }
  };
  return <div className="page-body manuscripts-page">
    <h2>稿件</h2>
    <p className="dim">整理、修改并保存你的创作内容</p>
    {error && <p role="alert">{error}</p>}
    {pending && <p role="status">当前编辑内容尚未保存。<button className="btn" disabled={busy} onClick={() => select(pending)}>打开来自对话的稿件</button></p>}
    <div className={`manuscripts-layout${draft ? ' with-preview' : ''}`}>
      <aside><button className="btn primary" disabled={busy} onClick={() => select({ title: '', content: '' })}>新建稿件</button>
        <input className="input" aria-label="搜索稿件" placeholder="搜索标题或正文…" value={query} onChange={e => setQuery(e.target.value)} />
        {items.filter(i => `${i.title} ${i.content}`.toLowerCase().includes(query.toLowerCase())).map(i => <button disabled={busy} className={`session-item ${draft?.id === i.id ? 'active' : ''}`} key={i.id} onClick={() => select(i)}>{i.title}</button>)}
        {!items.length && <p className="dim">暂无稿件，点击新建开始创作</p>}
      </aside>
      {draft ? <>
        <form onSubmit={save}>
          <label className="field-label">标题<input className="input" disabled={busy} value={draft.title} onChange={e => { setDraft({ ...draft, title: e.target.value }); setDirty(true); setNotice(''); }} /></label>
          <label className="field-label">正文<textarea className="note-content" disabled={busy} value={draft.content} onChange={e => { setDraft({ ...draft, content: e.target.value }); setDirty(true); setNotice(''); }} /></label>
          <div className="manuscript-actions"><button className="btn primary" disabled={busy}>{busy ? '保存中…' : '保存稿件'}</button><button type="button" className="btn" onClick={exportDraft}>导出 Markdown</button><span role="status">{dirty ? '有未保存修改' : notice}</span></div>
          {draft.id && <section className="app-card" style={{ marginTop: 20 }}><button type="button" className="btn" disabled={busy} onClick={loadVersions}>查看版本历史</button><p className="dim">每次保存修改都会保留上一版。恢复会生成新的当前版本，并保留恢复前的内容。</p>
            {versions && !versions.length && <p>暂无历史版本。下一次修改并保存后会出现。</p>}
            {versions?.map(v => <button type="button" className="btn soft" key={v.revision} disabled={busy} onClick={() => setVersion(v)}>{new Date(v.updatedAt).toLocaleString('zh-CN')} · {v.title}</button>)}
            {version && <div><h3>历史版本预览：{version.title}</h3><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{version.content}</pre><button type="button" className="btn" disabled={busy || dirty} onClick={restore}>恢复此版本</button>{dirty && <p>请先保存当前修改，再恢复历史版本。</p>}</div>}
          </section>}
        </form>
        <aside className="publish-rail" aria-label="发布预览">
          <section className="app-card publish-preview">
            <div className="publish-head"><h3>发布预览 · 小红书</h3><button type="button" className="btn soft" onClick={copyText}>复制文案</button></div>
            <div className="manuscript-actions" style={{ marginBottom: 12 }}>
              <button type="button" className="btn primary" disabled={exportBusy || !(draft.title || draft.content).trim()} onClick={publishXhs}>去发小红书</button>
              <button type="button" className="btn" disabled={exportBusy || !draft.id} title={!draft.id ? '先保存稿件，才能导出 ZIP 包' : '下载文案与配图的 ZIP 包'} onClick={downloadZip}>下载 ZIP 包</button>
              <button type="button" className="btn" disabled={exportBusy || !draft.id} title={!draft.id ? '先保存稿件，才能在 Finder 中打开' : '在 Finder 中打开导出的稿件文件夹'} onClick={revealFolder}>在 Finder 中打开</button>
              {!draft.id && <span className="dim">ZIP 与 Finder 导出需先保存稿件</span>}
            </div>
            <p className="dim">配图 {images.length} 张 · 正文 {draft.content.length} 字{copyFeedback ? ` · ${copyFeedback}` : ''}</p>
            <div className="publish-body"><h4>{draft.title || '未命名稿件'}</h4><p>{draft.content}</p></div>
            {images.length ? <div className="publish-images">{images.map((url, index) => <figure key={url}>
              <img src={url} alt={`配图 ${index + 1}`} loading="lazy" />
              <figcaption><button type="button" className="btn soft" onClick={() => copyImage(url, index)}>复制图片</button><a href={url} target="_blank" rel="noreferrer">原图 ↗</a></figcaption>
            </figure>)}</div> : <p className="dim">本稿暂无配图。从对话保存稿件时会带上该次会话的生成图；「只改文案」模式会改为带上知识库原图。</p>}
          </section>
        </aside>
      </> : <p className="empty-state">选择一篇稿件，或开始新建</p>}
    </div>
  </div>;
}
