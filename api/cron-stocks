// api/cron-stocks.js — เรียกโดย GitHub Actions หลังตลาดปิด
// วิธีใช้: ตั้ง GitHub Actions ยิง POST มาที่ /api/cron-stocks
//          พร้อม header Authorization: Bearer <CRON_SECRET>

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FINNHUB_KEY  = process.env.FINNHUB_API_KEY;
const CRON_SECRET  = process.env.CRON_SECRET; // ตั้งใน Vercel env vars ด้วย

const STOCKS = [
  { symbol: 'AAPL',  name: 'Apple Inc.',              sector: 'Tech'    },
  { symbol: 'MSFT',  name: 'Microsoft Corporation',   sector: 'Tech'    },
  { symbol: 'NVDA',  name: 'NVIDIA Corporation',       sector: 'Tech'    },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',            sector: 'Tech'    },
  { symbol: 'META',  name: 'Meta Platforms',           sector: 'Tech'    },
  { symbol: 'TSLA',  name: 'Tesla Inc.',               sector: 'Tech'    },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.',          sector: 'Tech'    },
  { symbol: 'AMD',   name: 'Advanced Micro Devices',   sector: 'Tech'    },
  { symbol: 'INTC',  name: 'Intel Corporation',        sector: 'Tech'    },
  { symbol: 'CRM',   name: 'Salesforce Inc.',          sector: 'Tech'    },
  { symbol: 'JPM',   name: 'JPMorgan Chase',           sector: 'Finance' },
  { symbol: 'BAC',   name: 'Bank of America',          sector: 'Finance' },
  { symbol: 'GS',    name: 'Goldman Sachs',            sector: 'Finance' },
  { symbol: 'V',     name: 'Visa Inc.',                sector: 'Finance' },
  { symbol: 'MA',    name: 'Mastercard Inc.',          sector: 'Finance' },
  { symbol: 'XOM',   name: 'Exxon Mobil',              sector: 'Energy'  },
  { symbol: 'CVX',   name: 'Chevron Corporation',      sector: 'Energy'  },
  { symbol: 'JNJ',   name: 'Johnson & Johnson',        sector: 'Health'  },
  { symbol: 'PFE',   name: 'Pfizer Inc.',              sector: 'Health'  },
  { symbol: 'UNH',   name: 'UnitedHealth Group',       sector: 'Health'  },
];

async function supabaseUpsert(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/stock_quotes`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upsert failed: ${err}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ตรวจสอบ secret ป้องกันคนอื่นมายิง
  const auth = req.headers['authorization'] || '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!FINNHUB_KEY || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Environment variables not configured' });
  }

  const today = new Date().toISOString().split('T')[0];
  const results = await Promise.allSettled(
    STOCKS.map(async (stock) => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${stock.symbol}&token=${FINNHUB_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`Finnhub ${r.status} for ${stock.symbol}`);
      const q = await r.json();
      if (!q.c || q.c === 0) throw new Error(`No data for ${stock.symbol}`);
      return {
        symbol:     stock.symbol,
        name:       stock.name,
        sector:     stock.sector,
        price:      q.c,
        change:     q.d      ?? null,
        change_pct: q.dp     ?? null,
        open:       q.o      || null,
        prev_close: q.pc     || null,
        high_day:   q.h      || null,
        low_day:    q.l      || null,
        volume:     null,
        data_date:  today,
        updated_at: new Date().toISOString(),
      };
    })
  );

  const rows    = results.filter(r => r.status === 'fulfilled').map(r => r.value);
  const failed  = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);

  if (rows.length > 0) {
    await supabaseUpsert(rows);
  }

  console.log(`[cron-stocks] saved ${rows.length}/${STOCKS.length}, failed: ${failed.join(', ') || 'none'}`);

  return res.status(200).json({
    saved: rows.length,
    total: STOCKS.length,
    failed,
    date: today,
  });
}