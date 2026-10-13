const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const io = new IntersectionObserver((es) => {
  es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: 0.08 });
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

let paused = false;
let memHist = [];

$('pauseBtn').addEventListener('click', () => {
  paused = !paused;
  $('pauseBtn').innerHTML = paused ? '<i class="fa-solid fa-play text-sm"></i>' : '<i class="fa-solid fa-pause text-sm"></i>';
  $('pauseBtn').setAttribute('aria-pressed', String(paused));
  $('pauseBtn').setAttribute('aria-label', paused ? 'Lanjutkan auto-refresh' : 'Jeda auto-refresh');
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

function renderRequests(reqs) {
  const box = $('reqList');
  $('reqCount').textContent = reqs.length;
  if (!reqs.length) { box.innerHTML = '<p class="hint">Belum ada request API tercatat. Coba hit endpoint dari /docs.</p>'; return; }
  const items = reqs.slice(-14).reverse();
  box.innerHTML = '';
  items.forEach((r) => {
    const d = document.createElement('div');
    d.className = 'req';
    const method = (r.match(/\[([A-Z]+)\]/) || [,'GET'])[1];
    const code = (r.match(/\[(\d{3})\]/) || [,'200'])[1];
    const url = r.split(' ').slice(2).join(' ') || r;
    const short = url.replace(/^https?:\/\/[^/]+/, '');
    d.innerHTML = `<span class="m">${method}</span><span class="c ${statusClass(r)}">${code}</span><span class="u" title="${url.replace(/"/g, '')}">${short}</span>`;
    box.appendChild(d);
  });
}

function drawSpark() {
  const cv = $('memSpark');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (memHist.length < 2) {
    ctx.fillStyle = '#615b7d'; ctx.font = '12px JetBrains Mono';
    ctx.fillText('collecting…', 14, H / 2 + 4);
    return;
  }
  ctx.strokeStyle = 'rgba(139,92,246,.25)';
  ctx.lineWidth = 1;
  for (let g = 1; g < 4; g++) { ctx.beginPath(); ctx.moveTo(0, (H / 4) * g); ctx.lineTo(W, (H / 4) * g); ctx.stroke(); }
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#8b5cf6'); grad.addColorStop(0.6, '#22d3ee'); grad.addColorStop(1, '#f472b6');
  ctx.strokeStyle = grad; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
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
    $('cpu-model').textContent = `${s.cpu.model} (${s.cpu.cores} cores • ${s.cpu.speed})`;
    const loadPct = Math.min(100, Math.round(parseFloat(s.cpu.load) * 10));
    $('cpu-load').textContent = (isNaN(loadPct) ? 0 : loadPct) + '%';
    $('mem-used').textContent = s.memory.used;
    $('mem-total').textContent = s.memory.total;
    $('mem-free').textContent = s.memory.free;
    const bar = $('ram-bar');
    bar.style.width = s.memory.percent + '%';
    $('ram-percent').textContent = s.memory.percent + '%';
    bar.classList.remove('warn', 'danger');
    if (s.memory.percent > 90) bar.classList.add('danger');
    else if (s.memory.percent > 70) bar.classList.add('warn');
    memHist.push(s.memory.percent);
    if (memHist.length > 60) memHist.shift();
    drawSpark();
    renderRequests(data.requests || []);
    $('updatedAt').textContent = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false });
    const live = $('liveTxt');
    if (live && !paused) live.textContent = 'LIVE';
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

fetchStats();
fetchEpCount();
setInterval(fetchStats, 2000);
drawSpark();
