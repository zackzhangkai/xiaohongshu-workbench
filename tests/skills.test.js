import { fileURLToPath } from "node:url";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, listSkills, buildSkillPrompt } from '../server/skills.js';
test('skill metadata handles BOM, CRLF, multiline blocks and quoted strings', () => {
  const literal = parseFrontmatter('\uFEFF---\r\nname: \'title\'\r\ndescription: |\r\n  第一行\r\n  第二行\r\nother: yes\r\n---\r\n');
  assert.equal(literal.name, 'title'); assert.equal(literal.description, '第一行\n第二行');
  assert.equal(parseFrontmatter('---\ndescription: >-\n  一行\n  接续\n---').description, '一行 接续');
  assert.equal(parseFrontmatter('---\ndescription: \'it\'\'s useful\'\n---').description, "it's useful");
  assert.equal(parseFrontmatter('---\ndescription: "line\\nnext"\n---').description, 'line\nnext');
  assert.deepEqual(parseFrontmatter('---\ndescription: !!js/function test\n---'), {});
});
const maybe = fs.existsSync(fileURLToPath(new URL('../skills/xhs-title', import.meta.url))) ? test : test.skip;
maybe('real bundled title description is complete; contextNote fallback does not alter prompts', () => {
  const skills = listSkills(fileURLToPath(new URL('../skills', import.meta.url)));
  assert.match(skills.find(s => s.id === 'xhs-title').description, /36/);
  assert.match(skills.find(s => s.id === 'image-prompt-optimizer').description, /提示词/);
  const titlePrompt = buildSkillPrompt(fileURLToPath(new URL('../skills/xhs-title', import.meta.url)));
  assert.match(titlePrompt, /description: \|/);
  assert.match(titlePrompt, /F01/); // references/formulas.md 随主体一并内联
});
