import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listSkills } from './skills.js';
import { prepareChatContext, ChatContextError } from './chat-context.js';
import { SessionStore } from './sessions.js';
import { importDocument, DocumentImportError } from './document-import.js';
import { VideoRenderer } from './video-render.js';
import { VoiceService } from './voice.js';
import { TranscriptionService } from './transcription.js';
import { ProfileStore, profilePrompt } from './profile.js';
import { FeedStore } from './feeds.js';
import { Scheduler, ScheduleError } from './scheduler.js';
import { NoteStore } from './notes.js';
import { createCollector } from './collector.js';
import { ManuscriptStore, ManuscriptError, collectSessionImages } from './manuscripts.js';
import { createZipBuffer } from './zip.js';
import { exportEntries, materializeExport, safeFileName } from './manuscript-export.js';
import { noteExportEntries } from './note-export.js';
import { publishableDraft } from './manuscript-content.js';
import { testVisionConnection } from './vision-test.js';
import { runChatTurn } from './chat.js';
import { generateImage } from './imagegen.js';
import { imageConnection, discoverImageModels, imageError } from './image-provider.js';
import { createConfigStore, configCandidate, discoverProviderModels, testAndSaveChatConfig, turnModelConfig, ConfigError } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(rootDir, 'data');
const imagesDir = path.join(dataDir, 'images');
fs.mkdirSync(imagesDir, { recursive: true });

const configStore = createConfigStore(path.join(dataDir, 'model-config.json'));
const skillsDir = path.join(rootDir, 'skills');
const sessions = new SessionStore(dataDir);
const notes = new NoteStore(dataDir);
const profile = new ProfileStore(dataDir);
const manuscripts = new ManuscriptStore(path.join(dataDir, 'manuscripts'));
const manuscriptExportsDir = path.join(dataDir, 'exports', 'manuscripts');
const app = express();
app.use('/api/collector', createCollector({ dataDir, notes }));
app.use(express.json({ limit: '2mb' }));
app.use('/images', express.static(imagesDir));
app.use('/imports', express.static(path.join(dataDir, 'imports'), { dotfiles: 'deny' }));

app.get('/api/skills', (_req, res) => {
  res.json({ skills: listSkills(skillsDir) });
});

// Local model settings never return stored credentials.
app.use('/api/config', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  const host = req.hostname;
  const origin = req.get('origin');
  let sameOrigin = true;
  try { if (origin) sameOrigin = new URL(origin).host === req.get('host'); } catch { sameOrigin = false; }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host) || !sameOrigin || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: '模型配置仅允许从本机工作台访问' });
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: '配置请求必须使用 JSON' });
  next();
});
app.get('/api/config', (_req, res) => res.json(configStore.public()));
app.put('/api/config', (req, res) => {
  try { res.json(configStore.save(req.body)); }
  catch (e) { res.status(e instanceof ConfigError ? 400 : 500).json({ error: e.message }); }
});
app.post('/api/config/models', async (req, res) => {
  try { res.json(await discoverProviderModels(configCandidate(configStore.get(), req.body), req.body.providerId)); }
  catch (e) { res.status(400).json({ error: e instanceof ConfigError ? e.message : '模型目录读取失败' }); }
});
app.post('/api/config/test', async (req, res) => {
  try { res.json(await testAndSaveChatConfig(configStore, req.body)); }
  catch (e) { res.status(e instanceof ConfigError ? 400 : 500).json({ error: e instanceof ConfigError ? e.message : '连接测试失败' }); }
});

app.post('/api/config/test-vision', async (req, res) => {
  try {
    const candidate = configCandidate(configStore.get(), req.body);
    if (!candidate.chatModel || !candidate.chatBaseUrl) throw new ConfigError('请先配置对话与智能体的供应商和模型');
    const result = await testVisionConnection(candidate);
    configStore.recordVisionTest(candidate, result);
    res.json(result);
  } catch (e) { res.status(400).json({ error: e instanceof ConfigError ? e.message : '视觉测试记录保存失败' }); }
});

