# Task Dashboard Bot

奇点 Telegram/AI 后台机器人。

功能：

- 轮询 Telegram bot 消息。
- 监听 `boss_tasks` 新任务并私信高管。
- 高管回复后转达秦总。
- 高管提出延期、改期、变更交付等请求时，只转达秦总，不代替秦总批准。
- 支持王文/王玟/王雯等别名匹配。
- 自动解析财务与招生进度信息，并写入 Supabase。

## 配置

```bash
cp .env.example .env
```

需要设置：

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

## 运行

加载环境变量后运行：

```bash
python3 qidian_agent.py
```

重要：同一个 Telegram bot token 只能有一个轮询实例。旧脚本如果还在运行，会抢走消息或造成 409 冲突。

## 找不到旧脚本怎么办

去 Telegram `@BotFather` 重新生成 bot token。旧脚本拿着旧 token 会立刻失效。然后把新 token 填到：

- 前端项目的 `config.js`
- 本项目的 `.env`

再启动本项目的 `qidian_agent.py`。
