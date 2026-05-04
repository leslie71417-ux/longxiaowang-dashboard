const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const port = Number(process.env.PORT || 4174);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function loadLocalConfig() {
  const configPath = path.join(root, 'config.js');
  if (!fs.existsSync(configPath)) return {};
  try {
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(configPath, 'utf8'), sandbox, { timeout: 1000 });
    return sandbox.window.QD_CONFIG || {};
  } catch (error) {
    console.warn('[config.js 读取失败]', error.message);
    return {};
  }
}

loadDotEnv();
const localConfig = loadLocalConfig();
const env = (key, fallback = '') => process.env[key] || localConfig[key] || fallback;
const memberIds = {
  ...(localConfig.MEMBER_CHAT_IDS || {}),
  '王玟': process.env.TG_WANGWEN || localConfig.MEMBER_CHAT_IDS?.['王玟'] || '',
  '陈冬梅': process.env.TG_CHENDONGMEI || localConfig.MEMBER_CHAT_IDS?.['陈冬梅'] || '',
  '吴晓磊': process.env.TG_WUXIAOLEI || localConfig.MEMBER_CHAT_IDS?.['吴晓磊'] || '',
  '张娜娜': process.env.TG_ZHANGNANA || localConfig.MEMBER_CHAT_IDS?.['张娜娜'] || '',
  '张慧': process.env.TG_ZHANGHUI || localConfig.MEMBER_CHAT_IDS?.['张慧'] || '',
  '韩笑': process.env.TG_HANXIAO || localConfig.MEMBER_CHAT_IDS?.['韩笑'] || '',
};

const OPENAI_API_KEY = env('OPENAI_API_KEY');
const OPENAI_MODEL = env('OPENAI_MODEL', 'gpt-4.1-mini');
const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const BOSS_CHAT_ID = env('BOSS_CHAT_ID');
const SUPABASE_URL = env('SUPABASE_URL');
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY') || env('SUPABASE_KEY');
const chatIdToName = Object.fromEntries(Object.entries(memberIds).filter(([, id]) => id).map(([name, id]) => [String(id), name]));

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, ...corsHeaders() });
  res.end(type.includes('json') ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body ? JSON.parse(body) : {}));
    req.on('error', reject);
  });
}

async function openAIChat(req, res) {
  if (!OPENAI_API_KEY) return send(res, 500, { error: 'Missing OPENAI_API_KEY' });
  try {
    const body = await readBody(req);
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: body.model || OPENAI_MODEL,
        temperature: 0,
        max_tokens: body.maxTokens || 500,
        messages: [
          { role: 'system', content: String(body.system || '') },
          { role: 'user', content: String(body.user || '') },
        ],
      }),
    });
    const data = await response.json();
    if (!response.ok) return send(res, response.status, { error: data.error?.message || 'OpenAI request failed' });
    send(res, 200, { text: data.choices?.[0]?.message?.content || '' });
  } catch (error) {
    send(res, 500, { error: error.message || 'OpenAI request failed' });
  }
}

async function telegramSendRaw(chatId, text, parseMode = 'Markdown') {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || 'Telegram send failed');
  return data;
}

async function telegramSend(req, res) {
  try {
    const body = await readBody(req);
    if (!body.chat_id || !body.text) return send(res, 400, { error: 'Missing chat_id or text' });
    const target = String(body.chat_id);
    const chatId = target === 'boss' ? BOSS_CHAT_ID : (memberIds[target] || target);
    if (!chatId) return send(res, 400, { error: `Unknown Telegram target: ${target}` });
    const data = await telegramSendRaw(chatId, body.text, body.parse_mode || 'Markdown');
    send(res, 200, data);
  } catch (error) {
    send(res, 500, { error: error.message || 'Telegram send failed' });
  }
}

async function sbRequest(method, restPath, body) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${restPath}`, {
    method,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    console.warn('[Supabase]', method, restPath, response.status, await response.text());
    return null;
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

async function getTelegramUpdates(offset) {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&limit=20&timeout=2`);
  const data = await response.json();
  return data.ok ? data.result || [] : [];
}

let tgOffset = 0;
let polling = false;
async function handleMemberReply(message) {
  const chatId = String(message.chat?.id || '');
  const text = String(message.text || '').trim();
  if (!chatId || !text || chatId === String(BOSS_CHAT_ID)) return;
  const member = chatIdToName[chatId];
  if (!member) {
    await telegramSendRaw(chatId, '我还没有识别到你的身份，请先让秦总在系统里绑定你的 Telegram ID。', undefined).catch(() => {});
    return;
  }
  const tasks = await sbRequest('GET', `boss_tasks?assignee=eq.${encodeURIComponent(member)}&order=id.desc&limit=1`);
  const task = tasks?.[0];
  if (!task) {
    await telegramSendRaw(chatId, `收到，${member}。但我这里暂时没有找到分配给你的进行中任务，我会先转达给秦总。`, undefined).catch(() => {});
    if (BOSS_CHAT_ID) await telegramSendRaw(BOSS_CHAT_ID, `📩 ${member} 回复：\n${text}`, undefined).catch(() => {});
    return;
  }
  const time = new Date().toLocaleString('zh-CN', { hour12: false });
  const append = `\n[${time}] ${member}回复：${text}`;
  await sbRequest('PATCH', `boss_tasks?id=eq.${task.id}`, { description: String(task.description || '') + append, status: task.status || 'in-progress' });
  await telegramSendRaw(chatId, '收到，我已转达给秦总。', undefined).catch(() => {});
  if (BOSS_CHAT_ID) {
    await telegramSendRaw(BOSS_CHAT_ID, `📩 ${member} 回复任务「${task.title || '未命名任务'}」：\n${text}`, undefined).catch(() => {});
  }
}

async function pollTelegram() {
  if (!TELEGRAM_BOT_TOKEN || polling) return;
  polling = true;
  try {
    const updates = await getTelegramUpdates(tgOffset);
    for (const update of updates) {
      tgOffset = Math.max(tgOffset, update.update_id + 1);
      if (update.message) await handleMemberReply(update.message);
    }
  } catch (error) {
    if (!String(error.message || '').includes('409')) console.warn('[Telegram poll]', error.message);
  } finally {
    polling = false;
  }
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, corsHeaders());
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream', ...corsHeaders() });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (pathname === '/api/health') return send(res, 200, {
    ok: true,
    openai: !!OPENAI_API_KEY,
    telegram: !!TELEGRAM_BOT_TOKEN,
    supabase: !!(SUPABASE_URL && SUPABASE_ANON_KEY),
  });
  if (pathname === '/api/openai/chat' && req.method === 'POST') return openAIChat(req, res);
  if (pathname === '/api/telegram/send' && req.method === 'POST') return telegramSend(req, res);
  serveStatic(req, res);
}).listen(port, () => {
  console.log(`Longxiaowang dashboard running at http://localhost:${port}/`);
  if (TELEGRAM_BOT_TOKEN) {
    setInterval(pollTelegram, 3000);
    pollTelegram();
  }
});
