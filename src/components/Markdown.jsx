import React, { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/** 流式 Markdown 渲染（对应原版 StreamingMarkdown） */
export default function Markdown({ text }) {
  const html = useMemo(() => {
    const raw = marked.parse(text ?? '');
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  }, [text]);
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
