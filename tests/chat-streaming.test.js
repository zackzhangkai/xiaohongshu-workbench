import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runChatTurn } from '../server/chat.js';

test('fragmented tool call persists function type and replays it during the same turn', async t => {
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;requests.push(JSON.parse(raw));
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const deltas=requests.length===1 ? [{tool_calls:[{index:0,id:'split',type:'function',function:{name:'image_',arguments:'{'}}]},{tool_calls:[{index:0,function:{name:'generate',arguments:'}'}}]}] : [{content:'done'}];
  for(const delta of deltas)res.write(`data: ${JSON.stringify({choices:[{delta}]})}\n\n`);
  res.end('data: [DONE]\n\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>{server.closeAllConnections();server.close();});
 const session={messages:[]};
 await runChatTurn({config:{chatBaseUrl:`http://127.0.0.1:${server.address().port}`,chatModel:'mock'},session,userMessage:'test',systemPrompt:'test',onEvent(){}});
 assert.equal(requests.length,2);
 assert.equal(session.messages[1].tool_calls[0].type,'function');
 assert.equal(requests[1].messages[2].tool_calls[0].type,'function');
 assert.equal(session.messages[1].tool_calls[0].function.name,'image_generate');
 assert.equal(session.messages[1].tool_calls[0].function.arguments,'{}');
});

test('deltas arrive before provider completion and persisted response contains no duplicate text', async t => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const server = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '先显示' } }] })}\n\n`);
    await gate;
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '后完成' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { finish(); server.closeAllConnections(); server.close(); });
  const session = { messages: [] };
  const events = [];
  let first;
  const firstDelta = new Promise(resolve => { first = resolve; });
  let completed = false;
  const turn = runChatTurn({ config: { chatBaseUrl: `http://127.0.0.1:${server.address().port}`, chatModel: 'test' }, session,
    systemPrompt: 'test', userMessage: 'hello', allowImageGeneration: false,
    onEvent: event => { events.push(event); if (event.type === 'delta') first(); }, signal: AbortSignal.timeout(5000) }).then(() => { completed = true; });
  await Promise.race([firstDelta, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('first delta did not arrive while provider remained open')), 2000); timer.unref(); })]);
  assert.equal(completed, false);
  assert.equal(events[0].text, '先显示');
  finish(); await turn;
  assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), '先显示后完成');
  assert.equal(session.messages.at(-1).content, '先显示后完成');
});
