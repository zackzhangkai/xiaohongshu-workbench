import React, { useEffect, useState } from 'react';
import { request, writeJson } from '../api.js';
const fields = [ ['name', '账号名称'], ['platform', '发布平台'], ['positioning', '账号定位与擅长领域'], ['audience', '目标读者'], ['goals', '运营目标与可投入时间'], ['style', '表达风格与长期偏好'], ['boundaries', '内容边界与不希望涉及的内容'] ];
export default function ProfilePage({ onCompose }) {
  const [form, setForm] = useState(Object.fromEntries(fields.map(([k]) => [k, ''])));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { request('/api/profile').then(setForm).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  const save = async planning => {
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await request('/api/profile', writeJson('PUT', form));
      setForm(saved); setNotice('账号资料已保存');
      if (planning) onCompose('请根据我保存的账号资料制定可执行的运营规划，包含：定位与读者价值、3至5个内容栏目、未来7天的选题和发布安排、创作流程及复盘指标。缺失信息请明确标注假设，不要编造账号数据、调研结果或承诺涨粉。');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <div className="page-body"><h2>账号运营规划</h2>
    <p className="dim">保存定位和长期偏好，后续对话和运营任务会参考这些资料。保存只写入本地；发送对话时会随请求传给你配置的模型。</p>
    {error && <p role="alert">{error}</p>}
    <form className="profile-form" onSubmit={e => { e.preventDefault(); save(false); }}>
      {fields.map(([key, label]) => <label className="field-label" key={key}>{label}<textarea className="input" rows={key === 'name' || key === 'platform' ? 1 : 3} maxLength={5000} disabled={loading || busy} value={form[key]} onChange={e => { setForm({ ...form, [key]: e.target.value }); setNotice('有未保存修改'); }} /></label>)}
      <div className="manuscript-actions"><button className="btn" disabled={loading || busy}>保存账号资料</button><button type="button" className="btn primary" disabled={loading || busy || !form.positioning.trim()} onClick={() => save(true)}>保存并开始规划</button><span role="status">{notice}</span></div>
    </form>
  </div>;
}
