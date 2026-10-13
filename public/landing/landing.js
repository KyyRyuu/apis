const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* drawer */
const drawer = $('drawer'), scrim = $('scrim'), menuBtn = $('menuBtn');
function openDrawer() {
  drawer.classList.add('open'); scrim.classList.add('show');
  menuBtn.setAttribute('aria-expanded', 'true');
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeDrawer() {
  drawer.classList.remove('open'); scrim.classList.remove('show');
  menuBtn.setAttribute('aria-expanded', 'false');
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}
menuBtn.addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

/* share */
$('shareBtn').addEventListener('click', async () => {
  const btn = $('shareBtn');
  const url = location.href;
  try {
    if (navigator.share) { await navigator.share({ title: document.title, url }); return; }
    await navigator.clipboard.writeText(url);
    btn.textContent = 'Link copied ✓';
  } catch { btn.textContent = 'Share'; }
  setTimeout(() => { btn.textContent = 'Share'; }, 1600);
});

/* clock */
function tickClock() {
  const el = $('termClock');
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
}
tickClock(); setInterval(tickClock, 1000);

/* terminal */
function line(html, cls) {
  const box = $('termLog');
  const d = document.createElement('div');
  d.className = 'l ' + (cls || '');
  d.innerHTML = html;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  return d;
}
async function typeCmd(text) {
  const box = $('termLog');
  const d = document.createElement('div');
  d.className = 'l';
  d.innerHTML = '<span class="t-ok">➜</span> <span class="t-c">~</span> <span class="t-w"></span>';
  box.appendChild(d);
  const span = d.querySelector('.t-w');
  if (reduced) { span.textContent = text; return; }
  for (const ch of text) { span.textContent += ch; await sleep(42); }
}
async function bootLog(routes) {
  const log = $('termLog');
  log.innerHTML = '';
  await typeCmd('npm run dev');
  await sleep(350);
  line('> kuroneko-api • ts-node index.ts', 't-dim');
  await sleep(300);
  for (const r of routes.slice(0, 12)) {
    line(`<span class="t-g">[ + ]</span> <span class="t-c">${r.method}</span>  ${r.endpoint}  <span class="t-dim">✓</span>`);
    if (!reduced) await sleep(60);
  }
  if (routes.length > 12) line(`<span class="t-dim">… +${routes.length - 12} more routes loaded</span>`);
  await sleep(250);
  line(`<span class="t-ok">[ ✓ ] Server running on ${location.origin}</span>`);
}

/* reveal */
function observeRv(scope) {
  const els = (scope || document).querySelectorAll('.rv:not(.in)');
  if (reduced || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((es) => {
    es.forEach((en, i) => {
      if (en.isIntersecting) { setTimeout(() => en.target.classList.add('in'), i * 70); io.unobserve(en.target); }
    });
  }, { threshold: 0.1 });
  els.forEach((e) => io.observe(e));
}

/* data */
async function load() {
  let cfg = null, stats = null;
  try {
    const r = await fetch('/config');
    cfg = await r.json();
  } catch {}
  try {
    const r2 = await fetch('/stats/data');
    stats = await r2.json();
  } catch {}

  const s = (cfg && cfg.settings) || {};
  const name = s.apiName || 'KuroNeko';
  document.title = `${name} — Midnight API Platform`;
  $('dashTitle').textContent = name;
  $('dashDesc').textContent = s.description || 'Free & reliable API service for modern apps. Fast, stable, easy to integrate.';
  $('verBadge').textContent = s.apiVersion || 'v1.0';
  $('footCreator').textContent = (cfg && cfg.creator) || s.creator || 'Danzz';
  $('footYear').textContent = new Date().getFullYear();
  if (s.favicon) {
    $('favicon').href = s.favicon;
    const th = $('dashThumb');
    th.src = s.thumbnail || s.favicon;
    th.onerror = () => { th.src = 'https://placehold.co/400x240/12121d/22d3ee?text=KURO'; };
  } else {
    $('dashThumb').src = 'https://placehold.co/400x240/12121d/22d3ee?text=KURO';
  }
  const gh = s.github || 'https://github.com/DanzzAraAra';
  $('btnGithub').href = gh;
  const ch = s.channelUrl;
  if (ch) { $('btnChannel').href = ch; $('btnChannelM').href = ch; }
  else { $('btnChannel').style.display = 'none'; $('btnChannelM').style.display = 'none'; }

  // flatten routes
  const tags = (cfg && cfg.tags) || {};
  const routes = [];
  Object.entries(tags).forEach(([cat, arr]) => (arr || []).forEach((r) => routes.push({ cat, ...r })));
  $('stEndpoints').textContent = routes.length || '—';
  $('stCats').textContent = Object.keys(tags).length || '—';

  await bootLog(routes.length ? routes : [
    { method: 'GET', endpoint: '/api/search/yts' },
    { method: 'GET', endpoint: '/api/ai/kuroneko' },
    { method: 'GET', endpoint: '/api/tools/shorturl' },
  ]);

  // preview grid (max 6)
  const grid = $('epGrid');
  grid.innerHTML = '';
  const pick = routes.slice(0, 6);
  if (!pick.length) {
    grid.innerHTML = '<p style="color:var(--mut)">Belum ada endpoint terdaftar.</p>';
  } else {
    pick.forEach((r, i) => {
      const a = document.createElement('a');
      a.className = 'ep rv';
      a.href = '/docs';
      const mc = r.method === 'POST' ? 'post' : r.method === 'DELETE' ? 'delete' : r.method === 'GET' ? '' : 'other';
      a.innerHTML = `<div class="ep-top"><span class="mbadge ${mc}">${r.method || 'GET'}</span><span class="ep-cat">${r.cat}</span></div><h3>${r.name || r.endpoint}</h3><code>${r.endpoint}</code><p>${(r.params || []).length ? r.params.length + ' params' : 'No params'} • klik untuk coba →</p>`;
      a.style.transitionDelay = (i * 40) + 'ms';
      grid.appendChild(a);
    });
  }
  // reveal everything
  document.querySelectorAll('.hero-left > *, .hero-right > *').forEach((el) => el.classList.add('rv'));
  observeRv(document);
  // stagger hero in
  document.querySelectorAll('.hero .rv').forEach((el, i) => setTimeout(() => el.classList.add('in'), 60 * i + 100));
}
load();
