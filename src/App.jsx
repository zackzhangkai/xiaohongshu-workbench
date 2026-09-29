import React, { useCallback, useEffect, useState } from 'react';
import Layout from './components/Layout.jsx';
import HomePage from './pages/HomePage.jsx';
import ChatPage from './pages/ChatPage.jsx';
import KnowledgePage from './pages/KnowledgePage.jsx';
import AssetsPage from './pages/AssetsPage.jsx';
import StudioPage from './pages/StudioPage.jsx';
import ManuscriptsPage from './pages/ManuscriptsPage.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import HotspotsPage from './pages/HotspotsPage.jsx';
import ImageCleanerPage from './pages/ImageCleanerPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import VoicePage from './pages/VoicePage.jsx';
import TranscriptionPage from './pages/TranscriptionPage.jsx';
import SubtitlesPage from './pages/SubtitlesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { request } from './api.js';
import PublishPage from './pages/PublishPage.jsx';
import { workspaceDeepLink } from './workspace-deep-link.js';

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('publishSession')) return <PublishPage sessionId={params.get('publishSession')} message={params.get('message')} />;
  return <WorkspaceApp />;
}

// One-shot deep links (e.g. #knowledge-collector) let the collector extension
// drop the user straight onto the pairing-code panel. Read once at startup.
function deepLinkFromHash() {
  return workspaceDeepLink(window.location.hash, window.location.search);
}

function WorkspaceApp() {
  const deepLink = deepLinkFromHash();
  const [manuscriptRequest, setManuscriptRequest] = useState(null);
  const [subtitleRequest, setSubtitleRequest] = useState(null);
  const [view, setView] = useState(deepLink.view);
  const [sessions, setSessions] = useState([]);
  const [chatRequest, setChatRequest] = useState({ id: null, key: 0 });
  const [configVersion, setConfigVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searchKey, setSearchKey] = useState(0);
  const refreshSessions = useCallback(async () => {
    try { setSessions((await request('/api/sessions')).sessions ?? []); }
    catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { refreshSessions(); }, [refreshSessions]);
  const openChat = (id = null, skillId = '', text = '', references = [], options = {}) => {
    if (busy) { setView('redclaw'); return; }
    if (id && id === chatRequest.id && !skillId && !text) { setView('redclaw'); return; }
    setChatRequest({ id, skillId, text, references, ...options, key: Date.now() });
    setView('redclaw');
  };
  const search = () => { setView('knowledge'); setSearchKey((n) => n + 1); };
  return <Layout currentView={view} onNavigate={setView} onNewChat={() => openChat()}
    sessions={sessions} sessionId={chatRequest.id} onSession={openChat} busy={busy} onSearch={search}
    hasCurrentChat={chatRequest.key > 0} onResumeChat={() => setView('redclaw')}>
    {error && <div role="alert" className="app-error">{error}<button onClick={() => { setError(''); refreshSessions(); }}>重试</button></div>}
    {view === 'home' && <HomePage sessions={sessions} onSession={openChat} onNavigate={setView} onCompose={(text) => openChat(null, '', text)} />}
    <div className="chat-mount" hidden={view !== 'redclaw'}>
      <ChatPage configVersion={configVersion} chatRequest={chatRequest} onSessionCreated={(id) => setChatRequest((r) => ({ ...r, id }))}
        onVoice={() => setView('voice')} onOpenManuscript={(draft) => { setManuscriptRequest({ draft, key: Date.now() }); setView('manuscripts'); }} onSessionsUpdated={refreshSessions} onBusy={setBusy} active={view === 'redclaw'} />
    </div>
    <div className="knowledge-mount" hidden={view !== 'knowledge'}><KnowledgePage active={view === 'knowledge'} busy={busy} searchKey={searchKey} initialCollectorOpen={deepLink.collector} initialNoteId={deepLink.noteId} onAssets={() => setView('subjects')}
      onCompose={(note) => openChat(null, 'knowledge-content-imitation', `AI 仿写 · ${note.title}`, [{ id: note.id, title: note.title }], { referenceMode: 'visual' })}
      onRewriteCopy={(note) => openChat(null, 'knowledge-content-imitation', `只改写这篇小红书笔记的文案 · ${note.title}。不读图、不生图，原图保留给后续发布。`, [{ id: note.id, title: note.title }], { referenceMode: 'text-only' })} /></div>
    <div className="page-mount" hidden={view !== 'manuscripts'}><ManuscriptsPage active={view === 'manuscripts'} openRequest={manuscriptRequest} /></div>
    {view === 'subjects' && <AssetsPage />}
    {view === 'tools' && <StudioPage onNavigate={setView} onOpenChat={(skillId) => openChat(null, skillId)} />}
    {view === 'hotspots' && <HotspotsPage onCompose={(note) => openChat(null, '', `请基于这条资讯提出原创选题和写作方向，区分已知事实与推断：${note.title}`, [{ id: note.id, title: note.title }])} />}
    {view === 'calendar' && <CalendarPage onSession={(id) => { refreshSessions(); openChat(id); }} />}
    {view === 'image-cleaner' && <ImageCleanerPage />}
    {view === 'profile' && <ProfilePage onCompose={(text) => openChat(null, '', text)} />}
    {view === 'voice' && <VoicePage />}
    {view === 'transcription' && <TranscriptionPage onEdit={item => { setSubtitleRequest({ name: item.name, cues: item.segments, key: Date.now() }); setView('subtitles'); }} />}
    <div hidden={view !== 'subtitles'}><SubtitlesPage active={view === 'subtitles'} openRequest={subtitleRequest} onTranscribe={() => setView('transcription')} /></div>
    {view === 'settings' && <SettingsPage onSaved={() => setConfigVersion((v) => v + 1)} />}
  </Layout>;
}
