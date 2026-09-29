import React, { useEffect, useState } from 'react';
import { Pencil, Sparkles, BookOpenText, Image as ImageIcon } from 'lucide-react';

/** 自由创作：技能入口卡片，点击直达带技能的新对话 */
export default function StudioPage({ onOpenChat, onNavigate }) {
  const [skills, setSkills] = useState([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    fetch('/api/skills').then((r) => r.json()).then((d) => setSkills(d.skills ?? []));
  }, []);

  const filtered = skills.filter(s => `${s.name} ${s.description} ${s.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const featured = filtered.filter((s) =>
    ['xiaohongshu-image-post', 'image-director', 'xiaohongshu-content-director', 'xhs-title'].includes(s.id),
  );
  const rest = filtered.filter((s) => !featured.includes(s));

  return (
    <div className="page-body">
      <button className="btn soft" onClick={() => onNavigate('transcription')}>音视频转文字</button>
      <button className="btn soft" onClick={() => onNavigate('subtitles')}>字幕编辑</button>
      <button className="btn soft" onClick={() => onNavigate('voice')}>本地配音</button>
      <button className="btn soft" onClick={() => onNavigate('profile')}>账号运营规划</button>
      <button className="btn soft" onClick={() => onNavigate('image-cleaner')}>图片去 AI 元数据</button>
      <div className="empty-state" style={{ padding: '12px 0 20px', color: 'rgb(var(--color-text-secondary))' }}>
        <Pencil size={22} style={{ opacity: 0.6 }} />
        <div style={{ fontSize: 14 }}>选择一个技能开始自由创作</div>
      </div>
      <input className="input" aria-label="搜索技能" placeholder="搜索技能名称或用途…" value={query} onChange={e => setQuery(e.target.value)} />
      {query && !filtered.length && <p className="dim">没有匹配的技能，请换个关键词。</p>}
      {[{ title: '常用', list: featured }, { title: '全部技能', list: rest }].map(({ title, list }) =>
        list.length > 0 && (
          <div key={title} style={{ marginBottom: 20 }}>
            <h3 style={{ fontSize: 13, color: 'rgb(var(--color-text-tertiary))', marginBottom: 10 }}>{title}</h3>
            <div className="card-grid">
              {list.map((s) => (
                <div key={s.id} className="app-card">
                  <h3>
                    <Sparkles size={13} style={{ marginRight: 5, verticalAlign: -2, color: 'rgb(var(--color-accent-primary))' }} />
                    {s.name}
                  </h3>
                  <div className="card-desc">{s.description}</div>
                  <div className="card-footer">
                    <button className="btn primary" onClick={() => onOpenChat(s.id)}>开始创作</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
      )}
      <div className="dim" style={{ fontSize: 12, display: 'flex', gap: 14 }}>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <BookOpenText size={12} /> 知识库中的笔记可作为创作素材
        </span>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <ImageIcon size={12} /> 生成的图片自动进入资产库
        </span>
      </div>
    </div>
  );
}
