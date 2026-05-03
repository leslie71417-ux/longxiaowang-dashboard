# 龙虾王工作站

老板端高管任务看板 + Telegram/AI 后台机器人完整项目。

## 目录

- `index.html`：老板工作台、语音下达任务、任务看板、任务单台账、财务看板、组织图谱。
- `cmd.html`：奇点指令台。
- `designs.html`：机器人外观设计稿。
- `server.js`：前端本地静态服务。
- `config.example.js`：浏览器配置示例。
- `bot/qidian_agent.py`：Telegram/AI 后台机器人。
- `bot/.env.example`：机器人环境变量示例。

## 运行前端

```bash
cp config.example.js config.js
node server.js
```

打开：

```text
http://localhost:4174/
```

## GitHub Pages

可以把本项目上传到 GitHub。GitHub Pages 只会运行前端静态页面，`bot/` 里的 Telegram 机器人需要在本地电脑、服务器或云主机单独运行。

不要提交 `config.js`。公开仓库中只提交 `config.example.js`。

如果要在线运行真实业务，建议把 OpenAI 和 Telegram 调用迁到后端 API，前端只保留 Supabase anon key，并确保 Supabase Row Level Security 配置严格。

## 前端配置

`config.js` 需要提供：

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TELEGRAM_BOT_TOKEN`
- `BOSS_CHAT_ID`
- `COMMAND_CHAT_ID`
- `MEMBER_CHAT_IDS`

## 运行 Telegram 机器人

```bash
cd bot
cp .env.example .env
python3 qidian_agent.py
```

机器人 `.env` 需要设置：

- `OPENAI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `BOSS_CHAT_ID`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `TG_WANGWEN`
- `TG_CHENDONGMEI`
- `TG_WUXIAOLEI`
- `TG_ZHANGNANA`
- `TG_ZHANGHUI`
- `TG_HANXIAO`

重要：同一个 Telegram bot token 只能有一个轮询实例。旧脚本如果还在运行，会抢走消息或造成 409 冲突。
