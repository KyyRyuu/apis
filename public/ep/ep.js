const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SECTIONS = { ai: '/ai', download: '/download', search: '/search' };

let toastT;
function toast(msg) {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => $('toast').classList.remove('show'), 2600);
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

function notFound(cat, ep) {
  document.title = 'Not found — K-APIs';
  $('crumbs').innerHTML = `<a href="/">HOME</a><span>/</span><a href="/docs">DOCS</a><span>/</span><b>404</b>`;
  $('epCard').innerHTML = `<div class="notfound"><h1>404 // NO SUCH ROUTE</h1><p>/${esc(cat)}/${esc(ep)} tidak terdaftar.</p><p style="margin-top:16px"><a class="btn sm" href="/docs" style="text-decoration:none">BACK TO DOCS</a></p></div>`;
}

async function execRoute(btn, route) {
  if (btn.disabled) return;
  const params = {};
  (route.params || []).forEach((p) => {
    const el = document.getElementById(`f-${p.name}`);
    if (el && el.value) params[p.name] = el.value;
  });
  const missing = (route.params || []).filter((p) => p.required && !params[p.name]);
  if (missing.length) { toast('Isi dulu: ' + missing.map((p) => p.name).join(', ')); return; }
  const out = $('epOut'), body = $('epBody'), dot = $('epDot'), st = $('epSt'), ms = $('epMs');
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
    if (ct.includes('json')) {
      const j = await r.json();
      const direct = j && typeof j.result === 'string' && /^https?:\/\//.test(j.result) ? j.result : null;
      body.innerHTML = (direct
        ? `<div style="display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap"><a class="btn sm" href="${esc(direct)}" target="_blank" rel="noopener" style="text-decoration:none">OPEN LINK</a><button class="btn sm" id="epCopyLink" type="button">COPY</button></div>`
        : '') + hl(j);
      const cb = document.getElementById('epCopyLink');
      if (cb && direct) cb.addEventListener('click', async () => {
        if (await copyText(direct)) toast('Link disalin');
        else toast('Copy gagal — salin manual');
      });
    }
    else if (ct.startsWith('image')) {
      const blob = await r.blob();
      body.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="result">`;
    } else body.textContent = await r.text();
  } catch (e) {
    clearInterval(tick);
    st.textContent = 'ERR';
    dot.className = 'sdot r';
    body.textContent = 'CONNECTION_REFUSED: ' + e.message;
  } finally { btn.disabled = false; }
}

async function load() {
  const segs = location.pathname.split('/').filter(Boolean);
  const cat = segs[0] || '', ep = segs[1] || '';
  try {
    const cfg = await (await fetch('/config')).json();
    if (cfg.settings?.favicon) $('favicon').href = cfg.settings.favicon;
    const routes = ((cfg.tags || {})[cat] || []);
    const route = routes.find((r) => r.filename === ep);
    setPill(true, 'ONLINE');
    if (!route) { notFound(cat, ep); setPill(true, 'ONLINE'); return; }

    document.title = `${route.name} — K-APIs`;
    const method = (route.method || 'GET').toUpperCase();
    const mc = method === 'POST' ? 'post' : method === 'DELETE' ? 'delete' : method === 'GET' ? '' : 'other';
    const secLink = SECTIONS[cat] ? `<a href="${SECTIONS[cat]}" title="Buka halaman ${esc(cat)}"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${esc(cat.toUpperCase())}</a>` : '';
    $('crumbs').innerHTML = `<a href="/">HOME</a><span>/</span><a href="/docs">DOCS</a><span>/</span><a href="/docs?cat=${esc(cat)}">${esc(cat.toUpperCase())}</a><span>/</span><b>${esc(ep)}</b>`;
    const inputs = (route.params || []).map((p) => `
      <div class="field">
        <label>${esc(p.name)} ${p.required ? '<b>*required</b>' : '<span>opsional</span>'}</label>
        ${/q|prompt|message|text|url/i.test(p.name)
          ? `<textarea id="f-${esc(p.name)}" rows="2" placeholder="${esc(p.description || p.name)}"></textarea>`
          : `<input id="f-${esc(p.name)}" type="text" placeholder="${esc(p.description || p.name)}">`}
      </div>`).join('');
    $('epCard').innerHTML = `
      <div class="ep-hd">
        <span class="ep-cat">/${esc(cat).toUpperCase()} ${secLink}</span>
        <div class="ep-title"><span class="mbadge ${mc}">${esc(method)}</span><h1>${esc(route.name || route.endpoint)}</h1><code>${esc(route.endpoint)}</code></div>
        <p class="ep-desc">Test langsung dari browser. Isi parameter lalu EXECUTE.</p>
      </div>
      <div class="ep-params">${inputs || '<p style="color:var(--mut);font-size:13px">Tanpa parameter.</p>'}</div>
      <div class="ep-ft">
        <button class="btn pri" id="execBtn"><i class="fa-solid fa-play"></i> EXECUTE</button>
        <button class="btn sm" id="copyBtn"><i class="fa-solid fa-copy"></i> COPY URL</button>
      </div>
      <div class="ep-out" id="epOut" hidden>
        <div class="ep-out-hd"><span class="sdot" id="epDot"></span><span id="epSt">—</span><span class="ms" id="epMs">—</span></div>
        <div class="ep-out-bd" id="epBody"></div>
      </div>`;
    $('execBtn').addEventListener('click', (e) => execRoute(e.currentTarget, route));
    $('copyBtn').addEventListener('click', async () => {
      if (await copyText(location.origin + route.endpoint)) toast('URL disalin');
      else toast('Copy gagal — salin manual');
    });
  } catch (e) {
    setPill(false, 'OFFLINE');
    notFound(cat, ep);
  }
}
load();
