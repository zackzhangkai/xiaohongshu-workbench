import React, { useEffect, useState, useRef } from 'react';
import { ChevronRight, Plus, Trash2, Cpu, X } from 'lucide-react';
import { request, writeJson } from '../api.js';

const CAPS = [['chat', '对话与智能体'], ['transcription', '语音转写'], ['embedding', '向量模型'], ['image', '图片生成'], ['video', '视频生成']];
const PRESETS = {
  openai: ['OpenAI', 'https://api.openai.com/v1', '◎'], zhipu: ['Zhipu AI / BigModel', 'https://open.bigmodel.cn/api/paas/v4', '✦'],
  deepseek: ['DeepSeek', 'https://api.deepseek.com/v1', '◈'], dashscope: ['阿里云百炼', 'https://dashscope.aliyuncs.com/compatible-mode/v1', '◇'],
  custom: ['自定义', 'https://api.example.com/v1', '⌘'], ollama: ['Ollama', 'http://127.0.0.1:11434/v1', '◉'], lmstudio: ['LM Studio', 'http://127.0.0.1:1234/v1', '▣'],
};
const blank = preset => ({ id: crypto.randomUUID(), preset, name: PRESETS[preset][0], baseUrl: PRESETS[preset][1], apiKey: '', protocol: 'openai', imageProtocol: 'openai-images', models: [], defaultModel: '' });
const scrub = v => ({ providers: v.providers.map(p => ({ ...p, apiKey: '', clearKey: false })), routes: v.routes, chatImageInput: v.chatImageInput === true });
function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement; ref.current?.focus();
    const keydown = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const items = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
        if (!items.length) return;
        if (e.shiftKey && (document.activeElement === items[0] || document.activeElement === ref.current)) { e.preventDefault(); items.at(-1).focus(); }
        else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="model-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="model-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}><header><h2>{title}</h2><button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button></header>{children}</section></div>;
}
export default function SettingsPage({ onSaved }) {
  const [form, setForm] = useState(null), [expanded, setExpanded] = useState(''), [busy, setBusy] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [dirty, setDirty] = useState(false);
  const [create, setCreate] = useState(null), [draft, setDraft] = useState(null), [catalog, setCatalog] = useState({});
  const [vision, setVision] = useState(null), [imageTest, setImageTest] = useState(null);
  const load = () => request('/api/config').then(v => { setForm(scrub(v)); setVision(v.visionVerification); setImageTest(v.imageVerification); }).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);
  const change = fn => { setForm(fn); setDirty(true); setError(''); setNotice(''); setVision(null); setImageTest(null); };
  const update = (id, patch) => change(f => ({ ...f, providers: f.providers.map(p => p.id === id ? { ...p, ...patch } : p) }));
  const remove = (id, modelId) => change(f => ({ ...f, providers: modelId ? f.providers.map(p => p.id === id ? { ...p, models: p.models.filter(m => m.id !== modelId), defaultModel: p.defaultModel === modelId ? p.models.find(m => m.id !== modelId)?.id || '' : p.defaultModel } : p) : f.providers.filter(p => p.id !== id), routes: Object.fromEntries(Object.entries(f.routes).map(([c, r]) => [c, r?.providerId === id && (!modelId || r.model === modelId) ? null : r])) }));
  const action = async (kind, providerId) => {
    if (busy) return; setBusy(kind); setError(''); setNotice('');
    try {
      const result = await request(kind === 'save' ? '/api/config' : `/api/config/${kind}`, writeJson(kind === 'save' ? 'PUT' : 'POST', { ...form, ...(providerId ? { providerId } : {}) }));
      if (kind === 'save' || kind === 'test') {
        const v = kind === 'save' ? result : result.config;
        setForm(scrub(v)); setDirty(false); setVision(v.visionVerification); setImageTest(v.imageVerification); onSaved?.();
        setNotice(kind === 'save' ? '配置已保存，下一次对话立即使用所选模型。' : `测试成功并已启用 · ${result.model} · ${result.latencyMs} ms`);
      } else if (kind === 'models') { setCatalog(c => ({ ...c, [providerId]: result.models })); setNotice(`已读取 ${result.models.length} 个模型，请在“添加模型”中选择并指定能力。`); }
      else if (kind === 'test-vision') { setVision(result); setNotice('内置样图识别成功，当前修改仍需保存。'); }
      else if (kind === 'test-image') { setImageTest(result); setNotice(result.warning || '测试图已生成，当前修改仍需保存。'); }
      else { setNotice(result.reason); const id = form.routes.image?.providerId; if (id) setCatalog(c => ({ ...c, [id]: result.models.map(m => m.id) })); }
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  if (!form) return <div className="model-settings"><p role="status">{error || '正在读取模型配置…'}</p>{error && <button onClick={load}>重试</button>}</div>;
  const fields = (p, patch) => <div className="provider-fields">
    <label>名称<input required value={p.name} onChange={e => patch({ name: e.target.value })} /></label>
    <label>供应商预设<select value={p.preset} onChange={e => { const preset = e.target.value; patch({ preset, name: PRESETS[preset][0], baseUrl: PRESETS[preset][1] }); }}>{Object.entries(PRESETS).filter(([id]) => !create || (create.local ? ['ollama', 'lmstudio'].includes(id) : !['ollama', 'lmstudio'].includes(id))).map(([id, [name]]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label>协议<select value={p.protocol} onChange={e => patch({ protocol: e.target.value })}><option value="openai">OpenAI 兼容</option></select></label>
    <label className="provider-wide">API Endpoint<input required type="url" value={p.baseUrl} onChange={e => patch({ baseUrl: e.target.value })} /></label>
    <label className="provider-wide">API Key<input type="password" autoComplete="new-password" value={p.apiKey || ''} disabled={p.clearKey} placeholder={p.hasKey ? '留空保留已有 Key' : '本地免 Key 服务可留空'} onChange={e => patch({ apiKey: e.target.value })} /></label>
    {p.hasKey && <label className="provider-wide model-checkbox"><input type="checkbox" checked={Boolean(p.clearKey)} onChange={e => patch({ clearKey: e.target.checked })} />清除已保存的 Key</label>}
    <p className="provider-wide model-hint">更换地址需重新输入 Key 或明确清除。聊天追加 /chat/completions；不支持 Anthropic / Gemini 原生协议。</p>
    {['ollama', 'lmstudio'].includes(p.preset) && <p className="provider-wide model-hint">{p.preset === 'ollama' ? '先运行 ollama serve，并用 ollama pull 下载模型。' : '在 LM Studio 的 Developer → Local Server 中启动服务并加载模型。'}</p>}
    <label className="provider-wide">图片生成协议<select value={p.imageProtocol} onChange={e => patch({ imageProtocol: e.target.value })}><option value="openai-images">OpenAI Images · /images/generations</option><option value="dashscope-multimodal">DashScope 同步 · multimodal-generation</option><option value="dashscope-image-async">DashScope 异步 · image-generation</option></select></label>
    <p className="provider-wide model-hint">DashScope 原生生图需要 /api/v1 基础地址；与聊天地址不同时请另建供应商。</p>
  </div>;
  return <div className="model-settings"><h1>自定义模型</h1><fieldset disabled={Boolean(busy)} className="model-settings-fieldset">
    <div className="model-section-heading"><h2>模型供应商</h2><div><button onClick={() => setCreate({ local: false, provider: blank('openai') })}><Plus size={15} />添加供应商</button><button onClick={() => setCreate({ local: true, provider: blank('ollama') })}><Plus size={15} />添加本地</button></div></div>
    <div className="provider-list">{form.providers.map(p => <article className="provider-card" key={p.id}><div className="provider-summary"><button className="provider-expand" aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? '' : p.id)}><ChevronRight size={18} className={expanded === p.id ? 'is-expanded' : ''} /><span><strong><i className={`provider-logo logo-${p.preset}`}>{PRESETS[p.preset]?.[2] || '⌘'}</i>{p.name}</strong><small>{PRESETS[p.preset]?.[0] || '自定义'} · {p.models.length} 个模型 · Key {p.clearKey ? '待清除' : p.apiKey || p.hasKey ? '已配置' : '未配置'}</small></span></button><button className="provider-delete" aria-label={`删除供应商 ${p.name}`} onClick={() => remove(p.id)}><Trash2 size={16} /></button></div>
      {expanded === p.id && <div className="provider-detail">{fields(p, patch => update(p.id, patch))}<div className="model-section-heading"><h3>模型 <small>{p.models.length}</small></h3><div><button onClick={() => action('models', p.id)}>检测模型目录</button><button onClick={() => setDraft({ providerId: p.id, id: '', capabilities: ['chat'] })}><Plus size={14} />添加模型</button></div></div>{!p.models.length && <p className="model-hint">暂无模型，可直接手动添加；无需先检测目录。</p>}{p.models.map(m => <div className="provider-model" key={m.id}><span>{m.id}<small>{m.capabilities.map(c => CAPS.find(([id]) => id === c)?.[1]).join(' · ')}</small></span><button onClick={() => update(p.id, { defaultModel: m.id })} aria-pressed={p.defaultModel === m.id}>{p.defaultModel === m.id ? '默认模型' : '设为默认'}</button><button onClick={() => setDraft({ providerId: p.id, id: m.id, capabilities: m.capabilities, editing: true })}>编辑</button><button aria-label={`删除模型 ${m.id}`} onClick={() => remove(p.id, m.id)}><Trash2 size={14} /></button></div>)}</div>}
    </article>)}</div>
    <section className="model-routes"><h2>模型能力设置</h2><div className="model-route-header"><span>能力</span><span>供应商</span><span>模型</span></div>{CAPS.map(([cap, label]) => { const route = form.routes[cap]; const providers = form.providers.filter(p => p.models.some(m => m.capabilities.includes(cap))); const provider = providers.find(p => p.id === route?.providerId); return <div className="model-route" key={cap}><label htmlFor={`route-${cap}`}>{label}{!['chat', 'image'].includes(cap) && <small>仅保存配置 · 尚未接入调用</small>}</label><select id={`route-${cap}`} aria-label={`${label}供应商`} value={route?.providerId || ''} onChange={e => { const p = providers.find(p => p.id === e.target.value); const models = p?.models.filter(m => m.capabilities.includes(cap)) || []; change(f => ({ ...f, routes: { ...f.routes, [cap]: p ? { providerId: p.id, model: models.find(m => m.id === p.defaultModel)?.id || models[0].id } : null } })); }}><option value="">未配置</option>{providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label={`${label}模型`} disabled={!provider} value={route?.model || ''} onChange={e => change(f => ({ ...f, routes: { ...f.routes, [cap]: { ...route, model: e.target.value } } }))}><option value="" disabled>选择模型</option>{provider?.models.filter(m => m.capabilities.includes(cap)).map(m => <option key={m.id} value={m.id}>{m.id}</option>)}</select></div>; })}</section>
    <details className="model-advanced"><summary>高级设置与连接测试</summary><label className="model-checkbox"><input type="checkbox" checked={form.chatImageInput} onChange={e => change(f => ({ ...f, chatImageInput: e.target.checked }))} />允许聊天模型读取引用笔记的图片</label><p className="model-hint">开启并保存后，首次引用或点击“重新读图”后的手动对话会将所选笔记的本地图片发送到聊天服务；普通续写沿用保存的文字上下文，可能计费。每轮最多 6 张、单图 5MB、合计 20MB；定时任务不上传图片。</p><div className="model-test-actions"><button disabled={!form.routes.chat} onClick={() => action('test')}>测试并启用</button><button disabled={!form.routes.chat || !form.chatImageInput} onClick={() => action('test-vision')}>测试图片输入</button><button disabled={!form.routes.image} onClick={() => action('image-models')}>检测生图模型</button><button disabled={!form.routes.image} onClick={() => action('test-image')}>试生成一张图片</button></div><p className="model-hint">测试会真实调用模型，可能消耗额度。测试并启用成功后保存全部配置；其他测试不保存配置。图片输入测试仅发送内置非私有样图。</p><p className="model-hint">图片输入验证：{vision ? `内置样图识别成功 · ${vision.model}` : '未验证'} · 生图验证：{imageTest ? `已生成 · ${imageTest.model}` : '未验证'}</p>{imageTest?.url && <a href={imageTest.url} target="_blank" rel="noreferrer">查看测试图</a>}</details>
    <div className="model-save"><span>{dirty ? '有未保存的更改' : '配置已同步'}</span><button className="model-save-primary" onClick={() => action('save')}>{busy ? '处理中…' : '保存设置'}</button></div></fieldset>
    {error && <p className="model-error" role="alert">{error}</p>}{notice && <p className="model-notice" role="status">{notice}</p>}
    {create && <Modal title={create.local ? '添加本地模型服务' : '添加供应商'} onClose={() => setCreate(null)}><form onSubmit={e => { e.preventDefault(); const p = create.provider; change(f => ({ ...f, providers: [...f.providers, p] })); setExpanded(p.id); setCreate(null); }}>{fields(create.provider, patch => setCreate(c => ({ ...c, provider: { ...c.provider, ...patch } })))}<footer><button type="button" onClick={() => setCreate(null)}>取消</button><button className="model-save-primary">创建供应商</button></footer></form></Modal>}
    {draft && <Modal title={draft.editing ? '编辑模型能力' : '添加模型'} onClose={() => setDraft(null)}><form onSubmit={e => { e.preventDefault(); const id = draft.id.trim(); if (!id || !draft.capabilities.length) return; const p = form.providers.find(p => p.id === draft.providerId); const old = p.models.find(m => m.id === id); update(p.id, { models: old ? p.models.map(m => m.id === id ? { ...m, capabilities: draft.editing ? draft.capabilities : [...new Set([...m.capabilities, ...draft.capabilities])] } : m) : [...p.models, { id, capabilities: draft.capabilities }], defaultModel: p.defaultModel || id }); if (draft.editing) change(f => ({ ...f, routes: Object.fromEntries(Object.entries(f.routes).map(([c, r]) => [c, r?.providerId === p.id && r.model === id && !draft.capabilities.includes(c) ? null : r])) })); setDraft(null); }}><label className="model-modal-field">模型 ID<input required autoFocus readOnly={draft.editing} list="provider-model-catalog" value={draft.id} onChange={e => setDraft(d => ({ ...d, id: e.target.value }))} placeholder="手动输入或选择目录中的模型" /><datalist id="provider-model-catalog">{(catalog[draft.providerId] || []).map(id => <option key={id} value={id}>{id}</option>)}</datalist></label><p className="model-hint">指定模型支持的能力；重复添加相同 ID 可补充能力。</p><div className="model-capabilities">{CAPS.map(([c, label]) => <label className="model-checkbox" key={c}><input type="checkbox" checked={draft.capabilities.includes(c)} onChange={e => setDraft(d => ({ ...d, capabilities: e.target.checked ? [...d.capabilities, c] : d.capabilities.filter(v => v !== c) }))} />{label}</label>)}</div><footer><button type="button" onClick={() => setDraft(null)}>取消</button><button className="model-save-primary" disabled={!draft.id.trim() || !draft.capabilities.length}>{draft.editing ? '保存能力' : '确认添加'}</button></footer></form></Modal>}
  </div>;
}
