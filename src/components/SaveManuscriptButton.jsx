import React, { useState } from 'react';
import { request, writeJson } from '../api.js';

export default function SaveManuscriptButton({ sessionId, messageIndex, onOpen }) {
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try {
      // Re-saving is idempotent: it backfills images generated since the last
      // save and upgrades untouched raw drafts to the extracted publishable copy.
      const result = await request('/api/manuscripts/from-message', writeJson('POST', { sessionId, messageIndex }));
      if (saved) onOpen(result);
      else setSaved(result);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <span><button className="btn" disabled={busy || !sessionId} onClick={save}>{busy ? '保存中…' : saved ? '打开已保存稿件' : '保存为稿件'}</button>{error && <span role="alert">{error}</span>}</span>;
}
