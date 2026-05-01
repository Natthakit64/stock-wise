// api/chat.js — Vercel Serverless Function
// - ส่ง message ไป OpenRouter
// - บันทึก/โหลดประวัติแชทจาก Supabase (แยกตาม session_id)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const ALLOWED_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'poolside/laguna-xs.2:free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
];

// ─── Helper: เรียก Supabase REST API ───
async function supabase(path, options = {}) {
  const { prefer, ...rest } = options;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...rest,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { 'Prefer': prefer } : {}),
      ...rest.headers,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${res.status}: ${err}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─── Helper: upsert session (สร้างใหม่หรืออัปเดต last_seen_at) ───
async function upsertSession(sessionId) {
  await supabase('/chat_sessions', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: JSON.stringify({
      session_id: sessionId,
      last_seen_at: new Date().toISOString(),
    }),
  });
}

// ─── Helper: บันทึก message ลง DB ───
async function saveMessages(sessionId, userContent, assistantContent) {
  const rows = [
    { session_id: sessionId, role: 'user',      content: userContent },
    { session_id: sessionId, role: 'assistant', content: assistantContent },
  ];
  await supabase('/chat_messages', {
    method: 'POST',
    body: JSON.stringify(rows),
  });
}

// ─── Helper: โหลดประวัติแชทย้อนหลัง 3 วัน ───
async function loadHistory(sessionId) {
  const rows = await supabase(
    `/chat_messages?session_id=eq.${sessionId}&created_at=gte.${threeDaysAgo()}&order=created_at.asc&select=role,content`
  );
  return (rows || []).map(r => ({ role: r.role, content: r.content }));
}

function threeDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString();
}

// ─── Main Handler ───
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET /api/chat?session_id=xxx → โหลดประวัติแชท
  if (req.method === 'GET') {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Supabase not configured' });

    try {
      const history = await loadHistory(sessionId);
      return res.status(200).json({ history });
    } catch (e) {
      console.error('[chat/load]', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // POST /api/chat → ส่งข้อความและบันทึก
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!OPENROUTER_KEY) return res.status(500).json({ error: 'API key not configured' });

  const { messages, model, session_id, system_prompt } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const selectedModel = ALLOWED_MODELS.includes(model) ? model : ALLOWED_MODELS[0];

  // upsert session ถ้ามี session_id
  if (session_id && SUPABASE_URL && SUPABASE_KEY) {
    await upsertSession(session_id).catch(e => console.error('[session upsert]', e));
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  process.env.SITE_URL || 'https://stockwise.vercel.app',
        'X-Title':       'StockWise',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: system_prompt
          ? [{ role: 'system', content: system_prompt }, ...messages]
          : messages,
        max_tokens: 1200,
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'OpenRouter error' });
    }

    // บันทึกประวัติลง DB
    const userMsg = messages[messages.length - 1]?.content || '';
    const reply   = data.choices?.[0]?.message?.content || '';

    if (session_id && SUPABASE_URL && SUPABASE_KEY && userMsg && reply) {
      await saveMessages(session_id, userMsg, reply).catch(e => console.error('[save msg]', e));
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[chat]', err);
    return res.status(500).json({ error: err.message });
  }
}