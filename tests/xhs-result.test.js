import test from 'node:test';
import assert from 'node:assert/strict';
import { getXhsResult, localImage, localOriginalImage, publishUrl } from '../src/xhs-result.js';
const user = (content = '写小红书', skillId = '') => ({ role: 'user', content, context: { skillId } });
const final = (extra = '') => ({ role: 'assistant', content: `## 标题\n我的生活记录\n\n## 正文\n今天出发，一起记录。\n\n## 话题\n#生活\n\n${extra}` });
const tool = (id, url, error) => ({ role: 'tool', tool_call_id: id, content: JSON.stringify({ url, error }) });
const call = { role: 'assistant', content: '', tool_calls: [{ id: 'a', function: { name: 'image_generate' } }] };
test('unfinished material recovery anchors to last successful receipt and survives later user messages', () => {
 const calls = {role:'assistant',content:'规划不能当正文',tool_calls:Array.from({length:11},(_,i)=>({id:`c${i}`,function:{name:'image_generate'}}))};
 const receipts = Array.from({length:11},(_,i)=>({role:'tool',tool_call_id:`c${i}`,content:JSON.stringify({url:`/images/${i}.png`,prompt:'竖版3:4小红书'})}));
 const messages = [user('好，按你的建议来','knowledge-content-imitation'),calls,...receipts,user('完成了吗'),user('完成了吗')];
 const before = structuredClone(messages);
 const results = messages.map((_,i)=>getXhsResult(messages,i)).filter(Boolean);
 assert.equal(results.length,1); assert.equal(results[0].messageIndex,12);
 assert.equal(results[0].images.length,11); assert.equal(results[0].incomplete,true); assert.equal(results[0].body,'');
 assert.deepEqual(messages,before);
 assert.deepEqual(getXhsResult(messages,12),results[0]);
 const complete = [user(),calls,...receipts,final()];
 assert.equal(complete.map((_,i)=>getXhsResult(complete,i)).filter(Boolean).length,1);
 assert.equal(getXhsResult(complete,12),null); assert.equal(getXhsResult(complete,13).images.length,11);
});
test('recovery excludes unrelated, failed, remote and reference materials', () => {
 const receipts = [tool('a','/images/ok.png'),tool('a','/images/fail.png','failed'),tool('a','/imports/ref.png'),tool('a','https://example.com/a.png'),tool('wrong','/images/wrong.png')];
 const messages = [user(),call,...receipts];
 assert.equal(getXhsResult(messages,2).images.length,1);
 for(let i=3;i<messages.length;i++) assert.equal(getXhsResult(messages,i),null);
 assert.equal(getXhsResult([user('画图'),call,receipts[0]],2),null);
 assert.equal(getXhsResult([user('画图','knowledge-content-imitation'),call,receipts[0]],2),null);
 assert.equal(getXhsResult([user(),call,tool('a','/images/no.png','fail')],2),null);
});
test('only completed title + body in xhs context becomes a result', () => {
 assert.equal(getXhsResult([user('解释这个概念'), final()], 1), null);
 assert.equal(getXhsResult([user('只写小红书标题'), final()], 1), null);
 assert.equal(getXhsResult([user(), { role: 'assistant', content: '## 标题\n三个标题' }], 1), null);
 assert.equal(getXhsResult([user(), final('等待你确认后再生成')], 1), null);
 assert.equal(getXhsResult([user(), { role: 'assistant', content: '## 创作方案\n' + final().content }], 1), null);
 assert.equal(getXhsResult([user(), final()], 1).images.length, 0);
});
test('tool images belong only to current user turn and successful image calls', () => {
 const messages = [user(), call, tool('a','/images/old.png'), final(), user(), call, tool('wrong','/images/no.png'), tool('a','/images/fail.png','failed'), tool('a','/imports/source.png'), tool('a','/images/new.png'), final()];
 assert.deepEqual(getXhsResult(messages, 10).images, ['/images/new.png']);
});
test('explicit image/link references ordered first, deduplicated; prior images require reference', () => {
 const messages = [user(), call, tool('a','/images/old.png'), final(), user(), call, tool('a','/images/new.png'), final('![old](/images/old.png)\n![new](/images/new.png)\n![source](/imports/original.png)')];
 assert.deepEqual(getXhsResult(messages, 7).images, ['/images/old.png','/images/new.png']);
});
test('imitation continuation inherits xhs context but excludes switching platforms', () => {
 const messages = [user('参考这个小红书','knowledge-content-imitation'), {role:'assistant',content:'创作方案'}, user('可以，开始','knowledge-content-imitation'), final()];
 assert.equal(getXhsResult(messages, 3).title, '我的生活记录');
 messages[2] = user('改成公众号','knowledge-content-imitation');
 assert.equal(getXhsResult(messages,3),null);
});
test('flat paths only and safe URL construction', () => {
 for (const p of ['/images/../secret.png','/images/%2e%2e.png','https://evil/images/a.png','/images/a.svg','/imports/a.png']) assert.equal(localImage(p),null);
 assert.equal(localImage('/images/a-1.webp'),'/images/a-1.webp');
 assert.equal(localOriginalImage('/imports/original-1.webp'),'/imports/original-1.webp');
 assert.equal(localOriginalImage('/imports/../secret.png'),null);
 assert.equal(publishUrl('a&b',3),'/?publishSession=a%26b&message=3');
});

