import React, { useState } from 'react';
import { Home, Lightbulb, Flame, Clock3, Puzzle, Search, PanelLeft, ChevronDown, Settings, FolderOpen } from 'lucide-react';
const NAV_ITEMS = [
  ['home', '主页', Home], ['knowledge', '知识库', Lightbulb], ['hotspots', '热点', Flame],
  ['calendar', '日历', Clock3], ['tools', '工具&技能', Puzzle],
];
export default function Layout({ currentView, onNavigate, onNewChat, sessions, sessionId, onSession, busy, onSearch, hasCurrentChat, onResumeChat, children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [listTab, setListTab] = useState('chat');
  return <div className={`app-shell ${currentView === 'settings' ? 'settings-shell' : ''} ${collapsed && currentView !== 'settings' ? 'sidebar-collapsed' : ''}`}>
    {currentView === 'settings' ? <aside className="settings-sidebar"><button className="settings-back" onClick={() => onNavigate('home')}>← 返回应用</button><h2>设置</h2><div aria-current="page"><Settings size={18} /> AI 模型</div></aside> : <>
    <aside className="app-sidebar" aria-label="工作台导航">
      <div className="sidebar-top"><span className="workspace-mark">B</span>
        <button className="icon-button" aria-label="搜索知识库" onClick={onSearch}><Search size={19} /></button>
        <button className="icon-button" aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'} onClick={() => setCollapsed(!collapsed)}><PanelLeft size={19} /></button>
      </div>
      <nav className="sidebar-nav">
        <button className={`sidebar-item new-chat ${currentView === 'redclaw' ? 'active' : ''}`} onClick={onNewChat} title={busy ? '返回正在生成的对话' : '新对话'}>
          <span className="sidebar-label">新对话</span>
        </button>
        {NAV_ITEMS.map(([key, label, Icon]) => <button key={key} className={`sidebar-item ${currentView === key ? 'active' : ''}`} onClick={() => onNavigate(key)} title={label} aria-current={currentView === key ? 'page' : undefined}>
          <Icon size={21} strokeWidth={1.55} /><span className="sidebar-label">{label}</span>
        </button>)}
      </nav>
      <div className="sidebar-history">
        <div className="history-tabs" role="tablist" aria-label="最近内容">
          <button role="tab" aria-selected={listTab === 'chat'} onClick={() => setListTab('chat')}>对话</button>
          <button role="tab" aria-selected={listTab === 'draft'} onClick={() => { setListTab('draft'); onNavigate('manuscripts'); }}>稿件</button>
        </div>
        <div className="history-list" role="tabpanel">
          {listTab === 'chat' && hasCurrentChat && !sessionId && <button className="session-item" onClick={onResumeChat}>继续当前草稿</button>}
          {listTab === 'chat' ? sessions.length ? sessions.map((s) => <button key={s.id} disabled={busy && s.id !== sessionId} className={`session-item ${currentView === 'redclaw' && s.id === sessionId ? 'active' : ''}`} onClick={() => onSession(s.id)} title={s.title}>{s.title}</button>) : <p className="sidebar-empty">开始第一段对话</p>
            : <button className={`session-item ${currentView === 'manuscripts' ? 'active' : ''}`} onClick={() => onNavigate('manuscripts')}>打开稿件库</button>}
        </div>
      </div>
      <div className="sidebar-footer">
        <div className="local-space"><span className="status-dot" />本地工作空间</div>
        <button className="sidebar-account" onClick={() => onNavigate('settings')} title="设置">
          <span>我的工作台<small>小红书工作台</small></span><Settings size={17} />
        </button>
      </div>
    </aside></>}
    <main className={`app-main view-${currentView}`}>
      {currentView !== 'settings' && <header className="workspace-header"><span>我的工作台</span><ChevronDown size={14} aria-hidden="true" /><button className="icon-button" onClick={() => onNavigate('settings')} aria-label="工作台设置"><Settings size={17} /></button></header>}
      <div className="page">{children}</div>
    </main>
  </div>;
}
