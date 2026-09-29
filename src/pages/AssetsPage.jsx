import React, { useEffect, useState } from 'react';
import { ImageIcon, FolderOpen } from 'lucide-react';

export default function AssetsPage() {
  const [assets, setAssets] = useState([]);

  useEffect(() => {
    fetch('/api/assets')
      .then((r) => r.json())
      .then((d) => setAssets(d.assets ?? []));
  }, []);

  return (
    <div className="page-body">
      {assets.length === 0 ? (
        <div className="empty-state">
          <FolderOpen size={30} className="empty-icon" />
          <div>还没有生成过图片</div>
          <div className="dim" style={{ fontSize: 12 }}>在“新对话”里让 AI 生图后，图片会自动出现在这里</div>
        </div>
      ) : (
        <div className="asset-grid">
          {assets.map((a) => (
            <div key={a.name} className="asset-cell">
              <a href={a.url} target="_blank" rel="noreferrer">
                <img src={a.url} alt={a.name} loading="lazy" />
              </a>
              <div className="asset-name">
                <ImageIcon size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
                {a.name.slice(0, 18)} · {(a.size / 1024).toFixed(0)}KB
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