app.post('/api/config/image-models', async (req, res) => {
  try { res.json(await discoverImageModels(configCandidate(configStore.get(), req.body))); }
  catch (e) { res.status(400).json({ error: imageError(e) }); }
});
let imageTestRunning = false;
app.post('/api/config/test-image', async (req, res) => {
  if (imageTestRunning) return res.status(409).json({ error: '已有一张测试图正在生成，请等待完成' });
  imageTestRunning = true;
  const started = Date.now();
  try {
    const candidate = configCandidate(configStore.get(), req.body);
    const connection = imageConnection(candidate);
    const result = await generateImage({ ...connection, model: candidate.imageModel, prompt: '一张简洁的测试插画：奶油色背景上一只可爱的河狸，旁边放着一片绿色叶子，无文字，方形构图。', imagesDir });
    const receipt = { ok: true, model: candidate.imageModel, url: result.url, testedAt: new Date().toISOString(), latencyMs: Date.now() - started };
    try { configStore.recordImageTest(candidate, receipt); }
    catch { receipt.warning = '图片已生成，但测试记录未能保存'; }
    res.json(receipt);
  } catch (e) { res.status(400).json({ error: imageError(e) }); }
  finally { imageTestRunning = false; }
});

app.get('/api/sessions', (_req, res) => {
  res.json({ sessions: sessions.list() });
});

app.post('/api/sessions', (req, res) => {
  res.json(sessions.create(req.body?.title));
});

app.get('/api/sessions/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  res.json(session);
});

app.post('/api/chat', async (req, res) => {
  const { sessionId, message } = req.body ?? {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message 不能为空' });
  }
  const session = sessionId ? sessions.get(sessionId) : null;
  if (!session) {
    return res.status(404).json({ error: 'session 不存在，请先创建会话' });
  }

  let selectedConfig;
  try { selectedConfig = turnModelConfig(configStore.get(), req.body.modelSelections); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  let prepared;
  try { prepared = prepareChatContext({ session, input: req.body, notes, skillsDir }); }
  catch (e) { return res.status(e instanceof ChatContextError ? e.status : 500).json({ error: e.message }); }
  session.context = prepared.context;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'done' || event.type === 'error') {
      sessions.save(session);
      res.end();
    }
  };

  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });
  send({ type: 'meta', sessionId: session.id });

  const turnConfig = { ...selectedConfig, imagesDir, importsDir: path.join(dataDir, 'imports'), publicPrefix: '/images' };
  try {
    if (!turnConfig.chatModel || !turnConfig.chatBaseUrl) throw new ConfigError('请先配置对话与智能体的供应商和模型');
    await runChatTurn({
      config: turnConfig,
      session,
      systemPrompt: [prepared.systemPrompt, profilePrompt(profile.get())].filter(Boolean).join('\n\n'),
      referenceContent: prepared.referenceContent,
      allowReferenceImages: prepared.allowReferenceImages,
      rereadNoteIds: prepared.rereadNoteIds,
      allowImageGeneration: prepared.allowImageGeneration,
      userMessage: message.trim(),
      onEvent: send,
      signal: abort.signal,
    });
    send({ type: 'done' });
  } catch (err) {
    let message = String(err.message);
    for (const key of [turnConfig.apiKey, turnConfig.imageApiKey].filter(Boolean)) message = message.split(key).join('[已隐藏]');
    send({ type: 'error', message });
  }
});

