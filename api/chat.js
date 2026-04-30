// api/chat.js — Vercel Serverless Function
// วาง OPENROUTER_API_KEY ใน Vercel Dashboard > Settings > Environment Variables

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  const { messages, model } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Whitelist โมเดลที่อนุญาต (ป้องกัน user ส่งโมเดลแพงมาเอง)
  const ALLOWED_MODELS = [
    'poolside/fp8',
    'meta-llama/llama-4-maverick:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'mistralai/mistral-7b-instruct:free',
    'qwen/qwen3-8b:free',
    'anthropic/claude-3-haiku',
  ];

  const selectedModel = ALLOWED_MODELS.includes(model) ? model : ALLOWED_MODELS[0];

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  process.env.SITE_URL || 'https://stockwise.vercel.app',
        'X-Title':       'StockWise',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        max_tokens: 1200,
        temperature: 0.7,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'OpenRouter error' });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}