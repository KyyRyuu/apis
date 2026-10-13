const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtNum = (n) => (n === null || n === undefined) ? '–' : Number(n).toLocaleString('en-US');

let toastT;
function toast(msg) {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => $('toast').classList.remove('show'), 2600);
}
function setPill(ok, txt) {
  $('statusPill').classList.toggle('err', !ok);
  $('statusPillTxt').textContent = txt;
}
function hl(json) {
  const s = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  return esc(s).replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (m) => {
    let c = 'j-n';
    if (/^"/.test(m)) c = /:$/.test(m) ? 'j-k' : 'j-s';
    else if (/true|false/.test(m)) c = 'j-b';
    else if (/null/.test(m)) c = 'j-nl';
    return `<span class="${c}">${m}</span>`;
  });
}

/* tabs */
const tabSv = $('tab-saver'), tabEp = $('tab-eps');
function showTab(which) {
  const isEp = which === 'eps';
  tabSv.classList.toggle('active', !isEp);
  tabEp.classList.toggle('active', isEp);
  tabSv.setAttribute('aria-selected', String(!isEp));
  tabEp.setAttribute('aria-selected', String(isEp));
  $('view-saver').hidden = isEp;
  $('view-eps').hidden = !isEp;
  try { if (/^\/download\/?(#endpoints)?$/.test(location.pathname)) history.replaceState(null, '', isEp ? '/download#endpoints' : '/download'); } catch {}
}
tabSv.addEventListener('click', () => showTab('saver'));
tabEp.addEventListener('click', () => showTab('eps'));

/* ---------- SAVER ---------- */
const STEPS = ['Fetching post…', 'Parsing SSR payload…', 'Resolving CDN links…', 'Verifying files…'];
const THREAD_SAMPLES = [
  ['cth: foto', 'https://www.threads.com/share/BAFMYe__aO/'],
  ['cth: video', 'https://www.threads.com/share/BAo4O5AVfz/'],
  ['cth: carousel', 'https://www.threads.com/share/BAdzD60DJQ/']
];
let saverBusy = false;
let saverRoute = null;
function saverKey() {
  const ps = (saverRoute && saverRoute.params) || [];
  const req = ps.find((p) => p.required) || ps[0];
  return (req && req.name) || 'url';
}
function setSaver(route) {
  saverRoute = route;
  if (!route) return;
  $('saverTitle').textContent = ((route.name || route.endpoint) + '').toUpperCase().slice(0, 28);
  const key = saverKey();
  $('saverSub').textContent = `Tempel link, intip hasilnya, gas download — via ${route.endpoint} (param: ${key}).`;
  const chips = $('sampleChips');
  chips.innerHTML = '';
  if (route.filename === 'threads') {
    THREAD_SAMPLES.forEach(([label, sample]) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => { $('dlInput').value = sample; runSaver(sample); });
      chips.appendChild(b);
    });
  }
}

function dlBtn(href, label, fname) {
  return `<a class="btn grn sm" href="${esc(href)}" download="${esc(fname)}" target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> ${esc(label)}</a>`;
}

function renderResult(j) {
  const box = $('dlResult');
  const u = j.url || {};
  const videos = u.video ? [u.video] : (u.videos || []);
  const audios = u.audio ? [u.audio] : (u.audios || []);
  const images = u.images || [];
  const thumb = u.thumbnail || null;
  const a = j.author || {};
  const st = j.stats || {};
  const cap = j.caption || {};
  const cm = j.comments || {};
  const ver = j.verification || {};
  const pid = j.post_id || 'threads';
  const type = (j.type || 'media').toUpperCase();

  let mediaHtml = '';
  videos.forEach((v, i) => {
    mediaHtml += `<div class="shot"><video controls preload="metadata" src="${esc(v)}"></video>${dlBtn(v, `VIDEO ${videos.length > 1 ? i + 1 : ''} MP4`.trim(), `threads-${pid}-${i + 1}.mp4`)}</div>`;
  });
  images.forEach((src, i) => {
    mediaHtml += `<div class="shot"><img loading="lazy" src="${esc(src)}" alt="media ${i + 1}">${dlBtn(src, `PHOTO ${images.length > 1 ? i + 1 : ''}`.trim(), `threads-${pid}-${i + 1}.jpg`)}</div>`;
  });
  if (!videos.length && !images.length && thumb) {
    mediaHtml += `<div class="shot"><img loading="lazy" src="${esc(thumb)}" alt="thumbnail">${dlBtn(thumb, 'THUMBNAIL', `threads-${pid}-thumb.jpg`)}</div>`;
  }
  if (!videos.length && !images.length && !thumb) {
    mediaHtml += `<p style="padding:0 20px 6px;color:var(--mut);font-size:12.5px">Text post — tidak ada media untuk diunduh.</p>`;
  }
  audios.forEach((au, i) => {
    mediaHtml += `<div style="padding:0 20px 10px">${dlBtn(au, `AUDIO ${audios.length > 1 ? i + 1 : ''} M4A`.trim(), `threads-${pid}-audio${i + 1}.m4a`)}</div>`;
  });

  const tags = [...(cap.hashtags || []).map((t) => '#' + t), ...(cap.mentions || []).map((t) => '@' + t)].join(' ');
  const topCm = (cm.top || []).slice(0, 5).map((c) =>
    `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:12.5px"><b>@${esc(c.username || '?')}</b> <span style="color:var(--mut)">♥${fmtNum(c.like_count)}</span><br>${esc(c.text || '')}</div>`
  ).join('');

  box.innerHTML = `
    <div class="r-hd">
      ${a.profile_pic_url ? `<img src="${esc(a.profile_pic_url)}" alt="avatar" loading="lazy">` : ''}
      <div class="r-who">
        <b>@${esc(a.username || '?')} ${a.is_verified ? '<i class="fa-solid fa-circle-check"></i>' : ''}</b>
        <span>${esc(a.full_name || '')} • ${esc(j.posted_at ? j.posted_at.slice(0, 10) : '')}</span>
      </div>
      <span class="typebadge">${esc(type)}</span>
    </div>
    ${cap.text ? `<p class="r-cap">${esc(cap.text)}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    <div class="r-stats">
      <span><i class="fa-solid fa-heart"></i><b>${fmtNum(st.like)}</b></span>
      <span><i class="fa-solid fa-comment"></i><b>${fmtNum(st.comment)}</b> comments</span>
      <span><i class="fa-solid fa-retweet"></i><b>${fmtNum(st.repost)}</b> reposts</span>
      <span><i class="fa-solid fa-quote-left"></i><b>${fmtNum(st.quote)}</b> quotes</span>
      <span><i class="fa-solid fa-share"></i><b>${fmtNum(st.reshare)}</b> reshares</span>
    </div>
    <div class="r-media ${videos.length + images.length > 1 ? 'multi' : 'one'}">${mediaHtml}</div>
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY LINKS</button>
      <a class="btn sm" href="${esc(j.permalink || j.source_url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN POST</a>
    </div>
    ${topCm ? `<div style="padding:0 20px 6px"><p style="font-size:11px;color:var(--mut)">TOP COMMENTS (${fmtNum(cm.count)})</p>${topCm}</div>` : ''}
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.all_cdn_ok ? 'vok' : 'vbad'}">${ver.all_cdn_ok ? 'ALL OK' : 'CHECK FAILED'}</span>
      <span>• id ${esc(String(pid))}</span>
    </div>`;
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const allLinks = [...videos, ...images, ...(thumb ? [thumb] : []), ...audios];
  $('copyAllBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(allLinks.join('\n')); toast(allLinks.length + ' link disalin'); }
    catch { toast('Copy gagal'); }
  });
}

async function runSaver(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) { toast('Tempel URL dulu'); return; }
  if (!saverRoute) { toast('Endpoint belum siap'); return; }
  if (saverBusy) return;
  saverBusy = true;
  $('dlGo').disabled = true;
  $('dlResult').hidden = true;
  $('dlErr').hidden = true;
  const prog = $('dlProg'), ptxt = $('dlProgTxt');
  prog.hidden = false;
  let si = 0;
  ptxt.textContent = STEPS[0];
  const stepTimer = setInterval(() => { si = Math.min(si + 1, STEPS.length - 1); ptxt.textContent = STEPS[si]; }, 4000);
  try {
    const r = await fetch(saverRoute.endpoint + '?' + new URLSearchParams({ [saverKey()]: url }));
    const j = await r.json();
    clearInterval(stepTimer);
    prog.hidden = true;
    if (!r.ok || j.status === false || j.success === false) throw new Error(j.message || ('HTTP ' + r.status));
    if (!j.url) throw new Error('Respon tidak berisi URL media');
    renderResult(j);
  } catch (e) {
    clearInterval(stepTimer);
    prog.hidden = true;
    $('dlErrMsg').textContent = e.message;
    $('dlErr').hidden = false;
  } finally { saverBusy = false; $('dlGo').disabled = false; }
}
$('dlForm').addEventListener('submit', (e) => { e.preventDefault(); runSaver($('dlInput').value); });

/* ---------- ENDPOINT CARDS ---------- */
let dlRoutes = [];
async function execRoute(btn, route, i) {
  if (btn.disabled) return;
  const params = {};
  (route.params || []).forEach((p) => {
    const el = document.getElementById(`dl-${i}-${p.name}`);
    if (el && el.value) params[p.name] = el.value;
  });
  const missing = (route.params || []).filter((p) => p.required && !params[p.name]);
  if (missing.length) { toast('Isi dulu: ' + missing.map((p) => p.name).join(', ')); return; }
  const out = $(`dl-out-${i}`), body = $(`dl-body-${i}`), dot = $(`dl-dot-${i}`), st = $(`dl-st-${i}`), ms = $(`dl-ms-${i}`);
  btn.disabled = true;
  out.hidden = false;
  dot.className = 'sdot';
  st.textContent = 'SENDING…';
  body.textContent = 'connecting…';
  const method = (route.method || 'GET').toUpperCase();
  let url = route.endpoint;
  const opts = { method };
  if (method === 'GET' && Object.keys(params).length) url += '?' + new URLSearchParams(params);
  if (method !== 'GET') { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(params); }
  const t0 = Date.now();
  const tick = setInterval(() => { ms.textContent = (Date.now() - t0) + 'ms'; }, 60);
  try {
    const r = await fetch(url, opts);
    clearInterval(tick);
    ms.textContent = (Date.now() - t0) + 'ms';
    st.textContent = r.status + ' ' + r.statusText;
    dot.className = 'sdot ' + (r.ok ? 'g' : 'r');
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('json')) body.innerHTML = hl(await r.json());
    else body.textContent = await r.text();
  } catch (e) {
    clearInterval(tick);
    st.textContent = 'ERR';
    dot.className = 'sdot r';
    body.textContent = 'CONNECTION_REFUSED: ' + e.message;
  } finally { btn.disabled = false; }
}
function renderEps() {
  const box = $('dlList');
  $('dlCount').textContent = dlRoutes.length;
  box.innerHTML = '';
  if (!dlRoutes.length) { box.innerHTML = '<p style="color:var(--mut)">Belum ada endpoint downloader.</p>'; return; }
  dlRoutes.forEach((r, i) => {
    const card = document.createElement('article');
    card.className = 'aicard';
    const inputs = (r.params || []).map((p) => `
      <div class="field">
        <label>${esc(p.name)} ${p.required ? '<b>*required</b>' : '<span>opsional</span>'}</label>
        <input id="dl-${i}-${esc(p.name)}" type="text" placeholder="${esc(p.description || p.name)}">
      </div>`).join('');
    card.innerHTML = `
      <div class="ai-hd">
        <span class="ai-cat">DOWNLOAD / SAVER ${i + 1}</span>
        <div class="ai-title"><span class="mbadge">${esc((r.method || 'GET').toUpperCase())}</span><h3>${esc(r.name || r.endpoint)}</h3><code>${esc(r.endpoint)}</code></div>
      </div>
      <div class="ai-params">${inputs}</div>
      <div class="ai-ft">
        <button class="btn pri sm" data-exec="${i}"><i class="fa-solid fa-play"></i> EXECUTE</button>
        <button class="btn sm" data-send="${i}"><i class="fa-solid fa-download"></i> SEND TO SAVER</button>
      </div>
      <div class="ai-out" id="dl-out-${i}" hidden>
        <div class="ai-out-hd"><span class="sdot" id="dl-dot-${i}"></span><span id="dl-st-${i}">—</span><span class="ms" id="dl-ms-${i}">—</span></div>
        <div class="ai-out-bd" id="dl-body-${i}"></div>
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll('[data-exec]').forEach((b) => b.addEventListener('click', () => execRoute(b, dlRoutes[+b.dataset.exec], +b.dataset.exec)));
  box.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => {
    const r = dlRoutes[+b.dataset.send];
    setSaver(r);
    const inp = document.getElementById(`dl-${(+b.dataset.send)}-url`);
    if (inp && inp.value) { $('dlInput').value = inp.value; showTab('saver'); runSaver(inp.value); }
    else { showTab('saver'); $('dlInput').focus(); }
  }));
}

/* boot */
async function load() {
  try {
    const cfg = await (await fetch('/config')).json();
    if (cfg.settings?.favicon) $('favicon').href = cfg.settings.favicon;
    if (cfg.settings?.apiName) $('nav-title').textContent = 'KURO//NEKO';
    dlRoutes = ((cfg.tags || {}).download || []).map((r) => ({ cat: 'download', ...r }));
    renderEps();
    const segs = location.pathname.split('/').filter(Boolean);
    const deep = segs.length >= 2 && segs[0] === 'download' ? dlRoutes.find((r) => r.filename === segs[1]) : null;
    setSaver(deep || dlRoutes[0] || null);
    setPill(true, 'ONLINE');
  } catch (e) {
    $('dlList').innerHTML = '<p style="color:var(--acc)">Gagal memuat config: ' + esc(e.message) + '</p>';
    setPill(false, 'OFFLINE');
  }
  if (location.hash === '#endpoints') showTab('eps');
}
load();
