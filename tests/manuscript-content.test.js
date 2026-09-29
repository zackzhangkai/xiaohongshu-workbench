import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPostBody, extractPostTitle } from '../src/copy-body.js';
import { publishableDraft } from '../server/manuscript-content.js';

// Real shapes observed in chat deliveries: bold label-only lines with the
// value on the next block, and enumeration-prefixed section headings.
const delivery = `交付说明开头。

## ✍️ 发布用文案

**标题**：
2026 AI 搭子编制表｜先看清你缺哪个岗位

**正文**：
第一行正文。
第二行正文。

**标签**：
#AI工具 #效率

## ✅ 交付说明

- 原创边界说明。
`;
const wrappedDelivery = `收到。先说明一个实情，替代方案如下。

## ② 标题（二选一）

- **推荐**（符合 20 字限制）：
  \`AI 搭子编制表｜你缺哪个岗位？\`
- 备选：
  \`2026 AI 搭子编制表，先码住\`

## ③ 正文（整段复制）

\`\`\`
整段正文第一行。
整段正文第二行。
\`\`\`
`;

test('labelled bold-line sections yield title, body and tags', () => {
  assert.equal(extractPostTitle(delivery), '2026 AI 搭子编制表｜先看清你缺哪个岗位');
  assert.equal(extractPostBody(delivery), '第一行正文。\n第二行正文。\n\n#AI工具 #效率');
});

test('enumeration-prefixed heading sections and fence-wrapped bodies are recognized', () => {
  assert.equal(extractPostTitle(wrappedDelivery), 'AI 搭子编制表｜你缺哪个岗位？');
  assert.equal(extractPostBody(wrappedDelivery), '```\n整段正文第一行。\n整段正文第二行。\n```');
  const draft = publishableDraft(wrappedDelivery);
  assert.equal(draft.title, 'AI 搭子编制表｜你缺哪个岗位？');
  assert.equal(draft.content, '整段正文第一行。\n整段正文第二行。', 'whole-body fence is unwrapped for the manuscript');
});

test('same-line 标题 and unlabelled replies', () => {
  assert.equal(extractPostTitle('标题：同行的标题值\n\n正文：\n正文内容'), '同行的标题值');
  assert.equal(publishableDraft('没有任何标注段的自由回复'), null);
  const plan = publishableDraft(delivery);
  assert.equal(plan.title, '2026 AI 搭子编制表｜先看清你缺哪个岗位');
  assert.ok(plan.content.startsWith('第一行正文'), 'body keeps interior fences but never the wrapper');
});
