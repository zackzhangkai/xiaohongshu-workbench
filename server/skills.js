import fs from 'node:fs';
import path from 'node:path';

const SKILL_FILE_LIMIT_BYTES = 120_000;

function readTextSafe(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > SKILL_FILE_LIMIT_BYTES) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Read top-level scalar metadata without executing YAML tags or resolving references. */
export function parseFrontmatter(raw) {
  const match = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const meta = {};
  if (match) {
    const lines = match[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const kv = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kv || !['name', 'description', 'contextNote'].includes(kv[1])) continue;
      let value = kv[2].trim();
      if (/^[|>][+-]?(?:\s+#.*)?$/.test(value)) {
        const folded = value[0] === '>', block = [];
        while (i + 1 < lines.length && (/^\s/.test(lines[i + 1]) || !lines[i + 1])) block.push(lines[++i]);
        const indent = Math.min(...block.filter(s => s.trim()).map(s => s.match(/^\s*/)[0].length));
        const text = block.map(s => s.slice(Number.isFinite(indent) ? indent : 0));
        value = folded ? text.map((s, n) => s + (n < text.length - 1 ? (s && text[n + 1] ? ' ' : '\n') : '')).join('').trim() : text.join('\n').trim();
      } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
      else if (value.startsWith('"') && value.endsWith('"')) { try { value = JSON.parse(value); } catch { value = value.slice(1, -1); } }
      if (value && !/^[!&*[{]/.test(value)) meta[kv[1]] = value;
    }
  }
  return meta;
}

/** 列出技能目录下所有含 SKILL.md 的技能 */
export function listSkills(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const skillPath = path.join(skillsDir, d.name);
      const md = readTextSafe(path.join(skillPath, 'SKILL.md'));
      if (!md) return null;
      const meta = parseFrontmatter(md);
      return {
        id: d.name,
        name: meta.name || d.name,
        description: meta.description || meta.contextNote || '',
        path: skillPath,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 组装技能的完整提示词：SKILL.md 主体 + 引用的 references/、agents/ 文件。
 */
export function buildSkillPrompt(skillDir) {
  const parts = [];
  const main = readTextSafe(path.join(skillDir, 'SKILL.md'));
  if (!main) return null;
  parts.push(main);

  for (const sub of ['references', 'agents']) {
    const dir = path.join(skillDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!/\.(md|txt|yaml|yml|json)$/.test(f)) continue;
      const content = readTextSafe(path.join(dir, f));
      if (content) {
        parts.push(`\n---\n\n# ${sub}/${f}\n\n${content}`);
      }
    }
  }
  return parts.join('\n');
}

/**
 * 环境说明：声明本运行器与技能原宿主环境的差异，
 * 让技能提示词里引用的 宿主专有动作有明确的替代行为。
 */
export const ENVIRONMENT_NOTE = `## 运行环境说明（本会话运行在 小红书工作台 复刻运行器中）

- 可用工具只有 \`image_generate\`（即技能中提到的 image.generate，一次生成一张图）。
- 技能中提到的 manuscripts.*、packages.begin/build、topicCenter.*、tool_search、skills_read 等宿主动作在本环境不可用。
- 最终交付不要依赖打包动作：直接在回复中给出完整的标题、可直接复制的配文、标签，
  以及用 image_generate 生成后的图片（以工具回执中的图片链接为准，按轮播顺序排列）。
- 归档、打包与发布由工作台界面完成：用户点你回复下方的「保存为稿件」，文案和配图会一并存入稿件库；
  稿件页提供「下载 ZIP 包」「在 Finder 中打开」「去发小红书（复制标题＋正文并打开发布页）」。
  用户要求打包下载或发布时，直接指引这些按钮，不要回答“无法打包”，也不要手工罗列图片另存清单。
- 其余创作流程、风格与质量要求仍严格遵循技能指引。`;
