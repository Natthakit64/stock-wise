// api/stocks.js — Vercel Serverless Function
// ใช้ Alpha Vantage API: ฟรี 25 req/วัน, ดึงทีละ symbol

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200'); // cache 1 ชม.

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ALPHAVANTAGE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  // Top 10 เท่านั้น — ใช้ไม่เกิน 10 req/ครั้ง (free tier 25/วัน)
  const SYMBOLS = [
    { symbol: 'AAPL',  name: 'Apple Inc.',            sector: 'Tech'    },
    { symbol: 'MSFT',  name: 'Microsoft Corporation', sector: 'Tech'    },
    { symbol: 'NVDA',  name: 'NVIDIA Corporation',    sector: 'Tech'    },
    { symbol: 'GOOGL', name: 'Alphabet Inc.',          sector: 'Tech'    },
    { symbol: 'META',  name: 'Meta Platforms',         sector: 'Tech'    },
    { symbol: 'TSLA',  name: 'Tesla Inc.',             sector: 'Tech'    },
    { symbol: 'AMZN',  name: 'Amazon.com Inc.',        sector: 'Tech'    },
    { symbol: 'JPM',   name: 'JPMorgan Chase',         sector: 'Finance' },
    { symbol: 'V',     name: 'Visa Inc.',              sector: 'Finance' },
    { symbol: 'JNJ',   name: 'Johnson & Johnson',      sector: 'Health'  },
  ];

  // ดึงแบบ sequential (ไม่ parallel) เพื่อไม่ให้ Alpha Vantage rate limit
  const quotes = [];

  for (const stock of SYMBOLS) {
    try {
      const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${stock.symbol}&apikey=${apiKey}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;

      const data = await r.json();
      const q = data['Global Quote'];
      if (!q || !q['05. price']) continue;

      const price     = parseFloat(q['05. price']);
      const open      = parseFloat(q['02. open']);
      const high      = parseFloat(q['03. high']);
      const low       = parseFloat(q['04. low']);
      const change    = parseFloat(q['09. change']);
      const changePct = parseFloat(q['10. change percent']?.replace('%', ''));
      const volume    = parseInt(q['06. volume'], 10);
      const prevClose = parseFloat(q['08. previous close']);
      const dataDate  = q['07. latest trading day'];

      quotes.push({
        symbol:                     stock.symbol,
        name:                       stock.name,
        sector:                     stock.sector,
        regularMarketPrice:         price,
        regularMarketOpen:          open,
        regularMarketChange:        change,
        regularMarketChangePercent: changePct,
        regularMarketVolume:        volume   || null,
        regularMarketDayHigh:       high     || null,
        regularMarketDayLow:        low      || null,
        regularMarketPreviousClose: prevClose || null,
        fiftyTwoWeekHigh:           null,
        fiftyTwoWeekLow:            null,
        marketCap:                  null,
        dataDate,
      });
    } catch (_) {
      continue;
    }
  }

  if (!quotes.length) {
    return res.status(502).json({ error: 'ไม่ได้รับข้อมูลจาก Alpha Vantage' });
  }

  return res.status(200).json({
    quoteResponse: { result: quotes, error: null },
  });
}