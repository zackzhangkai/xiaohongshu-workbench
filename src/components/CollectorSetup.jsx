import React, { useState } from 'react';
import { request } from '../api.js';
import CopyTextButton from './CopyTextButton.jsx';

export default function CollectorSetup({ onClose }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  async function reveal() {
    try { setKey((await request('/api/collector/pairing')).key); setError(''); }
    catch (e) { setError(e.message); }
  }
  return <section className="collector-setup" aria-label="小红书采集插件安装">
    <button className="text-button" onClick={onClose}>收起</button>
    <h2>小红书采集插件</h2>
    <p>把 Chrome 中打开的图文笔记、配图和已加载评论保存到这里。</p>
    <ol><li>使用仓库内的插件源码目录 <code>extensions/xhs-collector</code>（无需下载）。</li>
      <li>在 Chrome 地址栏打开 <code>chrome://extensions</code>，开启「开发者模式」，点击「加载已解压的扩展程序」，选择该目录。</li>
      <li>点击下方显示配对码，在插件「连接设置」中粘贴。工作台地址填 <code>http://127.0.0.1:8787</code>（按实际端口），点击「保存并测试连接」。</li>
      <li>打开小红书图文详情，点击插件「保存当前笔记」。需要评论时先在网页加载评论，再勾选采集。知识库会自动刷新。</li></ol>
    <button className="btn soft" onClick={reveal}>显示本机配对码</button>
    {key && <div className="collector-pairing"><input className="input" aria-label="本机配对码" readOnly value={key} /><CopyTextButton text={key} /></div>}
    {error && <p role="alert" className="msg-error">{error}</p>}
    <p className="dim">0.2.0 新增「关注主题 · 搜索高赞前十」：支持图文/视频/全部筛选，勾选图文批量入库。首次搜索需在 Chrome 授权小红书访问；视频仅查看原文，不下载或转写。图片下载失败会逐张提示。</p>
  </section>;
}
