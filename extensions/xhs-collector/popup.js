import { localEndpoint } from './transport.js';
const $ = id => document.getElementById(id);
function render(value) {
  if (!value) return;
  const stale = value.state === 'running' && Date.now() - value.updatedAt > 45000;
  $('status').textContent = stale ? '采集可能已中断，可以重新点击保存；重复采集会去重' : value.message;
  $('save').disabled = value.state === 'running' && !stale;
  $('warnings').replaceChildren(...(value.warnings || []).map(w => { const li = document.createElement('li'); li.textContent = w; return li; }));
}
async function refresh() { render((await chrome.storage.local.get('captureStatus')).captureStatus); }
await refresh();
setInterval(refresh, 5000);
chrome.storage.onChanged.addListener(changes => { if (changes.captureStatus) render(changes.captureStatus.newValue); });
$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'capture', includeComments: $('comments').checked });
    if (result?.error) throw new Error(result.error);
  } catch (error) { $('status').textContent = error.message; $('save').disabled = false; }
});
$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('workspace').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: localEndpoint((await chrome.storage.local.get('endpoint')).endpoint) }); }
  catch (error) { $('status').textContent = error.message; }
});

$('discover').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('search.html') }));
