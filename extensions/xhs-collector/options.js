import { localEndpoint, localRequest } from './transport.js';
const $ = id => document.getElementById(id);
await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const settings = await chrome.storage.local.get(['endpoint', 'key']);
$('endpoint').value = settings.endpoint || 'http://127.0.0.1:8788';
$('key').value = settings.key || '';
// Guide users straight to the workspace page that shows the pairing code.
$('open-workspace').addEventListener('click', async () => {
  try { await chrome.tabs.create({ url: `${localEndpoint($('endpoint').value.trim())}/#knowledge-collector` }); }
  catch (error) { $('status').textContent = error.message; }
});
$('form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const candidate = { endpoint: localEndpoint($('endpoint').value.trim()), key: $('key').value.trim() };
    await localRequest(candidate, 'health');
    await chrome.storage.local.set(candidate);
    $('status').textContent = '已连接并保存，正在打开搜索界面…';
    window.location.assign(chrome.runtime.getURL('search.html'));
  } catch (error) { $('status').textContent = error.message; }
  finally { button.disabled = false; }
});
