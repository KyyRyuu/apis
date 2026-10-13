const $ = (id) => document.getElementById(id);
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

const SAMPLES = {
  yts: ['Alan Walker Faded', 'lofi hip hop radio', 'coldplay yellow'],
  pinterest: ['anime wallpaper', 'room decor aesthetic', 'ghibli wallpaper']
};

let searchRoutes = [];
let busy = false;
function curEp() { return $('modelSel').value; }
function curRoute() { return searchRoutes.find((r) => r.endpoint === curEp()); }

function setEngine(route) {
  if (!route) return;
  $('searchTitle').textContent = ((route.name || 'SEARCH') + '').toUpperCase().slice(0, 24);
  const chips = $('sampleChips');
  chips.innerHTML = '';
  (SAMPLES[route.filename] || []).forEach((s) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = 'cth: ' + s;
    b.addEventListener('click', () => { $('qInput').value = s; runSearch(s); });
    chips.appendChild(b);
  });
}

function clearOut() {
  $('qGrid').innerHTML = '';
  $('qPins').innerHTML = '';
  $('qRaw').hidden = true;
  $('qMeta').hidden = true;
  $('qErr').hidden = true;
}

function renderYt(items, q) {
  $('qMeta').innerHTML = `<b>${items.length}</b> videos untuk “${esc(q)}”`;
  $('qMeta').hidden = false;
  $('qGrid').innerHTML = items.map((v) => `
    <article class="yt">
      <a class="thumb" href="${esc(v.url || '#')}" target="_blank" rel="noopener">
        <img loading="lazy" src="${esc(v.thumbnail || '')}" alt="${esc(v.title || 'video')}">
        ${v.duration ? `<span class="dur">${esc(v.duration)}</span>` : ''}
      </a>
      <div class="pad">
        <h3>${esc(v.title || 'Untitled')}</h3>
        <p class="sub2">${esc(v.views || '')} • ${esc(v.uploaded || '')}</p>
        <div class="row">
          <a class="btn sm" href="${esc(v.url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-play"></i> WATCH</a>
          <button class="btn sm" data-copy="${esc(v.url || '')}" type="button"><i class="fa-solid fa-copy"></i></button>
        </div>
      </div>
    </article>`).join('');
  wireCopy();
}

function renderPins(items, q) {
  $('qMeta').innerHTML = `<b>${items.length}</b> pins untuk “${esc(q)}”`;
  $('qMeta').hidden = false;
  $('qPins').innerHTML = items.map((p) => `
    <article class="pin">
      <img loading="lazy" src="${esc(p.image || '')}" alt="${esc(p.title || 'pin')}">
      <div class="pad">
        <h3>${esc((p.title || '').slice(0, 90))}</h3>
        <p class="who">@${esc(p.username || '?')}${p.board ? ' • ' + esc(p.board) : ''}</p>
        <div class="row">
          <a class="btn sm" href="${esc(p.source || p.image || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN</a>
          <a class="btn sm" href="${esc(p.image || '#')}" download target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> SAVE</a>
        </div>
      </div>
    </article>`).join('');
}

function renderGeneric(j, q) {
  $('qMeta').innerHTML = `RAW — “${esc(q)}”`;
  $('qMeta').hidden = false;
  $('qRawBd').innerHTML = hl(j);
  $('qRaw').hidden = false;
}

function wireCopy() {
  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Link disalin'); }
    catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = b.dataset.copy; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        if (document.execCommand('copy')) toast('Link disalin');
        else toast('Copy gagal — salin manual');
        ta.remove();
      } catch { toast('Copy gagal — salin manual'); }
    }
  }));
}

async function runSearch(rawQ) {
  const q = (rawQ || '').trim();
  if (!q) { toast('Ketik pencarian dulu'); return; }
  const route = curRoute();
  if (!route || busy) return;
  busy = true;
  $('qGo').disabled = true;
  clearOut();
  $('qProg').hidden = false;
  try {
    const key = ((route.params || [])[0] || {}).name || 'q';
    const r = await fetch(route.endpoint + '?' + new URLSearchParams({ [key]: q }));
    const j = await r.json();
    $('qProg').hidden = true;
    if (!r.ok || j.status === false) throw new Error(j.message || ('HTTP ' + r.status));
    const items = Array.isArray(j.result) ? j.result : (j.result ? [j.result] : []);
    if (!items.length) {
      $('qErrMsg').textContent = 'Nihil — tidak ada hasil untuk "' + q + '"';
      $('qErr').hidden = false;
      return;
    }
    if (route.filename === 'yts') renderYt(items, q);
    else if (route.filename === 'pinterest') renderPins(items, q);
    else renderGeneric(j, q);
  } catch (e) {
    $('qProg').hidden = true;
    $('qErrMsg').textContent = e.message;
    $('qErr').hidden = false;
  } finally { busy = false; $('qGo').disabled = false; }
}
$('qForm').addEventListener('submit', (e) => { e.preventDefault(); runSearch($('qInput').value); });
$('modelSel').addEventListener('change', () => {
  clearOut();
  setEngine(curRoute());
  $('qInput').focus();
});

async function load() {
  try {
    const cfg = await (await fetch('/config')).json();
    if (cfg.settings?.favicon) $('favicon').href = cfg.settings.favicon;
    if (cfg.settings?.apiName) document.title = `${cfg.settings.apiName} | Search`;
    searchRoutes = ((cfg.tags || {}).search || []).map((r) => ({ cat: 'search', ...r }));
    const sel = $('modelSel');
    searchRoutes.forEach((r) => {
      const o = document.createElement('option');
      o.value = r.endpoint;
      o.textContent = `${r.name || r.endpoint} [${(r.method || 'GET').toUpperCase()}]`;
      sel.appendChild(o);
    });
    const segs = location.pathname.split('/').filter(Boolean);
    const deep = segs.length >= 2 && segs[0] === 'search' ? searchRoutes.find((r) => r.filename === segs[1]) : null;
    if (deep) sel.value = deep.endpoint;
    setEngine(curRoute() || searchRoutes[0]);
    setPill(true, 'ONLINE');
  } catch (e) {
    setPill(false, 'OFFLINE');
    $('qErrMsg').textContent = 'Gagal memuat config: ' + e.message;
    $('qErr').hidden = false;
  }
}
load();
