import React, { useEffect, useState } from 'react';
import { request, writeJson } from '../api.js';

const defaultTime = () => { const d = new Date(Date.now() + 3600000); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const labels = { scheduled: '等待执行', running: '执行中', completed: '已完成', failed: '失败', interrupted: '已中断' };
const repeats = { once: '单次', daily: '每天（24 小时）', weekly: '每周（7 天）', interval: '固定间隔' };
export default function CalendarPage({ onSession }) {
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', prompt: '', runAt: defaultTime(), repeat: 'once', intervalMinutes: 60 });
  const [day, setDay] = useState('');
  const [editing, setEditing] = useState(null);
  const [enabled, setEnabled] = useState(true);
  const reset = () => { setEditing(null); setEnabled(true); setForm({ title: '', prompt: '', runAt: defaultTime(), repeat: 'once', intervalMinutes: 60 }); };
  const edit = task => {
    const d = new Date(task.nextRunAt);
    setEditing(task.id); setEnabled(task.enabled); setError('');
    setForm({ title: task.title, prompt: task.prompt, repeat: task.repeat, intervalMinutes: task.intervalMinutes, runAt: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) });
  };
  const refresh = async () => { const data = await request('/api/schedules'); setTasks(data.tasks); };
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try { const data = await request('/api/schedules'); if (active) setTasks(data.tasks); }
      catch (e) { if (active) setError(e.message); }
    };
    poll(); const timer = setInterval(poll, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const action = async (url, method, body) => {
    setBusy(true); setError('');
    try { await request(url, writeJson(method, body)); await refresh(); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  };
  const localDay = value => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  return <div className="page-body calendar-page">
    <h2>运营日历</h2>
    <p className="dim">按计划运行 AI 文字任务，执行结果保存到对话。需保持本地服务运行；将使用已配置模型的额度。</p>
    {error && <p role="alert">{error}</p>}
    <form className="schedule-form" onSubmit={async e => {
      e.preventDefault();
      if (await action(editing ? `/api/schedules/${editing}` : '/api/schedules', editing ? 'PATCH' : 'POST', { ...form, enabled, runAt: new Date(form.runAt).toISOString() })) reset();
    }}>
      <h3>{editing ? '编辑定时任务' : '创建定时任务'}</h3>
      {editing && <p className="dim">保存会重新设置下次执行时间，已有执行记录保留。请选择未来时间。</p>}
      <label className="field-label">任务名称<input className="input" required maxLength={200} disabled={busy} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
      <label className="field-label">任务内容<textarea className="input" required maxLength={50000} disabled={busy} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="例如：为我的 AI 科普账号提出 5 个选题，并说明写作角度" /></label>
      <div className="manuscript-actions">
        <label className="field-label">{editing ? '下次执行时间（本地时间）' : '首次执行时间（本地时间）'}<input className="input" type="datetime-local" required disabled={busy} value={form.runAt} onChange={e => setForm({ ...form, runAt: e.target.value })} /></label>
        <label className="field-label">重复<select className="input" disabled={busy} value={form.repeat} onChange={e => setForm({ ...form, repeat: e.target.value })}>{Object.entries(repeats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {form.repeat === 'interval' && <label className="field-label">间隔分钟<input className="input" type="number" min="1" max="525600" required disabled={busy} value={form.intervalMinutes} onChange={e => setForm({ ...form, intervalMinutes: Number(e.target.value) })} /></label>}
        {editing && <label><input type="checkbox" disabled={busy} checked={enabled} onChange={e => setEnabled(e.target.checked)} />启用修改后的计划</label>}
        <button className="btn primary" disabled={busy}>{editing ? '保存任务修改' : '创建定时任务'}</button>
        {editing && <button type="button" className="btn" disabled={busy} onClick={reset}>取消编辑</button>}
      </div>
    </form>
    <label className="field-label">按下次执行日期筛选<input type="date" className="input" value={day} onChange={e => setDay(e.target.value)} /></label>
    {!tasks.length && <p className="empty-state">暂无任务，创建你的第一个运营计划</p>}
    {tasks.filter(t => !day || localDay(t.nextRunAt) === day).map(task => <article className="app-card schedule-card" key={task.id}>
      <h3>{task.title} · {labels[task.status]}{!task.enabled && task.status !== 'completed' ? ' · 已暂停' : ''}</h3>
      <p className="schedule-prompt">{task.prompt}</p>
      <p className="dim">{repeats[task.repeat]}{task.repeat === 'interval' ? ` ${task.intervalMinutes} 分钟` : ''} · {task.enabled ? '下次执行' : '计划时间'}：{new Date(task.nextRunAt).toLocaleString()}</p>
      <div className="manuscript-actions">
        <button className="btn" disabled={busy || task.status === 'running'} onClick={() => edit(task)}>编辑任务</button>
        <button className="btn" disabled={busy || task.status === 'running'} onClick={() => action(`/api/schedules/${task.id}/run`, 'POST', {})}>立即执行</button>
        {!(task.repeat === 'once' && task.status === 'completed') && <button className="btn" disabled={busy || task.status === 'running'} onClick={() => action(`/api/schedules/${task.id}`, 'PATCH', { enabled: !task.enabled })}>{task.enabled ? '暂停' : '启用'}</button>}
      </div>
      <details><summary>执行记录（{task.runs.length}）</summary>{task.runs.map(run => <div className="schedule-run" key={run.id}>
        <span>{new Date(run.startedAt).toLocaleString()} · {labels[run.status]}</span>
        {run.prompt && <details><summary>执行时的任务内容</summary><p className="schedule-prompt">{run.prompt}</p></details>}
        {run.error && <p role="alert">{run.error}</p>}
        {run.sessionId && <button className="btn" onClick={() => onSession(run.sessionId)}>查看结果对话</button>}
      </div>)}</details>
    </article>)}
  </div>;
}
