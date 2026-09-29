import { SEARCH_ORIGIN, TYPE_LABELS, searchSpec } from './search-core.js';
import { localEndpoint } from './transport.js';
const $ = id => document.getElementById(id);
let topics = [], result = null, batch = {}, busy = false, renderedKey = '';
const selected = new Set();
const error = value => { $('message').textContent = value || ''; };
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (reply?.error) throw new Error(reply.error);
  return reply;
}
function renderTopics() {
  $('topics').replaceChildren(...topics.map(topic => {
    const chip = node('span', '', 'topic-chip'), choose = node('button', topic), remove = node('button', '×');
    choose.type = remove.type = 'button'; remove.setAttribute('aria-label', `取消关注 ${topic}`);
    choose.onclick = () => { $('topic').value = topic; };
    remove.onclick = async () => { topics = topics.filter(t => t !== topic); await chrome.storage.local.set({ followedTopics: topics }); renderTopics(); };
    chip.append(choose, remove); return chip;
  }));
}
function selection() {
  const eligible = result?.items.filter(item => item.type === 'image' && batch[item.id]?.state !== 'done') || [];
  for (const id of selected) if (!eligible.some(item => item.id === id)) selected.delete(id);
  $('save-selected').textContent = `加入知识库（${selected.size}）`;
  $('save-selected').disabled = busy || !selected.size;
  $('select-all').disabled = busy || !eligible.length;
  $('select-all').checked = !!eligible.length && eligible.every(item => selected.has(item.id));
  $('select-all').indeterminate = selected.size > 0 && selected.size < eligible.length;
}
function renderResults() {
  const key = JSON.stringify([result, batch, busy]);
  if (key === renderedKey) { selection(); return; }
  renderedKey = key;
  $('result-section').hidden = !result;
  $('empty').hidden = !!result || busy;
  if (!result) { $('results').replaceChildren(); selection(); return; }
  $('result-title').textContent = `${result.topic} · ${TYPE_LABELS[result.type]} TOP ${result.items.length}`;
  $('scope').textContent = `${new Date(result.searchedAt).toLocaleString()} · 平台排序：${result.platformSort} · 读取 ${result.candidateCount} 篇候选 · ${result.unknownLikes} 篇点赞未知未排名 · ${result.unknownTypes} 篇类型待确认。不代表全平台绝对前十。`;
  $('results').replaceChildren(...result.items.map(item => {
    const card = node('article', '', 'result');
    if (item.cover) { const img = node('img', '', 'cover'); img.src = item.cover; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.loading = 'lazy'; card.append(img); }
    const body = node('div', '', 'result-body');
    body.append(node('div', `#${item.rank} · ${TYPE_LABELS[item.type]}`, 'result-top'), node('h3', item.title), node('p', item.author || '作者未提供'), node('p', `点赞 ${item.likesText}（约 ${item.likes.toLocaleString()}）`));
    const actions = node('div', '', 'result-actions');
    if (item.type === 'image') {
      const label = node('label'), box = node('input'); box.type = 'checkbox'; box.checked = selected.has(item.id); box.disabled = busy || batch[item.id]?.state === 'done'; box.setAttribute('aria-label', `选择 ${item.title}`);
      box.onchange = () => { if (box.checked) selected.add(item.id); else selected.delete(item.id); selection(); };
      label.append(box, document.createTextNode(' 入库')); actions.append(label);
    }
    const open = node('button', '查看原文'); open.onclick = () => send({ type: 'open-result', id: item.id }).catch(e => error(e.message)); actions.append(open); body.append(actions);
    if (batch[item.id]) {
      const saved = batch[item.id]; body.append(node('p', saved.message, saved.state === 'done' ? 'saved' : saved.state === 'error' ? 'failed' : ''));
      for (const warning of saved.warnings || []) body.append(node('p', warning, 'failed'));
    }
    card.append(body); return card;
  }));
  if (!result.items.length) $('results').append(node('p', '没有可排名的结果。可换个主题或类型；若出现登录验证，请完成后重新搜索。'));
  selection();
}
async function refresh() {
  const data = await chrome.storage.local.get(['discoveryStatus', 'discoveryResult', 'batchResults']);
  const current = data.discoveryStatus;
  busy = current?.state === 'running';
  if (result?.runId !== data.discoveryResult?.runId) selected.clear();
  result = data.discoveryResult; batch = data.batchResults || {};
  $('job-status').textContent = current?.message || '';
  $('search').disabled = busy; $('content-type').disabled = busy; $('stop').hidden = !busy;
  renderResults();
}
$('follow').onclick = async () => {
  try {
    const { topic } = searchSpec($('topic').value);
    if (!topics.includes(topic)) {
      if (topics.length >= 30) throw new Error('最多关注 30 个主题，请先移除不需要的主题');
      topics.push(topic); await chrome.storage.local.set({ followedTopics: topics }); renderTopics();
    }
    error('');
  } catch (e) { error(e.message); }
};
$('search-form').onsubmit = async event => {
  event.preventDefault(); error('');
  try {
    const spec = searchSpec($('topic').value, $('content-type').value);
    // Request optional host access only in the user's search click gesture.
    if (!await chrome.permissions.request({ origins: [SEARCH_ORIGIN] })) throw new Error('未授权小红书访问，未开始搜索');
    await send({ type: 'search', topic: spec.topic, contentType: spec.type }); await refresh();
  } catch (e) { error(e.message); }
};
$('stop').onclick = () => send({ type: 'stop' }).catch(e => error(e.message));
$('select-all').onchange = () => {
  selected.clear();
  if ($('select-all').checked) for (const item of result.items) if (item.type === 'image' && batch[item.id]?.state !== 'done') selected.add(item.id);
  renderedKey = ''; renderResults();
};
$('save-selected').onclick = async () => {
  error('');
  try { await send({ type: 'batch', ids: [...selected], runId: result.runId, includeComments: $('comments').checked }); await refresh(); }
  catch (e) { error(e.message); }
};
$('settings').onclick = () => chrome.runtime.openOptionsPage();
$('workspace').onclick = async () => {
  try { await chrome.tabs.create({ url: localEndpoint((await chrome.storage.local.get('endpoint')).endpoint) }); } catch(e) { error(e.message); }
};
topics = (await chrome.storage.local.get('followedTopics')).followedTopics || [];
renderTopics(); await send({ type: 'sync-status' }); await refresh();
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.discoveryStatus || changes.discoveryResult || changes.batchResults)) void refresh(); });
setInterval(() => { void send({ type: 'sync-status' }).then(refresh).catch(e => error(e.message)); }, 5000);
