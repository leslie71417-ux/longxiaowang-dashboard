# 龙虾王工作站

老板端高管任务看板 + OpenAI/Telegram 后端服务完整项目。

## 目录

- `index.html`：老板工作台、语音下达任务、任务看板、任务单台账、财务看板、组织图谱。
- `cmd.html`：奇点指令台。
- `designs.html`：机器人外观设计稿。
- `server.js`：Render/本地后端服务，包含静态页面、OpenAI 代理、Telegram 发送、基础 Telegram 回复监听。
- `config.public.js`：可上传 GitHub Pages 的公开配置。
- `config.example.js`：浏览器配置示例。
- `.env.example`：Render 环境变量示例。
- `bot/qidian_agent.py`：Telegram/AI 后台机器人。
- `bot/.env.example`：机器人环境变量示例。

## 运行前端

```bash
node server.js
```

打开：

```text
http://localhost:4174/
```

## GitHub Pages

可以把本项目上传到 GitHub。GitHub Pages 运行前端静态页面；Render 运行 `server.js` 后端。

不要提交 `config.js` 或 `.env`。公开仓库中提交 `config.public.js`、`config.example.js`、`.env.example`。

## GitHub Pages 配置

`config.public.js` 需要提供：

- `API_BASE_URL`：Render Web Service 地址，例如 `https://longxiaowang-dashboard.onrender.com`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

`SUPABASE_ANON_KEY` 是浏览器端公共 key，但必须确保 Supabase Row Level Security 配置正确。

## Render 部署

在 Render 新建 Web Service：

- Runtime: Node
- Build Command: 留空或 `npm install`
- Start Command: `npm start`
- Instance Type: Free

Render 环境变量需要提供：

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TELEGRAM_BOT_TOKEN`
- `BOSS_CHAT_ID`
- `TG_WANGWEN`
- `TG_CHENDONGMEI`
- `TG_WUXIAOLEI`
- `TG_ZHANGNANA`
- `TG_ZHANGHUI`
- `TG_HANXIAO`

重要：同一个 Telegram bot token 只能有一个轮询实例。Render 后端启动后，不要再同时运行本地 `bot/qidian_agent.py`。
