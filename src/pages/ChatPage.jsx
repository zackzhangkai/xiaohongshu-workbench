import React, { useEffect, useRef, useState } from 'react';
import { Plus, Sparkles, Image as ImageIcon, Wrench, X, ShieldCheck, ArrowUp, ArrowUpRight, LoaderCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { request, writeJson } from '../api.js';
import Markdown from '../components/Markdown.jsx';
import SaveManuscriptButton from '../components/SaveManuscriptButton.jsx';
import CopyTextButton from '../components/CopyTextButton.jsx';
import { extractPostBody } from '../copy-body.js';
import { getXhsResult } from '../xhs-result.js';
import XhsResult from '../components/XhsResult.jsx';

function ToolLine({ status }) {
  const { label, ok } = status;
  return (
    <div className={`msg-tool ${ok === true ? 'ok' : ok === false ? 'fail' : ''}`}>
      <Wrench size={13} />
      {label}
    </div>
  );
}

function ReferenceStatus({ status }) {
  if (!status) return null;
  return <details className="reference-image-status"><summary>参考图片 · {status.count ? `本轮附带 ${status.count} 张` : '本轮未附原图'} · {status.state === 'completed' ? '回复完成' : status.state === 'failed' ? '回复失败，未确认处理完成' : '等待回复完成'}</summary><p>{status.report}</p></details>;
}

/** 渲染历史消息：AI 全宽 markdown、用户气泡、工具行、图片 */
function HistoryMessage({ msg, sessionId, messageIndex, onOpenManuscript, result }) {
  if (msg.role === 'user') {
    return (
      <div className="msg-user-row">
        <div className="chat-user-bubble">{msg.context && <div className="message-citations">{msg.context.skillId && <span>@{msg.context.skillId}</span>}{msg.context.references?.map((n) => <span key={n.id}>#{n.title}</span>)}</div>}{msg.content}<ReferenceStatus status={msg.imageStatus} /></div>
      </div>
    );
  }
  if (msg.role === 'tool') {
    let parsed = {};
    try {
      parsed = JSON.parse(msg.content);
    } catch {
      /* ignore */
    }
    if (parsed.url) {
      return (
        <div className="msg-ai">
          <div className="msg-tool ok">
            <ImageIcon size={13} /> 已生成图片：{parsed.prompt?.slice(0, 70)}
            {parsed.prompt?.length > 70 ? '…' : ''}
          </div>
          <img className="gen-image" src={parsed.url} alt={parsed.prompt} loading="lazy" />
          {result && <XhsResult result={result} sessionId={sessionId} />}
        </div>
      );
    }
    return (
      <ToolLine
        status={{
          label: parsed.error ? `工具失败：${parsed.error}` : '工具调用完成',
          ok: !parsed.error,
        }}
      />
    );
  }
  if (msg.role === 'assistant') {
    const body = extractPostBody(msg.content);
    return (
      <div className="msg-ai">
        <div className="msg-ai-role">
          <Sparkles size={12} /> AI
          {msg.tool_calls?.length > 0 && <span className="dim">· 调用 {msg.tool_calls.map((c) => c.function?.name).join(', ')}</span>}
        </div>
        {msg.content ? <Markdown text={msg.content} /> : null}
        {result && <XhsResult result={result} sessionId={sessionId} />}
        {msg.content?.trim() && <div className="message-copy-actions">
          {body && <CopyTextButton text={body} title="复制正文和紧随其后的话题，不包含标题、配图说明" />}
          <CopyTextButton text={msg.content} label={body ? '复制整段回复' : '复制内容'} />
          <SaveManuscriptButton sessionId={sessionId} messageIndex={messageIndex} onOpen={onOpenManuscript} />
        </div>}
      </div>
    );
  }
  return null;
}

export default function ChatPage({ configVersion, chatRequest, onSessionCreated, onSessionsUpdated, onBusy, active, onOpenManuscript, onVoice }) {
  const [skills, setSkills] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [skillId, setSkillId] = useState('');
  const [references, setReferences] = useState([]);
  const [referenceMode, setReferenceMode] = useState('visual');
  const [rereadNoteIds, setRereadNoteIds] = useState([]);
  const [referenceStatus, setReferenceStatus] = useState(null);
  const [popover, setPopover] = useState(null);
  const [filter, setFilter] = useState('');
  const [notes, setNotes] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamImages, setStreamImages] = useState([]);
  const [toolStatus, setToolStatus] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState('');
  const [modelConfig, setModelConfig] = useState(null);
  const [modelSelections, setModelSelections] = useState({ chat: '', image: '' });
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const sendingRef = useRef(false);
  const currentKey = useRef(chatRequest.key);

  useEffect(() => {
    request('/api/skills').then((d) => setSkills(d.skills ?? [])).catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let cancelled = false;
    request('/api/config').then((d) => { if (!cancelled) { setModelConfig(d); setModelSelections({ chat: '', image: '' }); } }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [configVersion]);
  useEffect(() => { onBusy(streaming); }, [streaming, onBusy]);
  useEffect(() => {
    let cancelled = false;
    currentKey.current = chatRequest.key;
    setSessionId(chatRequest.id);
    setRereadNoteIds([]); setReferenceStatus(null);
    setSkillId(chatRequest.skillId || '');
    setReferences(chatRequest.references || []);
    setReferenceMode(chatRequest.referenceMode || 'visual');
    setInput(chatRequest.text || '');
    setError(''); setPopover(null); setMessages([]); setComposerCollapsed(false);
    setLoading(Boolean(chatRequest.id));
    if (chatRequest.id) request(`/api/sessions/${chatRequest.id}`).then((s) => {
      if (!cancelled) {
        setMessages(s.messages ?? []);
        setSkillId(s.context?.skillId || '');
        setReferences((s.context?.references || []).map(({ id, title }) => ({ id, title })));
        setReferenceMode(s.context?.referenceMode || 'visual');
      }
    }).catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [chatRequest.key]);
  useEffect(() => {
    if (active && messages.length) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamText, active]);

  const openNotes = async () => {
    setPopover('notes'); setFilter('');
    try { setNotes((await request('/api/notes')).notes ?? []); }
    catch (e) { setError(e.message); }
  };
  const send = async () => {
    if (!input.trim() || sendingRef.current || loading) return;
    sendingRef.current = true;
    setStreaming(true); setThinking(true); setError(''); setPopover(null);
    setStreamText(''); setStreamImages([]); setToolStatus(null); setReferenceStatus(null);
    const message = input.trim();
    const turnKey = currentKey.current;
    let id = sessionId;
    let accepted = false;
    try {
      if (!id) {
        const session = await request('/api/sessions', writeJson('POST', {}));
        id = session.id; setSessionId(id); onSessionCreated(id); onSessionsUpdated();
      }
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: message, context: { skillId, references } }]);
      const response = await fetch('/api/chat', writeJson('POST', { sessionId: id, message, skillId, referenceMode, modelSelections: Object.fromEntries(Object.entries(modelSelections).map(([scope, value]) => [scope, value ? JSON.parse(value) : null])), noteIds: references.map((n) => n.id), rereadNoteIds: referenceMode === 'text-only' ? [] : rereadNoteIds.filter(id => references.some(n => n.id === id)) }));
      if (!response.ok || !response.body) throw new Error((await response.text()) || `HTTP ${response.status}`);
      accepted = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminalEvent = false;
      const consumeLine = (line) => {
        if (!line.trim().startsWith('data:')) return;
        let ev; try { ev = JSON.parse(line.trim().slice(5).trim()); } catch { return; }
        if (ev.type === 'delta') { setThinking(false); setStreamText((v) => v + ev.text); }
        else if (ev.type === 'reference_status') setReferenceStatus(ev.status);
        else if (ev.type === 'image') setStreamImages((v) => [...v, ev]);
        else if (ev.type === 'tool_start') { setThinking(false); setToolStatus({ label: ev.name === 'image_generate' ? '正在生成图片…' : `调用 ${ev.name}…`, ok: null }); }
        else if (ev.type === 'tool_result') setToolStatus((v) => v && { ...v, ok: ev.ok });
        else if (ev.type === 'done') { terminalEvent = true; setRereadNoteIds([]); }
        else if (ev.type === 'error') { terminalEvent = true; setRereadNoteIds(rereadNoteIds); setThinking(false); setError(ev.message); }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) { buffer += decoder.decode(); if (buffer.trim()) consumeLine(buffer); break; }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        lines.forEach(consumeLine);
      }
      if (!terminalEvent) throw new Error('连接中断，未收到回复完成确认；重读选择已保留，请确认后重试。');
    } catch (e) {
      setRereadNoteIds(rereadNoteIds);
      setError(e.message);
      if (!accepted) setInput(message);
    } finally {
      try {
        if (id && currentKey.current === turnKey) {
          const saved = await request(`/api/sessions/${id}`);
          setMessages(saved.messages ?? []);
          setStreamText(''); setStreamImages([]);
        }
      } catch (e) { setError(`历史记录读取失败：${e.message}`); }
      setStreaming(false); setThinking(false); setToolStatus(null);
      sendingRef.current = false; onSessionsUpdated();
    }
  };
  const starters = [
    ['xhs-title', '小红书标题', '把内容亮点整理成清晰、有吸引力的标题'],
    ['writing-style', '打磨文字', '调整语气与表达，让文字更贴近你的风格'],
    ['wechat-article-rewriter', '文章改写', '根据已有内容重新组织文章结构与表达'],
    ['video-spoken-script-package', '口播文案', '把一个主题梳理成适合讲述的口播稿'],
    ['knowledge-content-imitation', '素材创作', '结合你提供的参考素材展开新的内容'],
    ['wechat-article-layout', '公众号排版', '整理文章层次与阅读节奏'],
  ].filter(([id]) => skills.some((s) => s.id === id));
  const selectedSkill = skills.find((s) => s.id === skillId);
  const empty = !messages.length && !streaming && !loading;
  const quickActions = [
    ['想选题', '请帮我梳理几个值得创作的选题方向。', ''],
    ['写小红书', '请帮我创作一篇小红书图文，主题是：', 'xiaohongshu-image-post'],
    ['写公众号', '请帮我写一篇公众号文章，主题是：', ''],
    ['写口播稿', '请帮我写一份口播稿，主题是：', ''],
    ['生图', '请帮我生成一张图片，画面内容是：', 'image-director'],
    ['做封面', '请帮我设计并生成封面，标题是：', 'image-director'],
  ];
  return <div className={`chat-page ${empty ? 'chat-welcome' : 'chat-conversation'}`}>
    <div className="chat-main">
      {empty && <div className="welcome-brand"><div><h1>小红书<span>工作台</span></h1></div><p>自媒体AI工作台</p></div>}
      {!empty && <div className="chat-messages" aria-live="polite"><div className="chat-messages-inner">
        {loading && <p className="dim">正在读取对话…</p>}
        {messages.map((m, i) => <HistoryMessage key={`${sessionId}:${i}`} msg={m} sessionId={sessionId} messageIndex={i} result={getXhsResult(messages, i)} onOpenManuscript={onOpenManuscript} />)}
        {streaming && <div className="msg-ai"><div className="msg-ai-role"><Sparkles size={12} /> AI</div>
          <ReferenceStatus status={referenceStatus} />
          {thinking && <div className="thinking-indicator"><span className="thinking-dots"><span /><span /><span /></span>思考中…</div>}
          {toolStatus && <ToolLine status={toolStatus} />}
          {streamText && <Markdown text={streamText} />}
          {streamImages.map((img) => <img key={img.url} className="gen-image" src={img.url} alt={img.prompt} />)}
        </div>}
        <div ref={bottomRef} />
      </div></div>}
      <div className={`chat-composer-wrap${composerCollapsed ? ' collapsed' : ''}`}>
        {composerCollapsed && <div className="composer-collapsed-bar">
          <button className="btn soft" onClick={() => { setComposerCollapsed(false); requestAnimationFrame(() => textareaRef.current?.focus()); }}><ChevronUp size={15} />展开输入框</button>
        </div>}
        {!composerCollapsed && <>
        <div className="quick-actions">{quickActions.map(([label, text, skill]) => <button key={label} disabled={streaming} onClick={() => { setInput(text); setSkillId(skills.some((s) => s.id === skill) ? skill : ''); textareaRef.current?.focus(); }}>{label}</button>)}<button disabled title="视频生成将在后续阶段接入">生视频</button><button onClick={onVoice}>配音</button></div>
        <div className="chat-composer">
          {popover && <div className="skill-popover">
            <div className="popover-heading"><strong>{popover === 'skills' ? '选择技能' : '引用知识库'}</strong><button className="icon-button" aria-label="关闭选择器" onClick={() => setPopover(null)}><X size={15} /></button></div>
            <input className="input" aria-label={popover === 'skills' ? '搜索技能' : '搜索引用笔记'} placeholder="搜索…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
            {(popover === 'skills' ? skills : notes).filter((s) => `${s.name || s.title} ${s.description || s.content || ''}`.toLowerCase().includes(filter.toLowerCase())).map((s) => <button key={s.id} className="skill-option" onClick={() => {
              if (popover === 'skills') { setSkillId(s.id); if (s.id === 'knowledge-content-imitation') setReferences((v) => v.slice(0, 1)); setInput((v) => v.replace(/@$/, '')); }
              else { setReferences((v) => skillId === 'knowledge-content-imitation' ? [{ id: s.id, title: s.title }] : v.some((n) => n.id === s.id) ? v : [...v, { id: s.id, title: s.title }]); setInput((v) => v.replace(/#$/, '')); }
              setPopover(null); setFilter(''); textareaRef.current?.focus();
            }}><span className="skill-option-name">{s.name || s.title}</span><span className="skill-option-desc">{s.description || s.summary || s.content}</span></button>)}
            {popover === 'notes' && !notes.length && <p className="quiet-empty">知识库中还没有笔记</p>}
          </div>}
          {(selectedSkill || references.length > 0) && <div className="composer-citations">
            {selectedSkill && <button className="composer-skill-chip" disabled={streaming || loading} title="移除技能" onClick={() => setSkillId('')}><Sparkles size={13} />@{selectedSkill.name}<X size={12} /></button>}
            {references.map((n) => <span key={n.id} className="reference-controls"><button className="composer-skill-chip composer-note-chip" disabled={streaming || loading} title={`移除引用：${n.title}`} onClick={() => { setReferences((v) => v.filter((r) => r.id !== n.id)); setRereadNoteIds(v => v.filter(id => id !== n.id)); }}><span>#{n.title}</span><X size={12} /></button>{referenceMode !== 'text-only' && <button className="text-button" disabled={streaming || loading} onClick={() => setRereadNoteIds(v => v.includes(n.id) ? v.filter(id => id !== n.id) : [...v, n.id])}>{rereadNoteIds.includes(n.id) ? '已安排重读 · 取消' : '重新读图'}</button>}</span>)}
          </div>}
          {skillId === 'knowledge-content-imitation' && empty && <p className="composer-reference-hint">{referenceMode === 'text-only' ? '仅改文案：AI 只接收笔记文字，不上传、不分析、不生成图片；原图仅在本地保留，后续发布会自动带上。' : `引用一篇笔记，先讨论创作方案，确认后再生成内容。${references.length > 0 ? '在模型设置开启图片输入后，可参考本地导入的原配图；缺图或超限会在独立图片状态中提示。' : ''}`}</p>}
          {!!references.length && !empty && <p className="composer-reference-hint">{referenceMode === 'text-only' ? '当前仍为仅改文案模式：原图不会发给 AI，只会在本地发布包中复用。' : '续写沿用保存的创作文字，不重复附原图。核对细节请点“重新读图”，随下一条消息发送；仍需开启设置中的图片输入。'}</p>}
          <div className="composer-row">
            <button className="attach-card" onClick={openNotes} disabled={streaming} aria-label="添加知识库素材"><Plus size={27} strokeWidth={1.6} /></button>
            <textarea ref={textareaRef} className="composer-textarea" aria-label="消息内容" placeholder="描述创作目标，使用 # 调用知识库" value={input}
              onChange={(e) => setInput(e.target.value)} disabled={streaming || loading}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === '@') { e.preventDefault(); setPopover('skills'); setFilter(''); }
                if (e.key === '#') { e.preventDefault(); openNotes(); }
                if (e.key === 'Escape') setPopover(null);
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
              }} />
          </div>
          <div className="composer-bottom"><span className="permission-label"><ShieldCheck size={16} />默认权限</span>
            <div className="composer-models">{[['chat', '对话模型'], ['image', '生图模型']].map(([scope, label]) => <label key={scope}>{label}<select aria-label={label} disabled={streaming || loading || !modelConfig} value={modelSelections[scope]} onChange={e => setModelSelections(v => ({ ...v, [scope]: e.target.value }))}>
              <option value="">{modelConfig ? `跟随设置 · ${modelConfig.routes?.[scope]?.model || '未配置'}` : '读取模型中…'}</option>
              {(modelConfig?.providers || []).filter(p => p.models.some(m => m.capabilities.includes(scope))).map(p => <optgroup key={p.id} label={p.name}>{p.models.filter(m => m.capabilities.includes(scope)).map(m => <option key={m.id} value={JSON.stringify({ providerId: p.id, model: m.id })}>{p.name} · {m.id}</option>)}</optgroup>)}
            </select></label>)}</div>
            <button className="text-button skill-trigger" disabled={streaming} onClick={() => { setPopover(popover === 'skills' ? null : 'skills'); setFilter(''); }}>@ 技能</button>
            {!empty && <button className="icon-button" aria-label="收起输入框" title="收起输入框，阅读对话时腾出空间" onClick={() => setComposerCollapsed(true)}><ChevronDown size={16} /></button>}
            <span className="composer-shortcut">⌘ / Ctrl ↵</span>
            <button className="send-button" aria-label="发送消息" onClick={send} disabled={streaming || loading || !input.trim()}>{streaming ? <LoaderCircle className="spin" size={19} /> : <ArrowUp size={21} />}</button>
          </div>
        </div>
        </>}
        {error && <div role="alert" className="msg-error">{error}</div>}
      </div>
      {empty && <section className="chat-skills"><div className="section-heading"><h2>从技能开始</h2><span>为每一次创作，找到合适的起点</span></div><div className="skill-starters">{starters.map(([id, name, description]) => <button key={id} onClick={() => { setSkillId(id); if (id === 'knowledge-content-imitation') setReferences((v) => v.slice(0, 1)); textareaRef.current?.focus(); }}><Sparkles size={20} /><strong>{name}</strong><p>{description}</p><span>使用技能 <ArrowUpRight size={13} /></span></button>)}</div></section>}
    </div>
  </div>;
}
