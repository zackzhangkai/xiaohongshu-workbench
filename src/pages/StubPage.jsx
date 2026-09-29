import React from 'react';
import { Hourglass } from 'lucide-react';

/** 自动化 / 选题中心：沿用原版导航结构，功能逐步补齐 */
export default function StubPage({ label }) {
  return (
    <div className="page-body">
      <div className="empty-state">
        <Hourglass size={28} className="empty-icon" />
        <div>{label} · 即将支持</div>
        <div className="dim" style={{ fontSize: 12 }}>
          当前先完成主页、对话与知识库；此功能将在后续阶段接入
        </div>
      </div>
    </div>
  );
}