// Editable manuscripts are stored separately from imported knowledge.
app.get('/api/manuscripts', (_req, res) => res.json({ manuscripts: manuscripts.list() }));
app.post('/api/manuscripts', (req, res) => {
  const { title = '未命名稿件', content = '' } = req.body ?? {};
  if (typeof title !== 'string' || typeof content !== 'string') return res.status(400).json({ error: '标题和正文必须是文字' });
  res.status(201).json(manuscripts.create({ title, content }));
});
app.post('/api/manuscripts/from-message', (req, res) => {
  const { sessionId, messageIndex } = req.body ?? {};
  if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/.test(sessionId) || !Number.isInteger(messageIndex) || messageIndex < 0) return res.status(400).json({ error: '对话消息引用无效' });
  const session = sessions.get(sessionId);
  const message = session?.messages[messageIndex];
  if (message?.role !== 'assistant' || !message.content?.trim()) return res.status(400).json({ error: '仅支持保存有正文的 AI 回复' });
  const source = `chat:${sessionId}:${messageIndex}`;
  const images = collectSessionImages(session.messages, messageIndex);
  // Prefer the labelled publishable copy over the raw reply when one exists.
  const draft = publishableDraft(message.content);
  const existing = manuscripts.list().find(item => item.source === source);
  if (existing) {
    // Re-saving an untouched raw draft upgrades it to the extracted copy;
    // drafts edited in the manuscript page keep their edited text.
    if (draft && existing.content === message.content) {
      manuscripts.attachImages(existing.id, images); // backfill first: no revision bump, never overwrites
      try { return res.json(manuscripts.update(existing.id, { title: draft.title || existing.title, content: draft.content }, existing.revision)); }
      catch (e) { if (e instanceof ManuscriptError && e.status === 409) return res.json(existing); throw e; }
    }
    return res.json(manuscripts.attachImages(existing.id, images));
  }
  res.status(201).json(manuscripts.create({ title: draft?.title || session.title || '对话稿件', content: draft ? draft.content : message.content, source, images }));
});

