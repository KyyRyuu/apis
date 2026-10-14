const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WORDS = ['fast.', 'typed.', 'modular.', 'documented.', 'rate-limited.', 'always up.'];

/* drawer */
const drawer = $('drawer'), scrim = $('scrim'), menuBtn = $('menuBtn');
function openDrawer() { drawer.classList.add('open'); scrim.classList.add('show'); menuBtn.setAttribute('aria-expanded', 'true'); drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
function closeDrawer() { drawer.classList.remove('open'); scrim.classList.remove('show'); menuBtn.setAttribute('aria-expanded', 'false'); drawer.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
menuBtn.addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); location.href = '/docs'; }
});

/* toast */
let toastT;
function toast(msg) {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => $('toast').classList.remove('show'), 2600);
}
$('copyIpBtn').addEventListener('click', async () => {
  const done = async (ok) => toast(ok ? 'URL copied to clipboard' : 'Copy gagal — salin manual: ' + location.origin);
  try { await navigator.clipboard.writeText(location.origin); done(true); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = location.origin; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      done(document.execCommand('copy')); ta.remove();
    } catch { done(false); }
  }
});

/* clock */
function tick() { $('termClock').textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }); }
tick(); setInterval(tick, 1000);

/* typed hero */
async function typer() {
  const el = $('typed');
  let i = 0;
  for (;;) {
    const w = WORDS[i % WORDS.length];
    for (let c = 1; c <= w.length; c++) { el.textContent = w.slice(0, c); await sleep(reduced ? 0 : 55); }
    await sleep(1400);
    for (let c = w.length; c >= 0; c--) { el.textContent = w.slice(0, c); await sleep(reduced ? 0 : 24); }
    i++;
  }
}
typer();

/* terminal */
function line(html, cls) {
  const box = $('termLog');
  const d = document.createElement('div');
  d.innerHTML = `<span class="${cls || ''}">${html}</span>`;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}
async function bootLog(routes) {
  $('termLog').innerHTML = '';
  line('$ k-apis --boot', 'c');
  await sleep(reduced ? 0 : 300);
  line('』 backend online :: express + typescript', 'd');
  for (const r of routes.slice(0, 10)) {
    line(`<span class="g">＋</span> <span class="c">${r.method}</span>  ${r.endpoint}`, '');
    if (!reduced) await sleep(60);
  }
  if (routes.length > 10) line(`… +${routes.length - 10} routes mounted`, 'd');
  await sleep(reduced ? 0 : 250);
  line(`<span class="ok">✔ listening on ${location.origin}</span>`, '');
}

/* reveal */
function observeRv() {
  const els = document.querySelectorAll('.rv:not(.in)');
  if (reduced || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((es) => {
    es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.1 });
  els.forEach((e) => io.observe(e));
}

/* recipes */
function recipes(origin, ep) {
  const url = origin + ep;
  return {
    curl: `curl -X GET "${url}"`,
    js: `const res = await fetch("${url}");\nconst data = await res.json();\nconsole.log(data);`,
    py: `import requests\n\nres = requests.get("${url}")\nprint(res.json())`
  };
}
let currentRecipes = {};
document.querySelectorAll('.ctab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ctab').forEach((b) => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    $('craftCode').textContent = currentRecipes[btn.dataset.lang] || '';
  });
});
$('craftCopy').addEventListener('click', async () => {
  const txt = $('craftCode').textContent;
  try { await navigator.clipboard.writeText(txt); toast('Snippet copied'); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      toast(document.execCommand('copy') ? 'Snippet copied' : 'Copy gagal — salin manual');
      ta.remove();
    } catch { toast('Copy gagal — salin manual'); }
  }
});

/* data */
async function load() {
  let cfg = window.__CFG__ || null;
  const s = (cfg && cfg.settings) || {};
  const name = s.apiName || 'K-APIs';
  document.title = `${name} — API Platform`;
  $('dashTitle').textContent = name;
  $('srvMotd').textContent = s.description ? (s.description.length > 90 ? s.description.slice(0, 90) + '…' : s.description) : 'Reliable API for modern apps.';
  $('dashDesc').textContent = s.description || 'Free & reliable API service for modern apps. Fast, stable, easy to integrate.';
  $('verBadge').textContent = s.apiVersion || 'v1.0';
  $('motdVer').textContent = s.apiVersion || 'v1.0';
  $('footCreator').textContent = (cfg && cfg.creator) || s.creator || 'IkyyKzy';
  $('footYear').textContent = new Date().getFullYear();
  const th = $('dashThumb');
  th.src = s.favicon || s.thumbnail || '';
  th.onerror = () => { th.src = 'https://placehold.co/112x112/12121a/ef4444?text=KN'; };
  if (s.favicon) $('favicon').href = s.favicon;
  const gh = s.github || 'https://github.com/DanzzAraAra';
  $('btnGithub').href = gh;
  const ch = s.channelUrl;
  if (ch) { $('btnChannel').href = ch; $('btnChannelM').href = ch; }
  else { $('btnChannel').style.display = 'none'; $('btnChannelM').style.display = 'none'; }

  const tags = (cfg && cfg.tags) || {};
  const routes = [];
  Object.entries(tags).forEach(([cat, arr]) => (arr || []).forEach((r) => routes.push({ cat, ...r })));
  $('stEndpoints').textContent = routes.length || '–';
  $('stCats').textContent = Object.keys(tags).length || '–';
  $('motdPing').classList.add('on');

  /* ticker */
  const items = routes.length ? routes : [{ method: 'GET', endpoint: '/api/search/yts' }];
  const half = items.map((r) => `<span>&nbsp;&nbsp;<b>${r.method}</b> ${r.endpoint} ◆</span>`).join('');
  $('ticker').innerHTML = half + half;

  await bootLog(items);

  const grid = $('epGrid');
  grid.innerHTML = '';
  const pick = routes.slice(0, 6);
  if (!pick.length) grid.innerHTML = '<p style="color:var(--mut)">No endpoints registered yet.</p>';
  else pick.forEach((r, i) => {
    const a = document.createElement('a');
    a.className = 'ep rv';
    a.href = r.cat === 'ai' ? '/ai' : r.cat === 'download' ? '/download' : r.cat === 'search' ? '/search' : '/docs';
    const mc = r.method === 'POST' ? 'post' : r.method === 'DELETE' ? 'delete' : r.method === 'GET' ? '' : 'other';
    a.innerHTML = `<span class="idx">0${i + 1}</span><div class="ep-top"><span class="mbadge ${mc}">${r.method || 'GET'}</span><span class="ep-cat">${r.cat}</span></div><h3>${r.name || r.endpoint}</h3><code>${r.endpoint}</code><p>${(r.params || []).length ? r.params.length + ' params' : 'No params'} — open in docs →</p>`;
    grid.appendChild(a);
  });

  currentRecipes = recipes(location.origin, (routes[0] && routes[0].endpoint) || '/api/search/yts');
  $('craftCode').textContent = currentRecipes.curl;

  document.querySelectorAll('.hero-l > *, .hero-r > *').forEach((el) => el.classList.add('rv'));
  observeRv();
}
load();