test('text-only knowledge rewrite publishes trusted original images without treating arbitrary imports as output', () => {
 const context = { skillId: 'knowledge-content-imitation', referenceMode: 'text-only', publishImages: ['/imports/cover.png', '/imports/body.jpg', '/imports/cover.png', '/imports/../secret.png', '/images/generated.png'] };
 const messages = [{ role: 'user', content: '可以，继续', context }, final('![untrusted](/imports/not-selected.png)')];
 const result = getXhsResult(messages, 1);
 assert.deepEqual(result.images, ['/imports/cover.png', '/imports/body.jpg']);
 assert.equal(result.originalImageCount, 2);
});
test('body supports plain labelled output and retains adjacent topics', () => {
 const messages = [user(),{ role:'assistant', content:'标题：测试标题\n正文：真正的正文\n\n话题：#测试'}];
 assert.equal(getXhsResult(messages,1).body,'真正的正文\n\n#测试');
});
test('historical final result retained when a later user turn exists', () => {
 const messages = [user(),final(),user('你好'),{role:'assistant',content:'你好'}];
 assert.ok(getXhsResult(messages,1));
});

test('short confirmations inherit platform without a selected skill and stop after a switch', () => {
 for (const skill of ['', 'xiaohongshu-content-director']) {
  assert.ok(getXhsResult([user(), final(), user('好，继续', skill), final()], 3));
  assert.equal(getXhsResult([user(), final(), user('改成公众号'), final(), user('继续',skill), final()], 5),null);
 }
 assert.equal(getXhsResult([user(),final(),user('帮我解释标题和正文的区别'),final()],3),null);
});


test('title labels require a boundary and do not parse heading suffixes as titles', () => {
 for (const label of ['## 标题建议', '## 主标题建议', '**笔记标题建议**']) {
  assert.equal(getXhsResult([user(), { role: 'assistant', content: `${label}\n我的生活记录\n\n## 正文\n今天出发。` }], 1), null);
 }
 for (const label of ['## 标题', '**标题**', '标题：', '笔记标题: ', '## 主标题 ']) {
  const separator = label.endsWith('：') || label.endsWith(': ') || label.endsWith(' ') ? '' : '\n';
  assert.equal(getXhsResult([user(), { role: 'assistant', content: `${label}${separator}我的生活记录\n\n## 正文\n今天出发。` }], 1).title, '我的生活记录');
 }
});


test('publishing parts isolate explicit topics and compose without duplicates', async () => {
 const { postCopyFields } = await import('../src/copy-body.js');
 const result = getXhsResult([user(), final()], 1);
 assert.equal(result.body, '今天出发，一起记录。\n\n#生活');
 assert.equal(result.postBody, '今天出发，一起记录。');
 assert.equal(result.tags, '#生活');
 assert.equal(postCopyFields(result).all, '我的生活记录\n\n今天出发，一起记录。\n\n#生活');
 assert.deepEqual(postCopyFields({title:'已生成素材 · 文案待完成',body:'',incomplete:true}), {title:'',body:'',tags:'',all:''});
});
test('topic extraction accepts only explicit sections or entire hashtag tail lines', async () => {
 const { extractPostParts } = await import('../src/copy-body.js');
 assert.deepEqual(extractPostParts('## 正文\n今天出发\n#生活 #旅行'), {body:'今天出发',tags:'#生活 #旅行'});
 assert.deepEqual(extractPostParts('**正文**\n\n今天出发\n\n**标签**\n\n#生活 #旅行'), {body:'今天出发',tags:'#生活 #旅行'});
 for (const body of ['今天聊 #生活 的故事', '### 小标题\n更多内容', '```text\n#生活\n```', '    #生活', '今天出发\n\n#生活\n\n还没结束']) {
  assert.deepEqual(extractPostParts('## 正文\n'+body), {body:body.trim(), tags:''});
 }
});
