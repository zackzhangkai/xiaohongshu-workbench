import { extractNote } from './extract.js';
import { localRequest, downloadImage } from './transport.js';
import { newTask, runSearch, runBatch, taskStatus, openResult } from './discovery.js';

let running = false;
let task = null;
const status = value => chrome.storage.local.set({ captureStatus: { ...value, updatedAt: Date.now() } });
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !['popup.html', 'search.html'].some(file => sender.url === chrome.runtime.getURL(file))) return;
  if (message?.type === 'sync-status') {
    if (!running) void chrome.storage.local.get(['discoveryStatus', 'batchResults']).then(async data => {
      if (!running && data.discoveryStatus?.state === 'running') {
        const results = data.batchResults || {};
        for (const item of Object.values(results)) if (item.state === 'running') { item.state = 'error'; item.message = '任务中断，可重试（自动去重）'; }
        await chrome.storage.local.set({ batchResults: results });
        await taskStatus({ state: 'error', message: '上次任务已中断，请重试；重复入库会去重' });
      }
    });
    respond({ running }); return;
  }
  if (message?.type === 'stop') {
    if (task) { task.cancelled = true; if (task.tabId !== null) void chrome.tabs.remove(task.tabId).catch(() => {}); }
    respond({ stopped: true }); return;
  }
  if (message?.type === 'open-result') {
    void openResult(message.id).then(() => respond({ ok: true })).catch(error => respond({ error: error.message })); return true;
  }
  if (!['capture', 'search', 'batch'].includes(message?.type)) return;
  if (running) { respond({ error: '已有采集或搜索任务正在执行' }); return; }
  running = true;
  const discovery = message.type !== 'capture';
  task = discovery ? newTask() : null;
  const currentTask = task;
  // Frequent extension API calls keep status current; interruption is recovered, never silently replayed.
  const heartbeat = discovery ? setInterval(() => { void chrome.storage.local.get('discoveryStatus'); }, 2000) : null;
  const job = message.type === 'capture' ? capture(message) : taskStatus({ state: 'running', kind: message.type, message: '正在准备任务…' }).then(() => message.type === 'search' ? runSearch(message, currentTask) : runBatch(message, currentTask, savePayload));
  void job.catch(async error => {
    if (discovery) {
      if (currentTask.tabId !== null) {
        if (currentTask.cancelled) await chrome.tabs.remove(currentTask.tabId).catch(() => {});
        else await chrome.tabs.update(currentTask.tabId, { active: true }).catch(() => {});
      }
      await taskStatus({ state: 'error', message: currentTask.cancelled ? '任务已停止；已保存的笔记会保留' : error.message || '任务失败，请重试' });
    }
    else await status({ state: 'error', message: error.message || '采集失败，请重试' });
  }).finally(() => { if (heartbeat) clearInterval(heartbeat); running = false; task = null; });
  respond({ started: true });
});

async function capture(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/www\.(xiaohongshu|rednote)\.com\//.test(tab.url || '')) throw new Error('请先打开小红书图文笔记，再点击插件');
  await status({ state: 'running', message: '检查工作台连接…' });
  const settings = await chrome.storage.local.get(['endpoint', 'key']);
  await localRequest(settings, 'health');
  await status({ state: 'running', message: '读取当前笔记…' });
  const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractNote, args: [message.includeComments === true] });
  const payload = results[0]?.result;
  if (payload?.error) throw new Error(payload.error);
  if (!payload?.noteId) throw new Error('页面读取未返回结果，请重新打开笔记详情；若仍失败，请在扩展管理页重新加载插件');
  const result = await savePayload(payload, settings, message => status({ state: 'running', message }));
  await status({ state: 'done', message: `${result.duplicate ? '已合并到已有笔记' : '已保存到知识库'} · ${result.images} 张图片 · ${result.comments} 条评论`, warnings: result.warnings });
}

async function savePayload(payload, settings, progress, check = () => {}) {
  const images = []; let total = 0;
  for (let i = 0; i < payload.imageUrls.length; i++) {
    check();
    await progress(`下载配图 ${i + 1}/${payload.imageUrls.length}…`);
    try {
      const image = await downloadImage(payload.imageUrls[i]);
      if (total + image.size > 24 * 1024 * 1024) throw new Error('图片总量超过 24MB');
      images.push(image.base64); total += image.size;
    } catch (error) { payload.warnings.push(`第 ${i + 1} 张图片未保存：${error.message}`); }
  }
  delete payload.imageUrls;
  check();
  await progress('保存到知识库并回读…');
  const result = await localRequest(settings, 'capture', { ...payload, images });
  return { ...result, warnings: [...result.warnings, ...(result.preserved.length ? ['已有手动编辑保留；最新采集快照可在知识库详情查看'] : [])] };
}
