import { searchPage } from './search-page.js';
import { SEARCH_ORIGIN, searchSpec, noteLink, rankResults, selectBatch, sameNotePath } from './search-core.js';
import { extractNote } from './extract.js';
import { knowledgeNoteUrl, localRequest } from './transport.js';

export const taskStatus = value => chrome.storage.local.set({ discoveryStatus: { ...value, updatedAt: Date.now() } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function newTask() { return { cancelled: false, tabId: null }; }
function check(task) { if (task.cancelled) throw new Error('任务已停止；已保存的笔记会保留'); }
async function permission() {
  if (!await chrome.permissions.contains({ origins: [SEARCH_ORIGIN] })) throw new Error('请点击搜索并授权访问小红书网站');
}
async function loaded(task, url) {
  const until = Date.now() + 25000;
  while (Date.now() < until) {
    check(task);
    const tab = await chrome.tabs.get(task.tabId);
    if (tab.status === 'complete') {
      const expected = new URL(url), actual = new URL(tab.url);
      if (actual.origin !== expected.origin || !sameNotePath(expected, actual)) throw new Error('页面发生跳转，请打开来源页检查登录或验证');
      return;
    }
    await sleep(500);
  }
  throw new Error('小红书页面加载超时，请重试');
}
async function page(task, func, args) {
  check(task);
  const results = await chrome.scripting.executeScript({ target: { tabId: task.tabId }, func, args });
  check(task);
  const result = results[0]?.result;
  if (!result) throw new Error('页面读取未返回结果，请重试');
  return result;
}
export async function runSearch(message, task) {
  const spec = searchSpec(message.topic, message.contentType);
  await permission();
  check(task);
  const runId = crypto.randomUUID();
  await chrome.storage.local.set({ discoveryResult: null, batchResults: {} });
  await chrome.storage.session.remove('discoveryLinks');
  await taskStatus({ state: 'running', kind: 'search', message: `搜索「${spec.topic}」：读取最多点赞的候选笔记…` });
  check(task);
  task.tabId = (await chrome.tabs.create({ url: spec.url, active: false })).id;
  await loaded(task, spec.url);
  const result = await page(task, searchPage, [spec.topic, spec.type]);
  if (result.error) throw new Error(result.error);
  const ranked = rankResults(result.candidates, spec.type);
  check(task);
  // Signed navigation URLs remain only in browser session storage, never the KB/export.
  await chrome.storage.session.set({ discoveryLinks: { runId, links: Object.fromEntries(ranked.items.map(item => [item.id, item.url])) } });
  await chrome.storage.local.set({ discoveryResult: { ...ranked, items: ranked.items.map(({ url, ...item }) => item),
    runId, topic: spec.topic, type: spec.type, searchedAt: Date.now(), platformSort: result.platformSort } });
  await taskStatus({ state: 'done', kind: 'search', message: `搜索完成：${ranked.candidateCount} 篇候选，列出 ${ranked.items.length} 篇。点赞数缺失的 ${ranked.unknownLikes} 篇未参与排名。` });
  await chrome.tabs.remove(task.tabId).catch(() => {}); task.tabId = null;
}

export async function openResult(id) {
  const { discoveryResult: result } = await chrome.storage.local.get('discoveryResult');
  const item = result?.items.find(item => item.id === id);
  if (!item) throw new Error('结果已更新，请重新选择');
  const { discoveryLinks } = await chrome.storage.session.get('discoveryLinks');
  const url = discoveryLinks?.runId === result.runId ? discoveryLinks.links[id] : item.sourceUrl;
  await chrome.tabs.create({ url: noteLink(url, id).url });
}

export async function runBatch(message, task, savePayload) {
  await permission();
  const { discoveryResult: result, batchResults = {} } = await chrome.storage.local.get(['discoveryResult', 'batchResults']);
  if (result?.runId !== message.runId) throw new Error('搜索结果已更新，请重新选择');
  const items = selectBatch(result, message.ids);
  const { discoveryLinks } = await chrome.storage.session.get('discoveryLinks');
  if (discoveryLinks?.runId !== result.runId) throw new Error('本次搜索链接已过期，请重新搜索后入库');
  const settings = await chrome.storage.local.get(['endpoint', 'key']);
  await localRequest(settings, 'health');
  let failed = 0, succeeded = 0, firstSavedNoteId = null, keepSourceOpen = false;
  try {
    for (let i = 0; i < items.length; i++) {
      check(task);
      const item = items[i];
      const update = message => taskStatus({ state: 'running', kind: 'batch', message: `${i + 1}/${items.length} · ${item.title}\n${message}` });
      await update('正在打开详情…');
      batchResults[item.id] = { state: 'running', message: '读取详情…' };
      await chrome.storage.local.set({ batchResults });
      try {
        const url = noteLink(discoveryLinks.links[item.id], item.id).url;
        if (task.tabId === null) task.tabId = (await chrome.tabs.create({ url, active: false })).id;
        else await chrome.tabs.update(task.tabId, { url });
        await loaded(task, url);
        let payload;
        for (let attempt = 0; attempt < 12; attempt++) {
          payload = await page(task, extractNote, [message.includeComments === true]);
          if (payload.noteId || /登录或验证|视频下载尚未接入/.test(payload.error || '')) break;
          await sleep(800);
        }
        if (payload?.error) throw new Error(payload.error);
        if (payload?.noteId !== item.id) throw new Error('详情身份与所选笔记不一致，未入库');
        check(task);
        const saved = await savePayload(payload, settings, update, () => check(task));
        succeeded++;
        firstSavedNoteId ||= saved.noteId;
        batchResults[item.id] = { state: 'done', noteId: saved.noteId, message: `${saved.duplicate ? '已合并' : '已保存'} · ${saved.images} 张图片`, warnings: saved.warnings };
      } catch (error) {
        failed++;
        batchResults[item.id] = { state: 'error', message: error.message };
        await chrome.storage.local.set({ batchResults });
        if (task.cancelled || /登录或验证|无法连接|配对码|页面发生跳转/.test(error.message)) {
          keepSourceOpen = /登录或验证|页面发生跳转/.test(error.message);
          if (keepSourceOpen && task.tabId !== null) await chrome.tabs.update(task.tabId, { active: true }).catch(() => {});
          throw error;
        }
      }
      await chrome.storage.local.set({ batchResults });
      if (i < items.length - 1) await sleep(1200);
    }
    await taskStatus({ state: failed ? 'partial' : 'done', kind: 'batch', message: `入库结束：成功 ${succeeded} 篇，失败 ${failed} 篇。失败项可重新勾选重试。` });
    if (firstSavedNoteId) {
      try { await chrome.tabs.create({ url: knowledgeNoteUrl(settings, firstSavedNoteId), active: true }); }
      catch { await taskStatus({ state: failed ? 'partial' : 'done', kind: 'batch', message: `入库结束：成功 ${succeeded} 篇，失败 ${failed} 篇。未能自动打开工作台，请点击右上角「打开知识库」。` }); }
    }
  } finally {
    if (task.tabId !== null && !keepSourceOpen) { await chrome.tabs.remove(task.tabId).catch(() => {}); task.tabId = null; }
  }
}
