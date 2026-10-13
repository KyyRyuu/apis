const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
function fmtText(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}

/* tabs */
const tabEp = $('tab-endpoints'), tabPlay = $('tab-play');
function showTab(which) {
  const isPlay = which === 'play';
  tabEp.classList.toggle('active', !isPlay);
  tabPlay.classList.toggle('active', isPlay);
  tabEp.setAttribute('aria-selected', String(!isPlay));
  tabPlay.setAttribute('aria-selected', String(isPlay));
  $('view-list').hidden = isPlay;
  $('view-play').hidden = !isPlay;
  if (isPlay) setTimeout(() => $('chatInput').focus(), 50);
  try { if (/^\/ai\/?(#play)?$/.test(location.pathname)) history.replaceState(null, '', isPlay ? '/ai#play' : '/ai'); } catch {}
}
tabEp.addEventListener('click', () => showTab('list'));
tabPlay.addEventListener('click', () => showTab('play'));

/* endpoint cards */
let aiRoutes = [];
async function execRoute(btn, route, i) {
  if (btn.disabled) return;
  const params = {};
  (route.params || []).forEach((p) => {
    const el = document.getElementById(`ai-${i}-${p.name}`);
    if (el && el.value) params[p.name] = el.value;
  });
  const missing = (route.params || []).filter((p) => p.required && !params[p.name]);
  if (missing.length) { toast('Isi dulu: ' + missing.map((p) => p.name).join(', ')); return; }
  const out = $(`ai-out-${i}`), body = $(`ai-body-${i}`), dot = $(`ai-dot-${i}`), st = $(`ai-st-${i}`), ms = $(`ai-ms-${i}`);
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
    const dt = Date.now() - t0;
    ms.textContent = dt + 'ms';
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
function renderList() {
  const box = $('aiList');
  $('aiCount').textContent = aiRoutes.length;
  box.innerHTML = '';
  if (!aiRoutes.length) { box.innerHTML = '<p style="color:var(--mut)">Belum ada endpoint AI.</p>'; return; }
  aiRoutes.forEach((r, i) => {
    const card = document.createElement('article');
    card.className = 'aicard';
    const inputs = (r.params || []).map((p) => `
      <div class="field">
        <label>${esc(p.name)} ${p.required ? '<b>*required</b>' : '<span>opsional</span>'}</label>
        ${/q|prompt|message|text/i.test(p.name)
          ? `<textarea id="ai-${i}-${esc(p.name)}" rows="2" placeholder="${esc(p.description || p.name)}"></textarea>`
          : `<input id="ai-${i}-${esc(p.name)}" type="text" placeholder="${esc(p.description || p.name)}">`}
      </div>`).join('');
    card.innerHTML = `
      <div class="ai-hd">
        <span class="ai-cat">AI / MODEL ${i + 1}</span>
        <div class="ai-title"><span class="mbadge">${esc((r.method || 'GET').toUpperCase())}</span><h3>${esc(r.name || r.endpoint)}</h3><code>${esc(r.endpoint)}</code></div>
      </div>
      <div class="ai-params">${inputs || '<p style="color:var(--mut);font-size:12px">Tanpa parameter.</p>'}</div>
      <div class="ai-ft">
        <button class="btn pri sm" data-exec="${i}"><i class="fa-solid fa-play"></i> EXECUTE</button>
        <button class="btn sm" data-try="${i}"><i class="fa-solid fa-message"></i> TRY IN PLAYGROUND</button>
      </div>
      <div class="ai-out" id="ai-out-${i}" hidden>
        <div class="ai-out-hd"><span class="sdot" id="ai-dot-${i}"></span><span id="ai-st-${i}">—</span><span class="ms" id="ai-ms-${i}">—</span></div>
        <div class="ai-out-bd" id="ai-body-${i}"></div>
      </div>`;
    box.appendChild(card);
  });
  box.querySelectorAll('[data-exec]').forEach((b) => b.addEventListener('click', () => execRoute(b, aiRoutes[+b.dataset.exec], +b.dataset.exec)));
  box.querySelectorAll('[data-try]').forEach((b) => b.addEventListener('click', () => {
    const r = aiRoutes[+b.dataset.try];
    $('modelSel').value = r.endpoint;
    sessions[r.endpoint] = '';
    updateSess();
    showTab('play');
    greet(r);
  }));
}

/* playground */
const sessions = {};
let sending = false;
function curModel() { return $('modelSel').value; }
function updateSess() {
  const s = sessions[curModel()];
  const b = $('sessBadge');
  b.textContent = s ? 'SESSION: ACTIVE' : 'SESSION: NEW';
  b.classList.toggle('on', !!s);
}
function addMsg(role, html, raw) {
  const box = $('chatBox');
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = `<span class="who">${role === 'me' ? 'YOU' : 'KURO//NEKO'}</span><div class="bubble">${html}</div>
    <div class="meta"><button class="mini" type="button">COPY</button></div>`;
  d.querySelector('.mini').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(raw); toast('Pesan disalin'); } catch {}
  });
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  return d.querySelector('.bubble');
}
function greet(r) {
  const box = $('chatBox');
  if (box.dataset.model === r.endpoint || box.children.length) { box.dataset.model = r.endpoint; return; }
  box.dataset.model = r.endpoint;
  addMsg('ai', fmtText(`Halo! Aku ${r.name || 'AI'}. Tulis apa aja, aku jawab langsung dari <b>${esc(r.endpoint)}</b>.`), 'halo');
}
async function send(text) {
  const q = (text || '').trim();
  if (!q || sending) return;
  const model = curModel();
  if (!model) { toast('Pilih model dulu'); return; }
  sending = true;
  $('chatInput').value = '';
  addMsg('me', fmtText(q), q);
  $('typingRow').hidden = false;
  $('chatBox').scrollTop = $('chatBox').scrollHeight;
  try {
    const url = model + '?' + new URLSearchParams({ q, ...(sessions[model] ? { session: sessions[model] } : {}) });
    const t0 = Date.now();
    const r = await fetch(url);
    const j = await r.json();
    $('typingRow').hidden = true;
    if (!r.ok || j.status === false) throw new Error(j.message || ('HTTP ' + r.status));
    if (j.session) { sessions[model] = j.session; updateSess(); }
    const answer = j.response || j.result || JSON.stringify(j);
    const bub = addMsg('ai', '', answer);
    if (reduced) bub.innerHTML = fmtText(answer);
    else {
      let i = 0;
      const step = Math.max(1, Math.floor(answer.length / 120));
      while (i < answer.length) {
        i = Math.min(answer.length, i + step);
        bub.innerHTML = fmtText(answer.slice(0, i));
        $('chatBox').scrollTop = $('chatBox').scrollHeight;
        await sleep(12);
      }
      bub.innerHTML = fmtText(answer);
    }
    void t0;
  } catch (e) {
    $('typingRow').hidden = true;
    const d = document.createElement('div');
    d.className = 'msg ai err';
    d.innerHTML = `<span class="who">SYSTEM</span><div class="bubble">${esc(e.message)}</div>`;
    $('chatBox').appendChild(d);
  } finally { sending = false; $('chatInput').focus(); }
}
$('chatForm').addEventListener('submit', (e) => { e.preventDefault(); send($('chatInput').value); });
$('modelSel').addEventListener('change', () => {
  updateSess();
  const r = aiRoutes.find((x) => x.endpoint === curModel());
  if (r) greet(r);
});
$('newChatBtn').addEventListener('click', () => {
  sessions[curModel()] = '';
  $('chatBox').innerHTML = '';
  delete $('chatBox').dataset.model;
  updateSess();
  const r = aiRoutes.find((x) => x.endpoint === curModel());
  if (r) greet(r);
  toast('Chat baru dimulai');
});

/* boot */
async function load() {
  try {
    const cfg = await (await fetch('/config')).json();
    if (cfg.settings?.favicon) $('favicon').href = cfg.settings.favicon;
    if (cfg.settings?.apiName) $('nav-title').textContent = 'KURO//NEKO';
    aiRoutes = ((cfg.tags || {}).ai || []).map((r) => ({ cat: 'ai', ...r }));
    const sel = $('modelSel');
    aiRoutes.forEach((r) => {
      const o = document.createElement('option');
      o.value = r.endpoint;
      o.textContent = `${r.name || r.endpoint} [${(r.method || 'GET').toUpperCase()}]`;
      sel.appendChild(o);
      sessions[r.endpoint] = '';
    });
    renderList();
    updateSess();
    const segs = location.pathname.split('/').filter(Boolean);
    const deep = segs.length >= 2 && segs[0] === 'ai' ? aiRoutes.find((r) => r.filename === segs[1]) : null;
    if (deep) {
      sel.value = deep.endpoint;
      updateSess();
      greet(deep);
      showTab('play');
    } else if (aiRoutes[0]) greet(aiRoutes[0]);
    setPill(true, 'ONLINE');
  } catch (e) {
    $('aiList').innerHTML = '<p style="color:var(--acc)">Gagal memuat config: ' + esc(e.message) + '</p>';
    setPill(false, 'OFFLINE');
  }
  if (location.hash === '#play') showTab('play');
}
load();
