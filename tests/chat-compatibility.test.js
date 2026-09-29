import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runChatTurn } from '../server/chat.js';

test('legacy 11 image calls get type on outgoing copy without re-executing or mutating history', async t => {
 const {requests,config}=await provider(t,()=>({content:'已恢复对话。'}));
 const legacy={role:'assistant',content:'',tool_calls:Array.from({length:11},(_,i)=>({id:`legacy${i}`,function:{name:'image_generate',arguments:'{"prompt":"do not execute"}'}}))};
 const session={messages:[{role:'user',content:'小红书'},legacy,...legacy.tool_calls.map(c=>({role:'tool',tool_call_id:c.id,content:JSON.stringify({url:'/images/existing.png'})}))]};
 const baseline=structuredClone(session.messages),events=[];
 await runChatTurn({config,session,userMessage:'完成了吗',systemPrompt:'test',onEvent:e=>events.push(e)});
 assert.equal(requests.length,1);
 const calls=requests[0].messages.find(m=>m.tool_calls)?.tool_calls;
 assert.equal(calls.length,11); assert.ok(calls.every(c=>c.type==='function'));
 assert.deepEqual(session.messages.slice(0,baseline.length),baseline);
 assert.ok(!events.some(e=>e.type==='tool_start'||e.type==='image'));
});

async function provider(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const body = JSON.parse(raw); requests.push(body);
    if ('tool_choice' in body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'auto does not support parameter(s): tool_choice; please remove them from your request' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: handler(body, requests.length) }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { requests, config: { chatBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, chatModel: 'auto', apiKey: 'mock-key' } };
}

test('note-based writing succeeds on a provider that rejects tool_choice', async (t) => {
  const { requests, config } = await provider(t, () => ({ content: '已根据参考笔记整理创作方向。' }));
  const session = { messages: [] };
  const message = '请根据以下素材开始创作：\n\n测试笔记\n把重复工作整理成步骤。';
  await runChatTurn({ config, session, userMessage: message, systemPrompt: '创作助手', onEvent() {} });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].messages.at(-1).content, message);
  assert.equal(requests[0].tools[0].function.name, 'image_generate');
  assert.equal(session.messages.at(-1).content, '已根据参考笔记整理创作方向。');
});

test('tool results still replay correctly without explicit tool_choice', async (t) => {
  const { requests, config } = await provider(t, (_body, turn) => turn === 1
    ? { tool_calls: [{ index: 0, id: 'call_test', function: { name: 'image_generate', arguments: '{}' } }] }
    : { content: '工具参数缺少提示词，请补充画面描述。' });
  const session = { messages: [] };
  await runChatTurn({ config, session, userMessage: '测试工具流程', systemPrompt: 'test', onEvent() {} });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-1).role, 'tool');
  assert.equal(requests[1].messages.at(-1).tool_call_id, 'call_test');
  assert.match(session.messages.at(-1).content, /补充画面描述/);
});