app.patch('/api/manuscripts/:id', (req, res) => {
  const { title, content } = req.body ?? {};
  if (typeof title !== 'string' || typeof content !== 'string') return res.status(400).json({ error: '标题和正文必须是文字' });
  try { res.json(manuscripts.update(req.params.id, { title, content }, req.body.revision)); }
  catch (e) { res.status(e instanceof ManuscriptError ? e.status : 500).json({ error: e instanceof ManuscriptError ? e.message : '稿件保存失败，未确认保存成功，请保留当前编辑内容' }); }
});
app.get('/api/manuscripts/:id/versions', (req, res) => {
  try { res.json({ versions: manuscripts.versions(req.params.id) }); }
  catch (e) { res.status(e instanceof ManuscriptError ? e.status : 500).json({ error: '无法读取稿件历史版本' }); }
});
app.post('/api/manuscripts/:id/restore', (req, res) => {
  try { res.json(manuscripts.restore(req.params.id, req.body?.versionId, req.body?.revision)); }
  catch (e) { res.status(e instanceof ManuscriptError ? e.status : 500).json({ error: e instanceof ManuscriptError ? e.message : '恢复失败，请保留当前内容' }); }
});
app.get('/api/manuscripts/:id/zip', (req, res) => {
  let item = null;
  try { item = manuscripts.get(req.params.id); } catch { /* invalid id means no manuscript */ }
  if (!item) return res.status(404).json({ error: '稿件不存在' });
  const name = safeFileName(item.title);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="manuscript.zip"; filename*=UTF-8''${encodeURIComponent(name)}.zip`);
  res.send(createZipBuffer(exportEntries(item, imagesDir, path.join(dataDir, 'imports'))));
});
app.post('/api/manuscripts/:id/reveal', (req, res) => {
  let item = null;
  try { item = manuscripts.get(req.params.id); } catch { /* invalid id means no manuscript */ }
  if (!item) return res.status(404).json({ error: '稿件不存在' });
  if (process.platform !== 'darwin') return res.status(400).json({ error: '仅在 macOS 上支持打开 Finder，可改用下载 ZIP 包' });
  const folder = materializeExport(item, imagesDir, manuscriptExportsDir, path.join(dataDir, 'imports'));
  const opened = spawnSync('open', ['-R', folder], { timeout: 5000 });
  if (opened.error || opened.status !== 0) return res.status(500).json({ error: '打开 Finder 失败，请改用下载 ZIP 包' });
  res.json({ folder });
});

const scheduler = new Scheduler({ dataDir, execute: async (task) => {
  const session = sessions.create(task.title);
  const config = { ...configStore.get(), imagesDir, publicPrefix: '/images' };
  try {
    const prepared = prepareChatContext({ session, input: {}, notes, skillsDir });
    if (!config.chatModel || !config.chatBaseUrl) throw new ConfigError('请先配置对话与智能体的供应商和模型');
    await runChatTurn({ config, session, systemPrompt: [prepared.systemPrompt, profilePrompt(profile.get())].filter(Boolean).join('\n\n'), userMessage: task.prompt,
      allowReferenceImages: false, allowImageGeneration: false, onEvent: () => {}, signal: AbortSignal.timeout(300000) });
    sessions.save(session);
    return { sessionId: session.id };
  } catch (error) {
    sessions.save(session);
    let message = String(error.message);
    for (const key of [config.apiKey, config.imageApiKey].filter(Boolean)) message = message.split(key).join('[已隐藏]');
    throw Object.assign(new Error(message), { sessionId: session.id });
  }
} });
scheduler.start();
app.get('/api/schedules', (_req, res) => res.json({ tasks: scheduler.list() }));
app.post('/api/schedules', (req, res) => {
  try { res.status(201).json(scheduler.create(req.body ?? {})); }
  catch (e) { res.status(e instanceof ScheduleError ? 400 : 500).json({ error: e.message }); }
});
app.patch('/api/schedules/:id', (req, res) => {
  try { res.json(scheduler.update(req.params.id, req.body ?? {})); }
  catch (e) { res.status(e instanceof ScheduleError ? 400 : 500).json({ error: e.message }); }
});
app.post('/api/schedules/:id/run', (req, res) => {
  try {
    const task = scheduler.get(req.params.id);
    if (task.status === 'running') return res.status(409).json({ error: '任务已经在执行' });
    scheduler.run(task.id).catch(e => console.error('[scheduler]', e.message));
    res.status(202).json({ accepted: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

const feeds = new FeedStore(dataDir);
app.get('/api/feeds', (_req, res) => {
  try { res.json({ sources: feeds.list() }); }
  catch { res.status(500).json({ error: '读取资讯缓存失败' }); }
});
app.post('/api/feeds/:id/refresh', async (req, res) => {
  try { res.json(await feeds.refresh(req.params.id)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/feeds/:id/save', (req, res) => {
  try {
    const item = feeds.list().flatMap(s => s.items).find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ error: '资讯不存在，请刷新来源' });
    const source = `feed:${item.id}`;
    const existing = notes.list().find(n => n.source === source);
    if (existing) return res.json(existing);
    res.status(201).json(notes.create({ title: item.title, summary: item.summary.slice(0, 200),
      content: `${item.summary}\n\n来源：${item.sourceName}\n原文：${item.url}\n发布时间：${item.publishedAt}\n\n以上为订阅源摘要，未抓取完整文章。`, tags: ['资讯', item.sourceName], source }));
  } catch { res.status(500).json({ error: '保存资讯失败' }); }
});

app.get('/api/profile', (_req, res) => {
  try { res.json(profile.get()); } catch { res.status(500).json({ error: '账号资料读取失败' }); }
});
app.put('/api/profile', (req, res) => {
  try { res.json(profile.save(req.body ?? {})); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/notes/import-document', (req, res) => {
  try { const result = importDocument(notes, req.body); res.status(result.status === 'imported' ? 201 : 200).json(result); }
  catch (e) { res.status(e instanceof DocumentImportError ? 400 : 500).json({ error: e instanceof DocumentImportError ? e.message : '文档保存失败，请重试' }); }
});

const voiceService = new VoiceService(dataDir);
app.get('/api/voice/voices', async (_req, res) => {
  try { res.json({ voices: await voiceService.voices() }); } catch { res.status(503).json({ error: '本地系统语音不可用，此功能需要 macOS 的 say 命令' }); }
});
app.get('/api/voice', (_req, res) => res.json({ items: voiceService.list() }));
app.post('/api/voice', async (req, res) => {
  try { res.status(202).json(await voiceService.create(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/audio/:name', (req, res) => {
  if (!/^[0-9a-f-]{36}\.wav$/.test(req.params.name)) return res.sendStatus(404);
  res.sendFile(path.join(dataDir, 'audio', req.params.name));
});

const videoRenderer = new VideoRenderer(dataDir);
const transcription = new TranscriptionService(dataDir);
app.use('/api/transcriptions', (req, res, next) => {
  try { if (req.get('origin') && new URL(req.get('origin')).host !== req.get('host')) return res.sendStatus(403); } catch { return res.sendStatus(403); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname) || req.get('sec-fetch-site') === 'cross-site') return res.sendStatus(403);
  next();
});
app.get('/api/transcriptions', (_req, res) => res.json({ ready: transcription.ready(), items: transcription.list() }));
app.post('/api/transcriptions', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  try { res.status(202).json(await transcription.create(req.body, req.query.name)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/transcriptions/:id/save', (req, res) => {
  try {
    const item = transcription.get(req.params.id);
    if (item.status !== 'completed' || !item.text) return res.status(400).json({ error: '转写尚未完成或没有识别到文字' });
    const source = `transcription:${item.id}`, existing = notes.list().find(n => n.source === source);
    res.json(existing || notes.create({ title: item.name, content: item.text, source, tags: ['本地转写'] }));
  } catch { res.status(400).json({ error: '读取转写记录失败' }); }
});
app.use('/api/transcriptions', (error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type === 'entity.too.large' ? '音视频不能超过 100MB' : '转写请求处理失败' }));
app.use('/api/renders', (req, res, next) => {
  const origin = req.get('origin');
  try { if (origin && new URL(origin).host !== req.get('host')) return res.sendStatus(403); } catch { return res.sendStatus(403); }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname) || req.get('sec-fetch-site') === 'cross-site') return res.sendStatus(403);
  next();
});
app.get('/api/renders', (_req, res) => res.json({ items: videoRenderer.list() }));
app.post('/api/renders/upload', express.raw({ type: 'application/octet-stream', limit: '100mb' }), async (req, res) => {
  try { res.status(201).json(await videoRenderer.upload(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/renders/:id/start', async (req, res) => {
  try { res.status(202).json(await videoRenderer.start(req.params.id, req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.use('/api/renders', (error, _req, res, _next) => res.status(error.status || 500).json({ error: error.type === 'entity.too.large' ? '视频不能超过 100MB' : '视频请求处理失败' }));
app.get('/renders/:name', (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}\.mp4$/.test(req.params.name)) return res.sendStatus(404);
    const id = req.params.name.slice(0, -4);
    if (videoRenderer.get(id).status !== 'completed') return res.sendStatus(404);
    res.sendFile(path.join(videoRenderer.folder(id), 'result.mp4'));
  } catch { res.sendStatus(404); }
});

// ---- 知识库笔记 CRUD ----
app.get('/api/notes', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ notes: notes.list() });
});

app.post('/api/notes', (req, res) => {
  const { title, summary, content, tags, source } = req.body ?? {};
  res.status(201).json(notes.create({ title, summary, content, tags, source }));
});

app.get('/api/notes/:id', (req, res) => {
  const note = notes.get(req.params.id);
  if (!note) return res.status(404).json({ error: 'note not found' });
  res.json(note);
});

app.get('/api/notes/:id/zip', (req, res) => {
  const note = notes.get(req.params.id);
  if (!note) return res.status(404).json({ error: '笔记不存在' });
  try {
    const name = safeFileName(note.title);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="knowledge-note.zip"; filename*=UTF-8''${encodeURIComponent(name)}.zip`);
    res.send(createZipBuffer(noteExportEntries(note, path.join(dataDir, 'imports'))));
  } catch (error) { res.status(409).json({ error: error.message }); }
});

app.patch('/api/notes/:id', (req, res) => {
  const note = notes.update(req.params.id, req.body ?? {});
  if (!note) return res.status(404).json({ error: 'note not found' });
  res.json(note);
});

app.delete('/api/notes/:id', (req, res) => {
  res.json({ deleted: notes.delete(req.params.id) });
});

// ---- 资产库：已生成图片列表 ----
app.get('/api/assets', (_req, res) => {
  const files = fs
    .readdirSync(imagesDir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .map((f) => {
      const stat = fs.statSync(path.join(imagesDir, f));
      return { name: f, url: `/images/${f}`, size: stat.size, createdAt: stat.birthtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ assets: files });
});

// 静态前端（vite build 产物）；开发模式下由 vite dev server 代理 /api
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|images).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const port = Number(process.env.PORT || 8787);
app.listen(port, '127.0.0.1', () => {
  console.log(`[workbench] http://localhost:${port}`);
  console.log('[workbench] 模型配置可在工作台设置中修改');
});
