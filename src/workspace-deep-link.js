const VIEWS = ['home', 'knowledge', 'manuscripts', 'subjects', 'tools', 'hotspots', 'settings'];

export function workspaceDeepLink(hash = '', search = '') {
  const noteId = new URLSearchParams(search).get('knowledgeNote');
  if (/^[0-9a-f-]{36}$/.test(noteId || '')) return { view: 'knowledge', collector: false, noteId };
  const [view, panel] = hash.replace(/^#/, '').split('-');
  if (!VIEWS.includes(view)) return { view: 'home', collector: false, noteId: null };
  return { view, collector: view === 'knowledge' && panel === 'collector', noteId: null };
}
