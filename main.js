// ─── NAVBAR MOBILE TOGGLE ───
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const links  = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => links.classList.toggle('open'));
  }

  // Mark active nav link
  const current = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a').forEach(a => {
    if (a.getAttribute('href') === current) a.classList.add('active');
  });
});

// ─── UTILITY: format number ───
function fmt(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return sign + Number(n).toFixed(2) + '%';
}

function priceClass(n) {
  if (n > 0) return 'price-up';
  if (n < 0) return 'price-down';
  return 'price-flat';
}