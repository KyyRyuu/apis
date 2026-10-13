const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const io = new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

let paused = false;
let memHist = [];
let sessTotal = 0;
let lastSeen = 0;

/* hearts */
function renderHearts(pct) {
  const row = $('hpRow');
  row.innerHTML = '';
  const full = Math.round(((100 - pct) / 100) * 10);
  for (let i = 0; i < 10; i++) {
    const h = document.createElement('span');
    h.className = 'hp' + (i < full ? ' full' : '');
    row.appendChild(h);
  }
  $('hpTxt').textContent = full * 2;
}

$('pauseBtn').addEventListener('click', () => {
  paused = !paused;
  $('pauseBtn').innerHTML = paused ? '<i class="fa-solid fa-play"></i>' : '<i class="fa-solid fa-pause"></i>';
  $('pauseBtn').setAttribute('aria-pressed', String(paused));
  document.querySelector('.live').classList.toggle('paused', paused);
  $('liveTxt').textContent = paused ? 'PAUSED' : 'LIVE';
  if (!paused) fetchStats();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) fetchStats(); });

function statusClass(line) {
  const m = line.match(/\[(\d{3})\]/);
  if (!m) return 'ok';
  const c = parseInt(m[1], 10);
  if (c >= 500) return 'err';
  if (c >= 400) return 'warn';
  return 'ok';
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function renderRequests(reqs) {
  const box = $('reqList');
  $('reqCount').textContent = reqs.length;
  if (reqs.length > lastSeen) { sessTotal += (reqs.length - lastSeen); $('sessReq').textContent = sessTotal; }
  lastSeen = reqs.length;
  if (!reqs.length) { box.innerHTML = '<p class="hint">Waiting for players…</p>'; return; }
  box.innerHTML = '';
  reqs.slice(-14).reverse().forEach((r) => {
    const method = (r.match(/\[([A-Z]+)\]/) || [, 'GET'])[1];
    const code = (r.match(/\[(\d{3})\]/) || [, '200'])[1];
    const url = (r.split(' ').slice(2).join(' ') || r).replace(/^https?:\/\/[^/]+/, '');
    const d = document.createElement('div');
    d.className = 'msg';
    d.innerHTML = `<span class="t">&lt;server&gt;</span> <span class="m">[${method}]</span> <span class="${statusClass(r)}">${code}</span> <span class="u">${esc(url)}</span>`;
    box.appendChild(d);
  });
}

function drawSpark() {
  const cv = $('memSpark');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#3a3d28';
  for (let x = 0; x < W; x += 8) for (let y = 0; y < H; y += 8) ctx.fillRect(x, y, 2, 2);
  if (memHist.length < 2) {
    ctx.fillStyle = '#7a765c'; ctx.font = '16px VT323';
    ctx.fillText('generating terrain…', 14, H / 2 + 6);
    return;
  }
  ctx.strokeStyle = '#6abe30'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
  ctx.shadowColor = '#6abe30'; ctx.shadowBlur = 8;
  ctx.beginPath();
  memHist.forEach((v, i) => {
    const x = (i / (memHist.length - 1)) * (W - 8) + 4;
    const y = H - 6 - (Math.min(100, Math.max(0, v)) / 100) * (H - 14);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

async function fetchStats() {
  if (paused) return;
  try {
    const res = await fetch('/stats/data');
    const data = await res.json();
    if (!data.status) return;
    const s = data.server;
    $('uptime').textContent = s.uptime;
    $('platform').textContent = s.hostname;
    $('osBadge').textContent = (s.platform || '—') + '';
    $('arch').textContent = s.arch;
    $('node-ver').textContent = s.node_version;
    $('cpu-model').textContent = `${s.cpu.model} (${s.cpu.cores} cores)`;
    const loadPct = Math.min(100, Math.round(parseFloat(s.cpu.load) * 10));
    $('cpu-load').textContent = (isNaN(loadPct) ? 0 : loadPct) + '% redstone';
    $('mem-used').textContent = s.memory.used;
    $('mem-total').textContent = s.memory.total;
    $('mem-free').textContent = s.memory.free;
    const bar = $('ram-bar');
    bar.style.width = s.memory.percent + '%';
    $('ram-percent').textContent = s.memory.percent + '%';
    $('memLevel').textContent = s.memory.percent;
    bar.classList.remove('warn', 'danger');
    if (s.memory.percent > 90) bar.classList.add('danger');
    else if (s.memory.percent > 70) bar.classList.add('warn');
    renderHearts(s.memory.percent);
    memHist.push(s.memory.percent);
    if (memHist.length > 60) memHist.shift();
    drawSpark();
    renderRequests(data.requests || []);
    $('updatedAt').textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
    if (!paused) $('liveTxt').textContent = 'LIVE';
  } catch {}
}

async function fetchEpCount() {
  try {
    const r = await fetch('/config');
    const c = await r.json();
    let n = 0;
    Object.values(c.tags || {}).forEach((a) => { n += (a || []).length; });
    $('epCount').textContent = n;
  } catch { $('epCount').textContent = '—'; }
}

renderHearts(25);
fetchStats();
fetchEpCount();
setInterval(fetchStats, 2000);
drawSpark();
