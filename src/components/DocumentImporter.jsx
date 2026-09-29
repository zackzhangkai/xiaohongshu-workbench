import React, { useRef, useState } from 'react';
import { request, writeJson } from '../api.js';

const excluded = new Set(['node_modules', 'dist', 'build', 'logs', 'cache', '__pycache__']);
export default function DocumentImporter({ onClose, onImported }) {
  const fileRef = useRef(null), folderRef = useRef(null);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ignored, setIgnored] = useState(0);
  const [done, setDone] = useState(false);
  const choose = async event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length) return;
    setError(''); setDone(false);
    const supported = files.filter(file => /\.(md|markdown|txt)$/i.test(file.name) &&
      !(file.webkitRelativePath || file.name).split('/').some(segment => segment.startsWith('.') || excluded.has(segment)));
    setIgnored(files.length - supported.length); setEntries([]);
    if (supported.length > 200) { setError('每批最多 200 份文档，请选择更小的子文件夹'); return; }
    if (supported.reduce((sum, f) => sum + f.size, 0) > 20000000) { setError('每批文件总大小不能超过 20MB'); return; }
    setBusy(true);
    const next = [];
    for (const file of supported) {
      const relativePath = file.webkitRelativePath || file.name;
      try {
        if (file.size > 500000) throw new Error('超过 500KB');
        const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        if (content.includes('\0')) throw new Error('不是有效文本文件');
        next.push({ relativePath, content, size: file.size, status: 'ready' });
      } catch (e) { next.push({ relativePath, size: file.size, status: 'failed', error: e.message }); }
    }
    setEntries(next); setBusy(false);
  };
  const run = async () => {
    setBusy(true); setError('');
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (entry.status !== 'ready') continue;
      try {
        const result = await request('/api/notes/import-document', writeJson('POST', { relativePath: entry.relativePath, content: entry.content }));
        setEntries(old => old.map((item, i) => i === index ? { ...item, status: result.status } : item));
      } catch (e) { setEntries(old => old.map((item, i) => i === index ? { ...item, status: 'retry', error: e.message } : item)); }
    }
    setBusy(false); setDone(true);
    try { await onImported(); } catch (e) { setError(`导入记录已写入，但刷新列表失败：${e.message}`); }
  };
  const counts = status => entries.filter(e => e.status === status).length;
  const labels = { ready: '待导入', imported: '已导入', duplicate: '已存在，跳过', failed: '无法读取', retry: '导入失败' };
  return <div className="modal-backdrop"><section className="document-import-dialog" role="dialog" aria-modal="true" aria-label="导入本地文档">
    <h2>导入本地文档</h2>
    <p>选择 Markdown / TXT 文件，或包含文档的文件夹（包括 Obsidian Vault）。仅复制文字到本机知识库，原文件不变。</p>
    <p className="dim">每批最多 200 份、总计 20MB，单份不超过 500KB。忽略隐藏目录、依赖、构建输出及附件；不自动同步文件变化。相同路径和内容重复导入会跳过，内容变化会另存新笔记，保留已有编辑。</p>
    <div className="manuscript-actions"><button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>选择文档</button><button className="btn" disabled={busy} onClick={() => folderRef.current?.click()}>选择文件夹 / Obsidian</button></div>
    <input aria-label="选择导入文档" ref={fileRef} type="file" multiple accept=".md,.markdown,.txt" hidden onChange={choose} />
    <input aria-label="选择导入文件夹" ref={folderRef} type="file" webkitdirectory="" multiple hidden onChange={choose} />
    {error && <p role="alert">{error}</p>}
    <p role="status">{busy ? '正在处理… ' : done ? '本批处理完成。' : '选好文件后，点击开始导入。'}待导入 {counts('ready')} · 已导入 {counts('imported')} · 重复 {counts('duplicate')} · 失败 {counts('failed') + counts('retry')} · 忽略 {ignored}</p>
    <ul className="document-import-list">{entries.map((entry, index) => <li key={index}><span>{entry.relativePath}</span><small>{(entry.size / 1024).toFixed(1)}KB · {labels[entry.status]}{entry.error && `：${entry.error}`}</small></li>)}</ul>
    <div className="manuscript-actions"><button className="btn primary" disabled={busy || !counts('ready')} onClick={run}>开始导入</button>
      {counts('retry') > 0 && <button className="btn" disabled={busy} onClick={() => { setEntries(old => old.map(e => e.status === 'retry' ? { ...e, status: 'ready', error: '' } : e)); setDone(false); }}>准备重试失败文档</button>}
      <button className="btn" disabled={busy} onClick={onClose}>关闭</button></div>
  </section></div>;
}
