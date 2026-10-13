const $ = (id) => document.getElementById(id);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
function fmtText(s) {
  return esc(s)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }
}

/* playground */
let aiRoutes = [];
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
  d.innerHTML = `<span class="who">${role === 'me' ? 'YOU' : 'K-APIs'}</span><div class="bubble">${html}</div>
    <div class="meta"><button class="mini" type="button">COPY</button></div>`;
  d.querySelector('.mini').addEventListener('click', async () => {
    if (await copyText(raw)) toast('Pesan disalin');
    else toast('Copy gagal — salin manual');
  });
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
  return d.querySelector('.bubble');
}
function greet(r) {
  const box = $('chatBox');
  if (box.dataset.model === r.endpoint || box.children.length) { box.dataset.model = r.endpoint; return; }
  box.dataset.model = r.endpoint;
  addMsg('ai', fmtText(`Halo! Aku ${r.name || 'AI'}. Tulis apa aja di bawah.`), 'halo');
}
async function send(text) {
  const q = (text || '').trim();
  if (!q || sending) return;
  const model = curModel();
  if (!model) { toast('Model belum siap'); return; }
  sending = true;
  $('chatInput').value = '';
  addMsg('me', fmtText(q), q);
  $('typingRow').hidden = false;
  $('chatBox').scrollTop = $('chatBox').scrollHeight;
  try {
    const url = model + '?' + new URLSearchParams({ q, ...(sessions[model] ? { session: sessions[model] } : {}) });
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
    if (cfg.settings?.apiName) document.title = `${cfg.settings.apiName} | AI Chat`;
    aiRoutes = ((cfg.tags || {}).ai || []).map((r) => ({ cat: 'ai', ...r }));
    const sel = $('modelSel');
    aiRoutes.forEach((r) => {
      const o = document.createElement('option');
      o.value = r.endpoint;
      o.textContent = `${r.name || r.endpoint} [${(r.method || 'GET').toUpperCase()}]`;
      sel.appendChild(o);
      sessions[r.endpoint] = '';
    });
    updateSess();
    const segs = location.pathname.split('/').filter(Boolean);
    const deep = segs.length >= 2 && segs[0] === 'ai' ? aiRoutes.find((r) => r.filename === segs[1]) : null;
    if (deep) {
      sel.value = deep.endpoint;
      updateSess();
      greet(deep);
    } else if (aiRoutes[0]) greet(aiRoutes[0]);
    setPill(true, 'ONLINE');
  } catch (e) {
    $('chatBox').innerHTML = '<p style="color:var(--acc)">Gagal memuat config: ' + esc(e.message) + '</p>';
    setPill(false, 'OFFLINE');
  }
  $('chatInput').focus();
}
load();
