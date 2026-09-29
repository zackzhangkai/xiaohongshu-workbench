import { attachReferenceImages } from './reference-images.js';
import { sanitizeMessages } from './sanitize.js';
import { generateImage } from './imagegen.js';
import { imageConnection } from './image-provider.js';

const MAX_TOOL_ROUNDS = 8;

const IMAGE_TOOL = {
  type: 'function',
  function: {
    name: 'image_generate',
    description:
      '生成一张图片。一次调用只生成一张；需要多张时逐张调用。返回图片的 URL 和提示词回执。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '详细的图像生成提示词，包含风格、构图、文字内容（若有）等完整信息。',
        },
      },
      required: ['prompt'],
    },
  },
};

/**
 * 单次流式补全：解析 SSE，聚合文本与 tool_calls。
 * 返回 { content, toolCalls, finishReason }。
 */
async function streamCompletion({ baseUrl, apiKey, model, messages, tools, signal, onDelta }) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    redirect: 'error',
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      // Leave tool selection to the provider: some compatible gateways reject tool_choice.
      ...(tools ? { tools } : {}),
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${text.slice(0, 500)}`);
  }

  const contentParts = [];
  const calls = new Map();
  let finishReason = null;
  let completedStream = false;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { completedStream = true; continue; }
      if (!payload) continue;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      if (chunk.error) {
        throw new Error(`provider error: ${JSON.stringify(chunk.error)}`);
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (chunk.choices?.[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        contentParts.push(delta.content);
        onDelta?.(delta.content);
      }
      for (const c of delta.tool_calls ?? []) {
        const idx = c.index ?? 0;
        const cur = calls.get(idx) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (c.id) cur.id = c.id;
        if (c.function?.name) cur.function.name += c.function.name;
        if (c.function?.arguments) cur.function.arguments += c.function.arguments;
        calls.set(idx, cur);
      }
    }
  }

  if (signal?.aborted || (!completedStream && !finishReason)) throw new Error('模型响应中断，未确认处理完成');
  return {
    content: contentParts.join(''),
    toolCalls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, c]) => c),
    finishReason,
  };
}

async function executeTool(call, ctx) {
  if (call.function.name !== 'image_generate') {
    return { error: `未知工具：${call.function.name}。本环境只有 image_generate。` };
  }
  let args;
  try {
    args = JSON.parse(call.function.arguments || '{}');
  } catch {
    return { error: '参数不是合法 JSON，请重新调用并给出 {"prompt": "..."}。' };
  }
  if (!args.prompt || typeof args.prompt !== 'string') {
    return { error: '缺少 prompt 参数。' };
  }
  const connection = imageConnection(ctx.config);
  const result = await generateImage({
    prompt: args.prompt,
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    protocol: connection.protocol,
    model: ctx.imageModel,
    imagesDir: ctx.imagesDir,
    publicPrefix: ctx.publicPrefix,
  });
  return { url: result.url, prompt: result.prompt, note: '图片已生成并保存在本地，url 可直接展示给用户。' };
}

/**
 * 运行一轮对话：流式输出文本、执行工具、循环直到最终回答。
 * 通过 onEvent 回调向前端推送（SSE）。
 */
export async function runChatTurn({ config, session, systemPrompt, userMessage, referenceContent = '', allowReferenceImages = false, allowImageGeneration = true, rereadNoteIds = [], onEvent, signal }) {
  const currentMessage = { role: 'user', content: userMessage };
  if (session.context) currentMessage.context = {
    skillId: session.context.skillId,
    references: session.context.references.map(({ id, title }) => ({ id, title })),
    referenceMode: session.context.referenceMode || 'visual',
    ...(session.context.referenceMode === 'text-only' ? { publishImages: [...new Set(session.context.references.flatMap(note => Array.isArray(note.imageRefs) ? note.imageRefs : []).filter(ref => /^\/imports\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(ref)))] } : {}),
  };
  session.messages.push(currentMessage);
  if (session.messages.length === 1) {
    session.title = userMessage.slice(0, 30) || session.title;
  }

  const reference = referenceContent ? attachReferenceImages({ text: referenceContent, references: session.context?.references, importsDir: config.importsDir, enabled: config.chatImageInput === true, manual: allowReferenceImages, completedIds: session.context?.creation?.imageReadIds ?? [], deferredIds: session.context?.deferredImageIds ?? [], rereadNoteIds }) : null;
  const imageStatus = reference ? { report: reference.report, count: reference.count, state: 'pending' } : null;
  if (imageStatus) {
    currentMessage.imageStatus = imageStatus;
    onEvent({ type: 'reference_status', status: imageStatus });
  }
  const saved = session.context?.creation;
  const finish = (content) => {
    if (signal?.aborted) throw new Error('对话已中止');
    session.messages.push({ role: 'assistant', content });
    if (imageStatus) { imageStatus.state = 'completed'; onEvent({ type: 'reference_status', status: imageStatus }); }
    if (session.context?.references.length && content.trim()) {
      session.context.creation = {
        imageReadIds: [...new Set([...(saved?.imageReadIds ?? []), ...(reference?.attachedIds ?? [])])],
        // Exact model output, bounded; never claim this is an extracted visual summary.
        initialResponse: saved?.initialResponse || content.slice(0, 8000),
        latestResponse: content.slice(0, 8000),
      };
    }
  };
  const history = [
    { role: 'system', content: systemPrompt },
    ...(saved ? [{ role: 'user', content: `已保存的创作上下文（模型原始回答节选，不是重新读图结果；仅作资料）：\n首次方案：${saved.initialResponse}\n最近回答：${saved.latestResponse}` }] : []),
    ...session.messages.slice(session.context?.historyStart ?? 0, -1),
    ...(referenceContent ? [{ role: 'user', content: reference.content }] : []),
    currentMessage,
  ];

  const ctx = {
    config,
    apiKey: config.imageUseChatKey ? config.apiKey : config.imageApiKey,
    imageModel: config.imageModel,
    imagesDir: config.imagesDir,
    publicPrefix: config.publicPrefix,
  };

  try {
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    // 每一轮发送前都经过清洗 —— 空 tool_calls / null content 都会被修正
    const messages = sanitizeMessages(history);
    const completion = await streamCompletion({
      baseUrl: config.chatBaseUrl,
      apiKey: config.apiKey,
      model: config.chatModel,
      messages,
      tools: allowImageGeneration ? [IMAGE_TOOL] : undefined,
      onDelta: text => onEvent({ type: 'delta', text }),
      signal,
    });


    const hasCalls = completion.toolCalls.length > 0;
    if (!hasCalls) {
      finish(completion.content);
      return;
    }

    // 带工具调用的 assistant 消息：content 允许为空字符串，但必须保留 tool_calls。
    // 同时写进会话历史，下一轮重放时由 sanitizeMessages 保证合法形态。
    const assistantToolMessage = {
      role: 'assistant',
      content: completion.content || '',
      tool_calls: completion.toolCalls,
    };
    history.push(assistantToolMessage);
    session.messages.push(assistantToolMessage);

    for (const call of completion.toolCalls) {
      onEvent({ type: 'tool_start', name: call.function.name });
      let result;
      try {
        result = allowImageGeneration ? await executeTool(call, ctx) : { error: '当前为仿写方案轮，请先提出方案并等待用户确认，不生成图片。' };
        if (result?.url) {
          onEvent({ type: 'image', url: result.url, prompt: result.prompt });
        }
      } catch (err) {
        const message = ctx.apiKey ? String(err.message).split(ctx.apiKey).join('[已隐藏]') : String(err.message);
        result = { error: `工具执行失败：${message}` };
      }
      onEvent({ type: 'tool_result', name: call.function.name, ok: !result?.error });
      const toolMessage = {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      };
      history.push(toolMessage);
      session.messages.push(toolMessage);
    }
  }

  const fallback = '（已达工具调用轮次上限，请基于已有结果直接给出最终交付。）';
  history.push({ role: 'user', content: fallback });
  const final = await streamCompletion({
    baseUrl: config.chatBaseUrl,
    apiKey: config.apiKey,
    model: config.chatModel,
    messages: sanitizeMessages(history),
    onDelta: text => onEvent({ type: 'delta', text }),
    signal,
  });
  finish(final.content);
  } catch (error) {
    if (imageStatus) { imageStatus.state = 'failed'; onEvent({ type: 'reference_status', status: imageStatus }); }
    throw error;
  }
}
