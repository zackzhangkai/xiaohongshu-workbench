/**
 * 消息序列化清理 —— 修正部分 OpenAI 兼容网关对空 tool_calls 的 400 拒绝。
 * 阿里云 compatible-mode 会拒绝携带空 tool_calls 数组的 assistant 消息
 * （"Empty tool_calls is not supported in message"），
 * 同时 content 为 null 的消息在部分实现里也会 400。
 * 这里在每次发请求前把历史消息清洗成最保守的合法形态。
 */
export function sanitizeMessages(messages) {
  return messages
    .map((m) => ({ ...m }))
    .filter((m) => {
      if (m.role !== 'assistant') return true;
      // 无内容且无有效工具调用的 assistant 消息对重放没有意义
      const hasText = typeof m.content === 'string' && m.content.length > 0;
      const hasCalls = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
      return hasText || hasCalls;
    })
    .map((m) => {
      // Local citation labels are UI metadata, not provider message parameters.
      delete m.context;
      delete m.imageStatus;
      if (m.content === null || m.content === undefined) {
        m.content = '';
      }
      if (Array.isArray(m.tool_calls)) {
        if (m.tool_calls.length === 0) {
          // 关键修复：删除空数组而不是发送 "tool_calls": []
          delete m.tool_calls;
        } else {
          m.tool_calls = m.tool_calls
            .map((c) => ({ ...c, type: c.type || 'function', function: { ...c.function } }))
            .filter((c) => c?.function?.name);
        }
      }
      return m;
    });
}
