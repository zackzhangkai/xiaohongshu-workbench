import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

function clipboardText(markdown) {
  const html = DOMPurify.sanitize(marked.parse(markdown, { breaks: true, gfm: true }), {
    USE_PROFILES: { html: true }, FORBID_TAGS: ['img', 'video', 'audio', 'input', 'button'],
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  function textOf(node) {
    // HTML source newlines are formatting whitespace, not visible line breaks.
    // Actual soft/hard breaks have already been converted to <br> by marked.
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/[\t\r\n ]+/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    const children = () => [...node.childNodes].map(textOf).join('');
    if (tag === 'BR') return '\n';
    if (tag === 'HR') return '\n\n';
    if (tag === 'PRE') return `\n\n${node.textContent}\n\n`;
    if (tag === 'UL' || tag === 'OL') {
      const start = Number(node.getAttribute('start') || 1);
      const items = [...node.children].filter((child) => child.tagName === 'LI');
      return '\n\n' + items.map((li, i) => {
        const marker = tag === 'OL' ? `${li.getAttribute('value') || start + i}.` : '•';
        return `${marker} ${textOf(li).trim()}`;
      }).join('\n') + '\n\n';
    }
    if (tag === 'LI') return [...node.childNodes].map((child) => {
      if (child.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(child.tagName)) {
        return '\n' + textOf(child).trim().split('\n').map((line) => line ? `  ${line}` : '').join('\n');
      }
      return textOf(child);
    }).join('');
    if (tag === 'TR') return [...node.children].map(textOf).join(' ｜ ') + '\n';
    if (/^(P|DIV|H[1-6]|BLOCKQUOTE|TABLE)$/.test(tag)) return `\n\n${children().trim()}\n\n`;
    return children();
  }
  return textOf(doc.body).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]*(?=\n)/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function copyMarkdown(markdown, plainText) {
  const text = plainText ? markdown : clipboardText(markdown);
  // Publishing editors re-interpret <p>, <br> and <li> differently. Copy only
  // plain text so paragraphs and list markers survive without HTML reflow.
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* Try legacy copy below. */ }
  }
  const active = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('copy denied');
  } finally { field.remove(); active?.focus?.({ preventScroll: true }); }
}

export default function CopyTextButton({ text, label = '复制正文', title, plainText = false }) {
  const [state, setState] = useState('idle');
  const timer = useRef(null);
  useEffect(() => { setState('idle'); return () => clearTimeout(timer.current); }, [text]);
  const copy = async () => {
    clearTimeout(timer.current); setState('copying');
    try { await copyMarkdown(text, plainText); setState('copied'); timer.current = setTimeout(() => setState('idle'), 2500); }
    catch { setState('error'); }
  };
  return <span className="copy-text-control">
    <button type="button" className="text-button copy-text-button" title={title || '复制适合发布的纯文本：段落间空一行，保留换行、列表和话题'} disabled={!text?.trim() || state === 'copying'} onClick={copy}>
      {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}{state === 'copied' ? '已复制' : state === 'copying' ? '复制中…' : label}
    </button>
    <span role="status" className={state === 'error' ? 'copy-text-error' : 'sr-only'}>{state === 'copied' ? '已复制到剪贴板' : state === 'error' ? '复制失败，请选中文字手动复制' : ''}</span>
  </span>;
}
