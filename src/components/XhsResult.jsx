import React, { useEffect, useRef, useState } from 'react';
import PostCopyPanel from './PostCopyPanel.jsx';
import { publishUrl } from '../xhs-result.js';
import '../publish.css';

export function ResultImage({ url, title, className }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return failed ? <div className="xhs-image-missing" role="status">图片无法读取，请检查本地素材</div> : <img className={className} src={url} alt={title} onError={() => setFailed(true)} />;
}
export default function XhsResult({ result, sessionId }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0);
  const dialog = useRef(null), trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; dialog.current?.focus();
    return () => { document.body.style.overflow = previousOverflow; trigger.current?.focus(); };
  }, [open]);
  const onKeyDown = (event) => {
    if (event.key === 'Escape') setOpen(false);
    if (event.key === 'ArrowRight') setPage(p => Math.min(result.images.length - 1, p + 1));
    if (event.key === 'ArrowLeft') setPage(p => Math.max(0, p - 1));
    if (event.key === 'Tab') {
      const nodes = [...dialog.current.querySelectorAll('button:not(:disabled),a[href]')];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  return <>
    <button ref={trigger} type="button" className="xhs-result-card" onClick={() => { setPage(0); setOpen(true); }} aria-label={`预览小红书笔记：${result.title}`}>
      <div className="xhs-result-cover">{result.images.length ? <><ResultImage url={result.images[0]} title={result.title} /><span className="xhs-count">1/{result.images.length}</span></> : <div className="xhs-image-missing">文案预览 · 暂无图片</div>}</div>
      <strong>{result.title}</strong><span>{result.incomplete ? '已生成素材 · 文案待完成 · 点击预览' : '小红书笔记 · 点击预览'}</span>
    </button>
    {open && <div className="xhs-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <section className="xhs-modal" ref={dialog} role="dialog" aria-modal="true" aria-label="小红书笔记预览" tabIndex={-1} onKeyDown={onKeyDown}>
        <header><span>小红书笔记预览</span><a className="xhs-primary" href={publishUrl(sessionId, result.messageIndex)} target="_blank" rel="noopener noreferrer">去发布 ↗</a><button aria-label="关闭预览" onClick={() => setOpen(false)}>×</button></header>
        <div className="xhs-preview-content">
          {result.images.length > 0 ? <div className="xhs-carousel"><ResultImage url={result.images[page]} title={`第 ${page + 1} 张图片`} /><div className="xhs-carousel-controls"><button aria-label="上一张" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button><span>{page + 1}/{result.images.length}</span><button aria-label="下一张" disabled={page === result.images.length - 1} onClick={() => setPage(page + 1)}>›</button></div></div> : <p className="xhs-empty">暂无已生成图片，可以先复制文案。</p>}
          <div><PostCopyPanel result={result} /><p className="xhs-muted">去发布将打开素材页，由你下载素材并手动发布。</p></div>
        </div>
      </section>
    </div>}
  </>;
}
