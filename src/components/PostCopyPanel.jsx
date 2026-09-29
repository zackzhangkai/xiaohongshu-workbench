import React from 'react';
import CopyTextButton from './CopyTextButton.jsx';
import { postCopyFields } from '../copy-body.js';

export default function PostCopyPanel({ result }) {
  const fields = postCopyFields(result);
  return <article className="xhs-copy-panel">
    <div className="xhs-copy-heading"><h2>发布文案</h2><CopyTextButton text={fields.all} label="一键复制全部文案" plainText /></div>
    {result.incomplete && <p className="xhs-muted" role="status">最终文案尚未完成。请返回对话补充标题、正文和标签；现有图片可先下载。</p>}
    {[['title', '标题'], ['body', '正文'], ['tags', '标签']].map(([key, name]) => <section className="xhs-copy-field" key={key}>
      <div className="xhs-copy-heading"><h3>{name}</h3><CopyTextButton text={fields[key]} label={`复制${name}`} plainText /></div>
      {fields[key] ? <pre>{fields[key]}</pre> : <p className="xhs-muted">{result.incomplete ? `${name}待完成` : `暂无${name}`}</p>}
    </section>)}
  </article>;
}
