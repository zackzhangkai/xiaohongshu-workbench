import React, { useEffect, useRef, useState } from 'react';

export default function ImageCleanerPage() {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urls = useRef([]);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; urls.current.forEach(URL.revokeObjectURL); urls.current = []; };
  }, []);
  const process = async files => {
    if (busy) return;
    setError('');
    if (files.length > 20) { setError('每批最多处理 20 张图片'); return; }
    setBusy(true);
    urls.current.forEach(URL.revokeObjectURL); urls.current = []; setItems([]);
    for (const file of files) {
      if (!active.current) break;
      let bitmap;
      try {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('支持 PNG、JPEG 和 WebP');
        if (file.size > 30 * 1024 * 1024) throw new Error('单张图片不能超过 30MB');
        bitmap = await createImageBitmap(file);
        if (bitmap.width * bitmap.height > 40000000) throw new Error('图片不能超过 4000 万像素');
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('浏览器无法创建图片画布');
        ctx.drawImage(bitmap, 0, 0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        canvas.width = 0; canvas.height = 0;
        if (!blob) throw new Error('图片导出失败');
        if (!active.current) break;
        const url = URL.createObjectURL(blob); urls.current.push(url);
        const width = bitmap.width, height = bitmap.height;
        setItems(old => [...old, { name: file.name, downloadName: `${file.name.replace(/\.[^.]+$/, '')}-clean.png`, url, width, height, before: file.size, after: blob.size }]);
      } catch (e) {
        if (active.current) setItems(old => [...old, { name: file.name, error: e.message || '无法解码图片' }]);
      } finally { bitmap?.close(); }
    }
    if (active.current) setBusy(false);
  };
  return <div className="page-body image-cleaner-page">
    <h2>图片去 AI 元数据</h2>
    <p className="dim">在浏览器本地重新编码图片，移除原文件中的提示词、EXIF 和文本元数据。原文件保持不变，图片不会上传。</p>
    <p className="dim">输出静态 PNG，保留透明区域。动图仅输出首帧；色彩可能受浏览器色彩转换影响，文件体积可能增加。不去除画面上的水印，也不保证规避平台 AI 检测。</p>
    <label className="image-cleaner-picker">{busy ? '正在本地处理…' : '选择图片（可多选）'}
      <input aria-label="选择待清理图片" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={e => { process(Array.from(e.target.files || [])); e.target.value = ''; }} />
    </label>
    <p className="dim">每批最多 20 张，单张不超过 30MB、4000 万像素</p>
    {error && <p role="alert">{error}</p>}
    <div role="status">{items.length > 0 && `已处理 ${items.length} 张，成功 ${items.filter(i => i.url).length} 张`}</div>
    <div className="cleaner-grid">{items.map((item, i) => <article className="app-card" key={i}>
      <h3>{item.name}</h3>
      {item.error ? <p role="alert">{item.error}</p> : <><img src={item.url} alt={`清理后：${item.name}`} />
        <p>{item.width} × {item.height} · {(item.before / 1024).toFixed(1)}KB → {(item.after / 1024).toFixed(1)}KB</p>
        <a className="btn primary" href={item.url} download={item.downloadName}>下载清理后的 PNG</a></>}
    </article>)}</div>
  </div>;
}
