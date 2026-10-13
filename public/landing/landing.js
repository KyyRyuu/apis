const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPLASHES = [
  "100% creeper free!", "Now with 8 enchantments!", "Punch trees, get APIs!",
  "Also try Terraria!", "Diamond-grade uptime!", "Respawn point set!",
  "Watch out for phantoms!", "Endermen approved!", "32 chunks loaded!",
  "Herobrine removed!", "TNT-powered routing!", "Fresh chunks daily!"
];

/* drawer */
const drawer = $('drawer'), scrim = $('scrim'), menuBtn = $('menuBtn');
function openDrawer() { drawer.classList.add('open'); scrim.classList.add('show'); menuBtn.setAttribute('aria-expanded', 'true'); drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
function closeDrawer() { drawer.classList.remove('open'); scrim.classList.remove('show'); menuBtn.setAttribute('aria-expanded', 'false'); drawer.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
menuBtn.addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
scrim.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

/* advancement toast */
let toastT;
function advancement(msg) {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => $('toast').classList.remove('show'), 3200);
}
$('copyIpBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.origin); advancement('Server IP copied to clipboard!'); }
  catch { advancement(location.origin); }
});

/* clock */
function tick() { $('termClock').textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }); }
tick(); setInterval(tick, 1000);
const stamp = () => new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });

/* terminal */
function line(html) {
  const box = $('termLog');
  const d = document.createElement('div');
  d.innerHTML = `<span class="t-dim">[${stamp()}]</span> ${html}`;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}
async function bootLog(routes) {
  $('termLog').innerHTML = '';
  line('<span class="t-w">Loading world "kuroneko"...</span>');
  await sleep(reduced ? 0 : 350);
  line('<span class="t-g">Starting minecraft server version 1.0</span>');
  line('<span class="t-dim">Loading level "api-world"...</span>');
  await sleep(reduced ? 0 : 300);
  for (const r of routes.slice(0, 12)) {
    line(`<span class="t-g">[+]</span> <span class="t-c">${r.method}</span> ${r.endpoint}`);
    if (!reduced) await sleep(55);
  }
  if (routes.length > 12) line(`<span class="t-dim">... +${routes.length - 12} more recipes</span>`);
  await sleep(reduced ? 0 : 250);
  line(`<span class="t-ok">Done! Server running on ${location.origin}</span>`);
}

/* reveal */
function observeRv() {
  const els = document.querySelectorAll('.rv:not(.in)');
  if (reduced || !('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((es) => {
    es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.08 });
  els.forEach((e) => io.observe(e));
}

/* crafting recipes */
function recipes(origin, ep) {
  const url = origin + ep;
  return {
    curl: `curl -X GET "${url}"`,
    js: `const res = await fetch("${url}");\nconst data = await res.json();\nconsole.log(data); // GG!`,
    py: `import requests\n\nres = requests.get("${url}")\nprint(res.json())  # GG!`
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
  try { await navigator.clipboard.writeText($('craftCode').textContent); advancement('Recipe copied to inventory!'); }
  catch { advancement('Copy failed, sadge.'); }
});

/* data */
async function load() {
  $('splash').textContent = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
  let cfg = null;
  try { cfg = await (await fetch('/config')).json(); } catch {}
  const s = (cfg && cfg.settings) || {};
  const name = s.apiName || 'KuroNeko';
  document.title = `${name} — Minecraft API Server`;
  $('dashTitle').textContent = name;
  $('dashDesc').textContent = s.description || 'Free & reliable API service for modern apps.';
  $('verBadge').textContent = s.apiVersion || 'v1.0';
  $('motdVer').textContent = s.apiVersion || 'v1.0';
  $('footCreator').textContent = (cfg && cfg.creator) || s.creator || 'Danzz';
  $('footYear').textContent = new Date().getFullYear();
  const th = $('dashThumb');
  th.src = s.favicon || s.thumbnail || '';
  th.onerror = () => { th.src = 'https://placehold.co/64x64/1a1d12/6abe30?text=K'; };
  th.style.imageRendering = 'pixelated';
  const gh = s.github || 'https://github.com/DanzzAraAra';
  $('btnGithub').href = gh;
  if (s.channelUrl) { $('btnChannel').href = s.channelUrl; $('btnChannelM').href = s.channelUrl; }
  else { $('btnChannel').style.display = 'none'; $('btnChannelM').style.display = 'none'; }
  const tags = (cfg && cfg.tags) || {};
  const routes = [];
  Object.entries(tags).forEach(([cat, arr]) => (arr || []).forEach((r) => routes.push({ cat, ...r })));
  $('stEndpoints').textContent = routes.length || '–';
  $('stCats').textContent = Object.keys(tags).length || '–';
  $('motdCount').textContent = routes.length || '–';
  $('motdPlayers').textContent = 1 + Math.floor(Math.random() * 42);
  $('motdPing').classList.add('on');

  await bootLog(routes.length ? routes : [{ method: 'GET', endpoint: '/api/search/yts' }]);

  const grid = $('epGrid');
  grid.innerHTML = '';
  const pick = routes.slice(0, 6);
  if (!pick.length) grid.innerHTML = '<p style="color:var(--mut)">Chest is empty... for now.</p>';
  else pick.forEach((r, i) => {
    const a = document.createElement('a');
    a.className = 'ep rv';
    a.href = '/docs';
    const mc = r.method === 'POST' ? 'post' : r.method === 'DELETE' ? 'delete' : r.method === 'GET' ? '' : 'other';
    a.innerHTML = `${i === 0 ? '<span class="new">NEW!</span>' : ''}<div class="ep-top"><span class="mbadge ${mc}">${r.method || 'GET'}</span><span class="ep-cat">${r.cat}</span></div><h3>${r.name || r.endpoint}</h3><code>${r.endpoint}</code><p>${(r.params || []).length ? r.params.length + 'x material needed' : 'No materials needed'} — click to craft</p>`;
    grid.appendChild(a);
  });

  const firstEp = (routes[0] && routes[0].endpoint) || '/api/search/yts';
  currentRecipes = recipes(location.origin, firstEp);
  $('craftCode').textContent = currentRecipes.curl;

  document.querySelectorAll('.hero-text > *, .hero-side > *').forEach((el) => el.classList.add('rv'));
  observeRv();
}
load();
