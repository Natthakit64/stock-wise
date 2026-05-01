// api/cron-cleanup.js — ลบประวัติแชทเก่ากว่า 3 วัน
// เรียกโดย GitHub Actions ทุกคืน พร้อม Authorization: Bearer <CRON_SECRET>

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

function threeDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString();
}

async function supabaseDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: 'DELETE',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=representation',
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase delete failed: ${err}`);
  }
  return res.status === 204 ? [] : res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['authorization'] || '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const cutoff = threeDaysAgo();

    // ลบ messages เก่า (ON DELETE CASCADE จัดการให้อยู่แล้ว ถ้าลบ session)
    // แต่ลบ messages โดยตรงด้วยเพื่อความแน่ใจ
    await supabaseDelete(`/chat_messages?created_at=lt.${cutoff}`);

    // ลบ session ที่ไม่มีการใช้งานเกิน 3 วัน
    await supabaseDelete(`/chat_sessions?last_seen_at=lt.${cutoff}`);

    console.log(`[cron-cleanup] deleted messages & sessions older than ${cutoff}`);

    return res.status(200).json({ ok: true, cutoff });

  } catch (e) {
    console.error('[cron-cleanup]', e);
    return res.status(500).json({ error: e.message });
  }
}