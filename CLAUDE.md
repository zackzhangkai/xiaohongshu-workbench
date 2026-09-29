# CLAUDE.md

小红书工作台（xiaohongshu-workbench）— 本地优先的自媒体 AI 工作台。Node/Express 后端 + Vite/React 前端，无 TypeScript，界面中文，服务只绑定 127.0.0.1。

## 命令

```bash
npm install        # 首次
npm run dev        # server + vite（5173 代理 API 到服务端口）
npm run build      # vite build → dist/
npm start          # build + node server/index.js（默认 :8787）
npm test           # node --test tests/*.test.js
```

## 架构

- `server/` — 纯 ESM，每文件单一职责：
  - `index.js` 全部 REST 路由 + 静态托管；`chat.js` SSE 流式对话核心（`image_generate` 工具、最多 8 轮工具调用、历史持久化）；`sanitize.js` 每轮请求前清理回放历史中的空 `tool_calls` 与 null content（部分兼容网关会 400）；`imagegen.js` 三种生图协议；`config.js` 界面模型配置（`data/model-config.json`，0600 原子写）。
  - `skills.js` 加载 `skills/`（用户自备技能包，仓库不含内容）；`sessions.js` / `notes.js` JSON 文件存储，id 用正则校验后再拼路径（防目录穿越，保持）。
  - `collector.js` + `collector-local-sync.js` 小红书采集接口与本地镜像；`manuscripts*.js`、`subtitle-project.js`、`transcription.js`、`video-render.js`、`scheduler.js`、`feeds.js` 等各管一域。
- `src/` — React SPA，无路由，`App.jsx` 客户端切视图；流式解析在 `pages/ChatPage.jsx`（SSE 事件 `delta`/`image`/`tool_start`/`tool_result`/`error`）。
- `extensions/xhs-collector/` — Chrome MV3 采集插件（无构建步骤）；轻量场景另有独立开源版 xiaohongshu-chrome-plugin。
- `scripts/` — 可选 Python 辅助（feed 解析、字幕叠层渲染、本地转写）。

## 约定

- 用户可见文案一律中文；server 模块小而单一。
- 每个供应商/工具错误都以 SSE `error` 事件透出并显示在界面，不得吞错。
- 密钥与私有数据只落在 `data/`（git 忽略）；`data/model-config.json` 绝不提交或外传。
- 端口默认 8787；`DATA_DIR`、`COLLECTOR_SYNC_DIR`、`TRANSCRIBE_*` 见 `.env.example`。
