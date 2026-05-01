// api/stocks.js — Vercel Serverless Function
// ดึงราคาหุ้นจาก Supabase DB (อัปเดตโดย cron job หลังตลาดปิด)
// ถ้าใน DB ไม่มีหุ้นที่ค้นหา → fallback ไป Finnhub แล้วบันทึกลง DB

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY; // service role key (ไม่ใช่ anon)
const FINNHUB_KEY  = process.env.FINNHUB_API_KEY;

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

// ─── Helper: เรียก Supabase REST API ───
async function supabaseQuery(path, options = {}) {
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

// ─── Helper: ดึงจาก Finnhub แล้ว upsert ลง DB ───
async function fetchFromFinnhubAndSave(symbols) {
  if (!FINNHUB_KEY) throw new Error('FINNHUB_API_KEY not configured');

  const stockList = symbols
    .map(sym => STOCKS.find(s => s.symbol === sym))
    .filter(Boolean);

  const results = await Promise.allSettled(
    stockList.map(async (stock) => {
      const url = `https://finnhub.io/api/v1/quote?symbol=${stock.symbol}&token=${FINNHUB_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error(`Finnhub ${r.status}`);
      const q = await r.json();
      return { stock, q };
    })
  );

  const rows = results
    .filter(r => r.status === 'fulfilled')
    .map(({ value: { stock, q } }) => {
      if (!q.c || q.c === 0) return null;
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
        data_date:  new Date().toISOString().split('T')[0],
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  if (rows.length > 0) {
    await supabaseQuery('/stock_quotes', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: JSON.stringify(rows),
    });
  }

  return rows;
}

// ─── Main Handler ───
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const symbolsParam = req.query.symbols;
    const requestedSymbols = symbolsParam
      ? symbolsParam.split(',').map(s => s.trim().toUpperCase())
      : STOCKS.map(s => s.symbol);

    // 1. ดึงจาก DB ก่อน
    const symbolList = requestedSymbols.join(',');
    const dbRows = await supabaseQuery(
      `/stock_quotes?symbol=in.(${symbolList})&select=*`
    );

    // 2. หา symbol ที่ยังไม่มีใน DB
    const foundSymbols = new Set((dbRows || []).map(r => r.symbol));
    const missingSymbols = requestedSymbols.filter(s => !foundSymbols.has(s));

    let allRows = [...(dbRows || [])];

    // 3. ถ้ามี symbol ที่ไม่มีใน DB → fallback Finnhub
    if (missingSymbols.length > 0) {
      const fetched = await fetchFromFinnhubAndSave(missingSymbols);
      allRows = [...allRows, ...fetched];
    }

    if (!allRows.length) {
      return res.status(502).json({ error: 'ไม่ได้รับข้อมูล' });
    }

    // 4. map กลับเป็น format เดิมที่ stocks.html ใช้ (ไม่ต้องแก้ frontend)
    const result = allRows.map(r => ({
      symbol:                     r.symbol,
      name:                       r.name,
      sector:                     r.sector,
      regularMarketPrice:         r.price,
      regularMarketChange:        r.change,
      regularMarketChangePercent: r.change_pct,
      regularMarketOpen:          r.open,
      regularMarketPreviousClose: r.prev_close,
      regularMarketDayHigh:       r.high_day,
      regularMarketDayLow:        r.low_day,
      regularMarketVolume:        r.volume,
      marketCap:                  null,
      fiftyTwoWeekHigh:           r.high_day,
      fiftyTwoWeekLow:            r.low_day,
      dataDate:                   r.data_date,
    }));

    return res.status(200).json({ quoteResponse: { result, error: null } });

  } catch (e) {
    console.error('[stocks]', e);
    return res.status(500).json({ error: e.message });
  }
}