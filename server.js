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
const OPENAI_TRANSCRIBE_MODEL = env('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-transcribe');
const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const BOSS_CHAT_ID = env('BOSS_CHAT_ID');
const SUPABASE_URL = env('SUPABASE_URL');
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY') || env('SUPABASE_KEY');
const chatIdToName = Object.fromEntries(Object.entries(memberIds).filter(([, id]) => id).map(([name, id]) => [String(id), name]));

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Seed-Token',
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

function readBodyBuffer(req, maxBytes = 25_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Audio body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
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

async function openAITranscribe(req, res) {
  if (!OPENAI_API_KEY) return send(res, 500, { error: 'Missing OPENAI_API_KEY' });
  try {
    const audio = await readBodyBuffer(req);
    if (!audio.length) return send(res, 400, { error: 'Missing audio body' });
    const contentType = String(req.headers['content-type'] || 'audio/webm').split(';')[0] || 'audio/webm';
    const ext = contentType.includes('mp4') ? 'mp4' : contentType.includes('mpeg') ? 'mp3' : contentType.includes('wav') ? 'wav' : 'webm';
    const form = new FormData();
    form.append('model', OPENAI_TRANSCRIBE_MODEL);
    form.append('language', 'zh');
    form.append('prompt', '这是一套中文高管任务管理系统的老板语音指令。常见人名和词汇包括：秦总、王玟、王文、王雯、韩笑、吴晓磊、陈冬梅、张娜娜、张慧、刘菲、陈伟、任务单、下发、交付时间、交付结果、一般、紧急、很紧急、Telegram、龙虾王工作站、任务看板、财务看板、龙虎榜。请优先保留中文人名和业务词，不要把“下发”识别成“下方”。');
    form.append('file', new Blob([audio], { type: contentType }), `speech.${ext}`);
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const data = await response.json();
    if (!response.ok) return send(res, response.status, { error: data.error?.message || 'Transcription failed' });
    send(res, 200, { text: data.text || '' });
  } catch (error) {
    send(res, 500, { error: error.message || 'Transcription failed' });
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

const OLD_DASHBOARD_DEFAULT_TASKS = [
  {
    id: 1,
    name: '完成Q1季度报告',
    assignee: '张三',
    deadline: '2026-03-31',
    priority: 'high',
    status: 'in-progress',
    blocker: '',
    files: ['Q1草稿.docx'],
    notes: '需要包含销售数据和市场分析',
    project: null,
    created_at: '2026-03-20',
  },
  {
    id: 2,
    name: '产品原型设计评审',
    assignee: '李四',
    deadline: '2026-03-28',
    priority: 'mid',
    status: 'completed',
    blocker: '',
    files: ['prototype_v2.fig'],
    notes: '已完成3轮修改，获得团队认可',
    project: null,
    created_at: '2026-03-18',
  },
  {
    id: 3,
    name: '后端API性能优化',
    assignee: '王五',
    deadline: '2026-04-05',
    priority: 'high',
    status: 'blocked',
    blocker: '等待DBA团队提供数据库优化方案，预计明天到位',
    files: [],
    notes: '接口响应时间需从2s降至500ms',
    project: null,
    created_at: '2026-03-22',
  },
  {
    id: 4,
    name: '新员工培训材料整理',
    assignee: '赵六',
    deadline: '2026-04-10',
    priority: 'low',
    status: 'pending',
    blocker: '',
    files: [],
    notes: '包含公司文化、流程规范、工具使用说明',
    project: null,
    created_at: '2026-03-24',
  },
];

async function seedOldDashboardDefaults(req, res) {
  const expectedToken = env('ADMIN_SEED_TOKEN') || BOSS_CHAT_ID;
  const actualToken = req.headers['x-seed-token'];
  if (expectedToken && actualToken !== expectedToken) return send(res, 403, { error: 'Forbidden' });
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return send(res, 500, { error: 'Missing Supabase config' });

  try {
    const existing = await sbRequest('GET', 'tasks?select=id,name&limit=1000');
    if (!Array.isArray(existing)) return send(res, 502, { error: 'Could not read existing tasks from Supabase' });

    const existingIds = new Set(existing.map(task => Number(task.id)).filter(Boolean));
    const existingNames = new Set(existing.map(task => String(task.name || '').trim()).filter(Boolean));
    const rows = OLD_DASHBOARD_DEFAULT_TASKS.filter(task => !existingIds.has(task.id) && !existingNames.has(task.name));
    const inserted = rows.length ? await sbRequest('POST', 'tasks', rows) : [];
    if (rows.length && !Array.isArray(inserted)) return send(res, 502, { error: 'Could not insert default tasks into Supabase' });

    send(res, 200, {
      ok: true,
      source: 'https://singularity0142-code.github.io/task-dashboard/',
      insertedCount: rows.length,
      skippedCount: OLD_DASHBOARD_DEFAULT_TASKS.length - rows.length,
      tasks: inserted,
      finance: {
        insertedCount: 0,
        note: '旧 task-dashboard 代码里没有默认财务记录，只有任务看板默认数据。',
      },
    });
  } catch (error) {
    send(res, 500, { error: error.message || 'Seed failed' });
  }
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
  if (pathname === '/api/openai/transcribe' && req.method === 'POST') return openAITranscribe(req, res);
  if (pathname === '/api/telegram/send' && req.method === 'POST') return telegramSend(req, res);
  if (pathname === '/api/admin/seed-defaults' && req.method === 'POST') return seedOldDashboardDefaults(req, res);
  serveStatic(req, res);
}).listen(port, () => {
  console.log(`Longxiaowang dashboard running at http://localhost:${port}/`);
  if (TELEGRAM_BOT_TOKEN) {
    setInterval(pollTelegram, 3000);
    pollTelegram();
  }
});
