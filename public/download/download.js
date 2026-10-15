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

/* ---------- SAVER ---------- */
const STEPS = ['Fetching…', 'Parsing payload…', 'Resolving links…', 'Verifying files…'];
const THREAD_SAMPLES = [
  ['cth: foto', 'https://www.threads.com/share/BAFMYe__aO/'],
  ['cth: video', 'https://www.threads.com/share/BAo4O5AVfz/'],
  ['cth: carousel', 'https://www.threads.com/share/BAdzD60DJQ/']
];
const YOUTUBE_SAMPLES = [
  ['cth: video', 'https://youtu.be/b-9tRgohoDQ'],
  ['cth: shorts', 'https://youtube.com/shorts/s4AeeuCSSf8'],
  ['cth: music', 'https://music.youtube.com/watch?v=fFMPxt-XNIk']
];
const YOUTUBE2_SAMPLES = [
  ['cth: video', 'https://youtu.be/b-9tRgohoDQ'],
  ['cth: shorts', 'https://youtube.com/shorts/s4AeeuCSSf8'],
  ['cth: music', 'https://music.youtube.com/watch?v=fFMPxt-XNIk']
];
const YOUTUBE3_SAMPLES = [
  ['cth: video', 'https://youtu.be/b-9tRgohoDQ'],
  ['cth: shorts', 'https://youtube.com/shorts/s4AeeuCSSf8'],
  ['cth: music', 'https://music.youtube.com/watch?v=fFMPxt-XNIk']
];
const TWITTER_SAMPLES = [
  ['cth: video', 'https://x.com/1alemikelam/status/2106459255695974810'],
  ['cth: foto', 'https://x.com/Baggie_Nsk/status/2106466624374997081'],
  ['cth: slide', 'https://x.com/nopiiee__/status/2106635673155543249']
];
const TIKTOK_SAMPLES = [
  ['cth: video', 'https://vt.tiktok.com/ZSbu4wAhD/'],
  ['cth: foto', 'https://vt.tiktok.com/ZSbuqRdmJ/'],
  ['cth: slide', 'https://vt.tiktok.com/ZSbubfQ6m/']
];
const INSTAGRAM_SAMPLES = [
  ['cth: reel', 'https://www.instagram.com/reel/Dd-z940TxNu/'],
  ['cth: foto', 'https://www.instagram.com/p/Dd_E1DuTuQK/'],
  ['cth: slide', 'https://www.instagram.com/p/Dd_a45ME7an/']
];
const TERABOX_SAMPLES = [
  ['cth: file', 'https://www.terabox.com/wap/share/filelist?surl=DgO16Ts6xQte_PbWjgLv4g']
];
const SAMPLE_MAP = {
  threads: THREAD_SAMPLES,
  youtube: YOUTUBE_SAMPLES,
  youtube2: YOUTUBE2_SAMPLES,
  youtube3: YOUTUBE3_SAMPLES,
  twitter: TWITTER_SAMPLES,
  tiktok: TIKTOK_SAMPLES,
  instagram: INSTAGRAM_SAMPLES,
  terabox: TERABOX_SAMPLES
};
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
  (SAMPLE_MAP[route.filename] || []).forEach(([label, sample]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', () => { $('dlInput').value = sample; runSaver(sample); });
    chips.appendChild(b);
  });
}

function dlBtn(href, label, fname) {
  return `<a class="btn grn sm" href="${esc(href)}" download="${esc(fname)}" target="_blank" rel="noopener"><i class="fa-solid fa-download"></i> ${esc(label)}</a>`;
}

function fnameOf(href, fallback) {
  try {
    const u = new URL(href, location.origin);
    const fn = u.searchParams.get('fn');
    return fn ? decodeURIComponent(fn) : fallback;
  } catch { return fallback; }
}

function renderYouTube(j) {
  if (j.kind === 'post') return renderYouTubePost(j);
  const a = j.author || {};
  const st = j.stats || {};
  const ver = j.verification || {};
  const cap = j.caption || {};
  const prog = j.video?.progressive || null;
  const adaptive = j.video?.adaptive || [];
  const audios = j.audio || [];
  const music = j.music || null;
  const type = (j.type || 'video').toUpperCase();

  const preview = (prog && prog.download?.proxy) || null;
  const thumb = j.thumbnail?.url || null;

  let player = '';
  if (preview) player = `<div class="shot"><video controls preload="metadata" src="${esc(preview)}" poster="${esc(thumb || '')}"></video></div>`;
  else if (thumb) player = `<div class="shot"><img loading="lazy" src="${esc(thumb)}" alt="thumbnail"></div>`;

  const resRow = (f, i) => {
    const href = f.download?.proxy || f.url;
    const ok = f.download?.ok;
    const ext = fnameOf(href, 'video.mp4').split('.').pop();
    const label = `${f.quality || f.itag}${f.fps ? '@' + f.fps + 'fps' : ''} ${ext.toUpperCase()}`;
    const fname = fnameOf(href, `youtube-${j.video_id || 'video'}-${f.itag}.${ext}`);
    return `<div class="yt-fmt"><span class="yt-lbl">${esc(label)}${ok === false ? ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>' : ''}</span>${dlBtn(href, 'SAVE', fname)}</div>`;
  };

  const videoFmts = [];
  if (prog) videoFmts.push(resRow(prog, -1));
  adaptive.forEach((f, i) => videoFmts.push(resRow(f, i)));
  const audioFmts = audios.map((f, i) => resRow(f, i));

  const musicHtml = music ? `
    <div class="yt-sec"><p class="yt-h">MUSIC (AUDIO ONLY)</p>
      <div class="yt-grid">
        ${music.best_m4a ? resRow(music.best_m4a, 0) : ''}
        ${music.best_quality ? resRow(music.best_quality, 1) : ''}
      </div></div>` : '';

  const tags = [...(cap.hashtags || []).map((t) => '#' + t), ...(cap.mentions || []).map((t) => '@' + t)].join(' ');

  return `
    <div class="r-hd">
      ${a.avatar ? `<img src="${esc(a.avatar)}" alt="avatar" loading="lazy">` : ''}
      <div class="r-who">
        <b>${esc(a.name || j.video_id || 'YouTube')}</b>
        <span>${esc(j.published_at ? String(j.published_at).slice(0, 10) : '')} • ${esc(j.subtitle ? j.subtitle.language.toUpperCase() : '')}</span>
      </div>
      <span class="typebadge">${esc(type)}</span>
    </div>
    <p class="r-cap"><b>${esc(j.title || '')}</b>${j.duration ? ` — ${esc(j.duration)}` : ''}</p>
    <div class="r-stats">
      <span><i class="fa-solid fa-eye"></i><b>${fmtNum(st.view)}</b> views</span>
      <span><i class="fa-solid fa-heart"></i><b>${fmtNum(st.like)}</b> likes</span>
      <span><i class="fa-solid fa-comment"></i><b>${fmtNum(st.comment)}</b> comments</span>
      ${a.subscribers ? `<span><i class="fa-solid fa-user"></i><b>${fmtNum(a.subscribers)}</b> subs</span>` : ''}
    </div>
    ${player ? `<div class="r-media one">${player}</div>` : ''}
    <div class="yt-sec"><p class="yt-h">VIDEO (${videoFmts.length})</p><div class="yt-grid">${videoFmts.join('') || '<p class="yt-empty">tidak ada format video</p>'}</div></div>
    <div class="yt-sec"><p class="yt-h">AUDIO (${audioFmts.length})</p><div class="yt-grid">${audioFmts.join('') || '<p class="yt-empty">tidak ada format audio</p>'}</div></div>
    ${musicHtml}
    ${cap.text ? `<p class="r-cap">${esc(cap.text.slice(0, 600))}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY SEMUA LINK</button>
      <a class="btn sm" href="${esc(j.links?.watch || j.source_url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN YOUTUBE</a>
    </div>
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.all_ok ? 'vok' : 'vbad'}">${ver.all_ok ? 'ALL OK' : (ver.playable + '/' + ver.checked) + ' OK'}</span>
      <span>• id ${esc(String(j.video_id || ''))}</span>
    </div>`;
}

function renderYouTubePost(j) {
  const a = j.author || {};
  const st = j.stats || {};
  const ver = j.verification || {};
  const cap = j.caption || {};
  const list = j.url?.image_list || [];
  const type = (j.type || 'image').toUpperCase();

  let mediaHtml = '';
  list.forEach((it) => {
    const href = it.proxy || it.url;
    const fname = fnameOf(href, `post-${it.index}.jpg`);
    mediaHtml += `<div class="shot"><img loading="lazy" src="${esc(href)}" alt="media ${it.index}">${dlBtn(href, `PHOTO ${list.length > 1 ? it.index : ''}`.trim(), fname)}</div>`;
  });
  if (!mediaHtml) mediaHtml = '<p style="padding:0 20px 6px;color:var(--mut);font-size:12.5px">Text post — tidak ada media.</p>';

  const tags = [...(cap.hashtags || []).map((t) => '#' + t), ...(cap.mentions || []).map((t) => '@' + t)].join(' ');

  return `
    <div class="r-hd">
      ${a.avatar ? `<img src="${esc(a.avatar)}" alt="avatar" loading="lazy">` : ''}
      <div class="r-who"><b>${esc(a.name || 'YouTube')}</b><span>${esc(j.published_text || '')}</span></div>
      <span class="typebadge">POST ${esc(type)}</span>
    </div>
    ${cap.text ? `<p class="r-cap">${esc(cap.text)}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    <div class="r-stats">
      <span><i class="fa-solid fa-heart"></i><b>${fmtNum(st.like)}</b> likes</span>
    </div>
    <div class="r-media ${list.length > 1 ? 'multi' : 'one'}">${mediaHtml}</div>
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY SEMUA LINK</button>
      <a class="btn sm" href="${esc(j.links?.post || j.source_url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN POST</a>
    </div>
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.all_ok ? 'vok' : 'vbad'}">${ver.all_ok ? 'ALL OK' : (ver.playable + '/' + ver.images_checked) + ' OK'}</span>
      <span>• id ${esc(String(j.post_id || ''))}</span>
    </div>`;
}

function renderThreads(j) {
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

  return `
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
}

function renderTwitter(j) {
  const t = j.tweet || {};
  const a = t.author || {};
  const st = t.stats || {};
  const cap = t.caption || {};
  const ver = j.verification || {};
  const media = j.media || [];
  const type = (j.type || 'media').toUpperCase();
  const pid = t.id || 'tweet';

  const tags = [...(cap.hashtags || []).map((x) => '#' + x), ...(cap.mentions || []).map((x) => '@' + x)].join(' ');
  let mediaHtml = '';
  media.forEach((m, i) => {
    const dl = m.download || {};
    const n = media.length > 1 ? ` ${i + 1}` : '';
    if (m.type === 'video' || m.type === 'gif') {
      const mp4s = (m.variants || []).filter((v) => v.type === 'mp4' && v.download && v.download.proxy);
      const rows = mp4s.map((v) => {
        const lbl = v.resolution ? v.resolution.split('x')[0] + 'p' : 'MP4';
        return `<div class="yt-fmt"><span class="yt-lbl">${esc(lbl)}${v.bitrate ? ` • ${Math.round(v.bitrate / 1000)}k` : ''}</span>${dlBtn(v.download.proxy, 'SAVE', fnameOf(v.download.proxy, `twitter-${pid}.mp4`))}</div>`;
      }).join('');
      mediaHtml += `<div class="shot"><video controls preload="metadata"${m.thumbnail ? ` poster="${esc(m.thumbnail)}"` : ''} src="${esc(dl.proxy || m.cdn_url || '')}"></video></div>${rows ? `<div class="yt-sec"><p class="yt-h">VIDEO${n} — MP4 (${mp4s.length})</p><div class="yt-grid">${rows}</div></div>` : ''}`;
    } else {
      const src = dl.proxy || m.cdn_url || '';
      mediaHtml += `<div class="shot"><img loading="lazy" src="${esc(src)}" alt="photo${n}">${dl.proxy ? dlBtn(dl.proxy, `PHOTO${n}`, fnameOf(dl.proxy, `twitter-${pid}.jpg`)) : ''}</div>`;
    }
  });

  return `
    <div class="r-hd">
      ${a.avatar ? `<img src="${esc(a.avatar)}" alt="avatar" loading="lazy">` : ''}
      <div class="r-who">
        <b>${esc(a.name || 'X')}${a.verified ? ' <i class="fa-solid fa-circle-check"></i>' : ''}</b>
        <span>@${esc(a.username || '?')}${t.created_at ? ` • ${esc(String(t.created_at).slice(0, 16))}` : ''}</span>
      </div>
      <span class="typebadge">${esc(type)}</span>
    </div>
    ${cap.text ? `<p class="r-cap">${esc(cap.text.slice(0, 600))}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    <div class="r-stats">
      <span><i class="fa-solid fa-heart"></i><b>${fmtNum(st.like)}</b></span>
      <span><i class="fa-solid fa-comment"></i><b>${fmtNum(st.comment)}</b></span>
      <span><i class="fa-solid fa-retweet"></i><b>${fmtNum(st.retweet)}</b></span>
      <span><i class="fa-solid fa-quote-left"></i><b>${fmtNum(st.quote)}</b></span>
      <span><i class="fa-solid fa-eye"></i><b>${fmtNum(st.view)}</b></span>
      <span><i class="fa-solid fa-bookmark"></i><b>${fmtNum(st.save)}</b></span>
    </div>
    <div class="r-media ${media.length > 1 ? 'multi' : 'one'}">${mediaHtml}</div>
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY LINKS</button>
      <a class="btn sm" href="${esc(t.url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN POST</a>
    </div>
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.ok ? 'vok' : 'vbad'}">${ver.ok ? 'OK' : 'CHECK FAILED'}</span>
      <span>• via ${esc((j.source || []).join('+'))}</span>
      <span>• id ${esc(String(pid))}</span>
    </div>`;
}

function renderTikTok(j) {
  const dl = j.download || {};
  const a = j.author || {};
  const cap = j.caption || {};
  const ver = j.verification || {};
  const type = (j.type || 'media').toUpperCase();
  const imgs = dl.images || [];
  const tags = (cap.hashtags || []).map((x) => '#' + x).join(' ');

  let player = '';
  if (dl.video) player = `<div class="shot"><video controls preload="metadata" src="${esc(dl.video.proxy)}"${dl.thumbnail ? ` poster="${esc(dl.thumbnail.proxy || dl.thumbnail.url || '')}"` : ''}></video>${dlBtn(dl.video.proxy, 'VIDEO MP4', dl.video.filename)}</div>`;
  let audio = '';
  if (dl.audio) audio = `<div style="padding:0 20px 10px">${dlBtn(dl.audio.proxy, 'AUDIO', dl.audio.filename)}</div>`;
  let grid = '';
  if (imgs.length) grid = `<div class="yt-sec"><p class="yt-h">PHOTOS (${imgs.length})</p><div class="r-media ${imgs.length > 1 ? 'multi' : 'one'}">${imgs.map((im, i) => `<div class="shot"><img loading="lazy" src="${esc(im.proxy || im.url)}" alt="photo ${i + 1}">${im.proxy ? dlBtn(im.proxy, `PHOTO ${imgs.length > 1 ? i + 1 : ''}`.trim(), im.filename) : ''}</div>`).join('')}</div></div>`;
  let ss = '';
  if (dl.slideshow && (dl.slideshow.video || dl.slideshow.photos || dl.slideshow.bundle)) {
    const s = dl.slideshow;
    ss = `<div class="yt-sec"><p class="yt-h">SLIDESHOW MP4 / ZIP</p><div class="yt-grid">`
      + (s.video ? `<div class="yt-fmt"><span class="yt-lbl">VIDEO MP4</span>${dlBtn(s.video.proxy, 'SAVE', s.video.filename)}</div>` : '')
      + (s.photos ? `<div class="yt-fmt"><span class="yt-lbl">PHOTOS ZIP</span>${dlBtn(s.photos.proxy, 'SAVE', s.photos.filename)}</div>` : '')
      + (s.bundle ? `<div class="yt-fmt"><span class="yt-lbl">BUNDLE ZIP</span>${dlBtn(s.bundle.proxy, 'SAVE', s.bundle.filename)}</div>` : '')
      + `</div></div>`;
  }

  return `
    <div class="r-hd">
      <div class="r-who">
        <b>${esc(a.nickname || 'TikTok')}</b>
        <span>${esc(j.id ? 'id ' + j.id : '')}</span>
      </div>
      <span class="typebadge">${esc(type)}</span>
    </div>
    ${cap.text ? `<p class="r-cap">${esc(cap.text.slice(0, 600))}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    ${player ? `<div class="r-media one">${player}</div>` : ''}
    ${audio}${grid}${ss}
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY LINKS</button>
      <a class="btn sm" href="${esc(j.final_url || j.source_url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN POST</a>
    </div>
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.all_cdn_ok ? 'vok' : 'vbad'}">${ver.all_cdn_ok ? 'ALL OK' : 'CHECK FAILED'}</span>
      <span>• id ${esc(String(j.id || ''))}</span>
    </div>`;
}

function renderInstagram(j) {
  const dl = j.download || {};
  const a = j.author || {};
  const st = j.stats || {};
  const cap = j.caption || {};
  const cm = j.comments || {};
  const ver = j.verification || {};
  const mu = j.music || {};
  const type = (j.type || 'media').toUpperCase();
  const imgs = dl.images || [];
  const tags = [...(cap.hashtags || []).map((x) => '#' + x), ...(cap.mentions || []).map((x) => '@' + x)].join(' ');

  const vids = [];
  if (dl.video) vids.push(dl.video);
  (dl.videos || []).forEach((v) => { if (v && v.proxy && (!dl.video || v.proxy !== dl.video.proxy)) vids.push(v); });
  let mediaHtml = vids.map((v, i) => `<div class="shot"><video controls preload="metadata" src="${esc(v.proxy)}"${dl.thumbnail ? ` poster="${esc(dl.thumbnail.proxy || dl.thumbnail.url || '')}"` : ''}></video>${dlBtn(v.proxy, `VIDEO ${vids.length > 1 ? i + 1 : ''} MP4`.trim(), v.filename)}</div>`).join('');
  if (imgs.length) mediaHtml += imgs.map((im, i) => `<div class="shot"><img loading="lazy" src="${esc(im.proxy || im.url)}" alt="photo ${i + 1}">${im.proxy ? dlBtn(im.proxy, `PHOTO ${imgs.length > 1 ? i + 1 : ''}`.trim(), im.filename) : ''}</div>`).join('');
  if (!vids.length && !imgs.length && dl.thumbnail) mediaHtml += `<div class="shot"><img loading="lazy" src="${esc(dl.thumbnail.proxy || dl.thumbnail.url)}" alt="thumbnail">${dlBtn(dl.thumbnail.proxy, 'THUMBNAIL', dl.thumbnail.filename)}</div>`;
  if (dl.audio) mediaHtml += `<div style="padding:0 20px 10px">${dlBtn(dl.audio.proxy, 'AUDIO', dl.audio.filename)}</div>`;

  const topCm = (cm.top || []).slice(0, 5).map((c) =>
    `<div style="padding:8px 0;border-top:1px solid var(--line);font-size:12.5px"><b>@${esc(c.username || '?')}</b> <span style="color:var(--mut)">♥${fmtNum(c.like_count)}</span><br>${esc(c.text || '')}</div>`
  ).join('');
  const cmNote = !cm.available && cm.reason ? `<p style="padding:0 20px 6px;color:var(--mut);font-size:12px">${esc(cm.reason)}</p>` : '';

  return `
    <div class="r-hd">
      <div class="r-who">
        <b>@${esc(a.username || '?')} ${a.is_verified ? '<i class="fa-solid fa-circle-check"></i>' : ''}</b>
        <span>${esc(j.posted_at ? String(j.posted_at).slice(0, 10) : '')}</span>
      </div>
      <span class="typebadge">${esc(type)}</span>
    </div>
    ${cap.text ? `<p class="r-cap">${esc(cap.text.slice(0, 600))}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    <div class="r-stats">
      <span><i class="fa-solid fa-heart"></i><b>${fmtNum(st.like)}</b></span>
      <span><i class="fa-solid fa-eye"></i><b>${fmtNum(st.view)}</b></span>
      <span><i class="fa-solid fa-comment"></i><b>${fmtNum(st.comment)}</b> comments</span>
      ${mu.title ? `<span><i class="fa-solid fa-music"></i><b>${esc(mu.title)}</b>${mu.artist ? ` — ${esc(mu.artist)}` : ''}</span>` : ''}
    </div>
    <div class="r-media ${(vids.length + imgs.length) > 1 ? 'multi' : 'one'}">${mediaHtml}</div>
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY LINKS</button>
      <a class="btn sm" href="${esc(j.permalink || j.source_url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN POST</a>
    </div>
    ${topCm ? `<div style="padding:0 20px 6px"><p style="font-size:11px;color:var(--mut)">TOP COMMENTS (${fmtNum(cm.count)})</p>${topCm}</div>` : cmNote}
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.all_cdn_ok ? 'vok' : 'vbad'}">${ver.all_cdn_ok ? 'ALL OK' : 'CHECK FAILED'}</span>
      <span>• ${esc(String(j.shortcode || ''))}</span>
    </div>`;
}

function renderYouTube2(j) {
  const mp4s = ((j.cdn || {}).mp4 || []).filter((m) => m.url);
  const mp3s = ((j.cdn || {}).mp3 || []).filter((m) => m.url);
  const st = j.stats || {};
  const cap = j.caption || {};
  const au = j.author || {};
  const ver = j.verification || {};
  const type = (j.type || 'video').toUpperCase();
  const vid = j.video_id || '';

  const best = mp4s[mp4s.length - 1] || mp4s[0] || null;
  const preview = (best && best.download && best.download.proxy) || null;
  let player = '';
  if (preview) player = `<div class="shot"><video controls preload="metadata" src="${esc(preview)}" poster="${esc(j.thumbnail || '')}"></video></div>`;
  else if (j.thumbnail) player = `<div class="shot"><img loading="lazy" src="${esc(j.thumbnail)}" alt="thumbnail"></div>`;

  const mp4Rows = mp4s.map((m) => {
    const href = (m.download && m.download.proxy) || m.url;
    const ok = m.download && m.download.ok;
    return `<div class="yt-fmt"><span class="yt-lbl">${esc(m.quality || '')} MP4${ok === false ? ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>' : ''}</span>${dlBtn(href, 'SAVE', fnameOf(href, `youtube2-${vid}.mp4`))}</div>`;
  }).join('');
  const mp3Rows = mp3s.map((m) => {
    const href = (m.download && m.download.proxy) || m.url;
    const ok = m.download && m.download.ok;
    const extra = m.filesize ? ` • ${(m.filesize / 1048576).toFixed(1)}MB` : '';
    return `<div class="yt-fmt"><span class="yt-lbl">${esc(m.bitrate || '')}${esc(extra)}${ok === false ? ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>' : ''}</span>${dlBtn(href, 'SAVE', fnameOf(href, `youtube2-${vid}.mp3`))}</div>`;
  }).join('');

  const tags = [...(cap.hashtags || []).map((x) => '#' + x), ...(cap.mentions || []).map((x) => '@' + x)].join(' ');

  return `
    <div class="r-hd">
      <div class="r-who">
        <b>${esc(j.title || vid || 'YouTube')}</b>
        <span>${esc(au.name || '')}${j.duration ? ` • ${esc(j.duration)}` : ''}${j.published_at ? ` • ${esc(String(j.published_at).slice(0, 10))}` : ''}</span>
      </div>
      <span class="typebadge">${esc(type)} • Y2</span>
    </div>
    <div class="r-stats">
      <span><i class="fa-solid fa-eye"></i><b>${esc(st.view_formatted || fmtNum(st.view))}</b> views</span>
      <span><i class="fa-solid fa-heart"></i><b>${esc(st.like_formatted || fmtNum(st.like))}</b> likes</span>
      <span><i class="fa-solid fa-comment"></i><b>${esc(st.comment_formatted || fmtNum(st.comment))}</b> comments</span>
      ${j.category ? `<span><i class="fa-solid fa-tag"></i><b>${esc(j.category)}</b></span>` : ''}
    </div>
    ${player ? `<div class="r-media one">${player}</div>` : ''}
    <div class="yt-sec"><p class="yt-h">VIDEO MP4 (${mp4s.length}) — via y2meta</p><div class="yt-grid">${mp4Rows || '<p class="yt-empty">tidak ada format video</p>'}</div></div>
    <div class="yt-sec"><p class="yt-h">AUDIO MP3 (${mp3s.length})</p><div class="yt-grid">${mp3Rows || '<p class="yt-empty">tidak ada format audio</p>'}</div></div>
    ${cap.text ? `<p class="r-cap">${esc(cap.text.slice(0, 600))}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY SEMUA LINK</button>
      <a class="btn sm" href="${esc((j.links && j.links.watch) || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN YOUTUBE</a>
    </div>
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.all_ok ? 'vok' : 'vbad'}">${ver.all_ok ? 'ALL OK' : (ver.playable + '/' + ver.checked) + ' OK'}</span>
      <span>• id ${esc(String(vid))}</span>
    </div>`;
}

function renderYouTube3(j) {
  const vids = ((j.cdn || {}).video || []).filter((m) => m.url);
  const auds = ((j.cdn || {}).audio || []).filter((m) => m.url);
  const st = j.stats || {};
  const cap = j.caption || {};
  const au = j.author || {};
  const ver = j.verification || {};
  const type = (j.type || 'video').toUpperCase();
  const vid = j.video_id || '';

  const best = vids[vids.length - 1] || vids[0] || null;
  const preview = (best && best.download && best.download.proxy) || null;
  let player = '';
  if (preview) player = `<div class="shot"><video controls preload="metadata" src="${esc(preview)}" poster="${esc(j.thumbnail || '')}"></video></div>`;
  else if (j.thumbnail) player = `<div class="shot"><img loading="lazy" src="${esc(j.thumbnail)}" alt="thumbnail"></div>`;

  const vRows = vids.map((m) => {
    const href = (m.download && m.download.proxy) || m.url;
    const ok = m.download && m.download.ok;
    const size = m.size ? ` • ${(m.size / 1048576).toFixed(1)}MB` : '';
    return `<div class="yt-fmt"><span class="yt-lbl">${esc(m.quality || m.extension || 'video')}${esc(size)}${ok === false ? ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>' : ''}</span>${dlBtn(href, 'SAVE', fnameOf(href, `youtube3-${vid}.mp4`))}</div>`;
  }).join('');
  const aRows = auds.map((m) => {
    const href = (m.download && m.download.proxy) || m.url;
    const ok = m.download && m.download.ok;
    const size = m.size ? ` • ${(m.size / 1048576).toFixed(1)}MB` : '';
    return `<div class="yt-fmt"><span class="yt-lbl">${esc(m.extension || 'audio')}${esc(size)}${ok === false ? ' <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>' : ''}</span>${dlBtn(href, 'SAVE', fnameOf(href, `youtube3-${vid}.m4a`))}</div>`;
  }).join('');

  const tags = [...(cap.hashtags || []).map((x) => '#' + x), ...(cap.mentions || []).map((x) => '@' + x)].join(' ');

  return `
    <div class="r-hd">
      <div class="r-who">
        <b>${esc(j.title || vid || 'YouTube')}</b>
        <span>${esc(au.name || '')}${j.duration ? ` • ${esc(j.duration)}` : ''}${j.published_at ? ` • ${esc(String(j.published_at).slice(0, 10))}` : ''}</span>
      </div>
      <span class="typebadge">${esc(type)} • Y3</span>
    </div>
    <div class="r-stats">
      <span><i class="fa-solid fa-eye"></i><b>${esc(st.view_formatted || fmtNum(st.view))}</b> views</span>
      <span><i class="fa-solid fa-heart"></i><b>${esc(st.like_formatted || fmtNum(st.like))}</b> likes</span>
      <span><i class="fa-solid fa-comment"></i><b>${esc(st.comment_formatted || fmtNum(st.comment))}</b> comments</span>
      ${st.engagement_rate ? `<span><i class="fa-solid fa-chart-line"></i><b>${esc(st.engagement_rate)}%</b> eng</span>` : ''}
    </div>
    ${player ? `<div class="r-media one">${player}</div>` : ''}
    <div class="yt-sec"><p class="yt-h">VIDEO (${vids.length}) — via ytultra</p><div class="yt-grid">${vRows || '<p class="yt-empty">tidak ada format video</p>'}</div></div>
    <div class="yt-sec"><p class="yt-h">AUDIO (${auds.length})</p><div class="yt-grid">${aRows || '<p class="yt-empty">tidak ada format audio</p>'}</div></div>
    ${cap.text ? `<p class="r-cap">${esc(cap.text.slice(0, 600))}${tags ? `\n\n${esc(tags)}` : ''}</p>` : ''}
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY SEMUA LINK</button>
      <a class="btn sm" href="${esc((j.links && j.links.watch) || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN YOUTUBE</a>
    </div>
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.all_ok ? 'vok' : 'vbad'}">${ver.all_ok ? 'ALL OK' : (ver.playable + '/' + ver.checked) + ' OK'}</span>
      <span>• id ${esc(String(vid))}</span>
    </div>`;
}

function renderTerabox(j) {
  const files = j.files || [];
  const ver = j.verification || {};
  const rows = files.map((f, i) => {
    const fn = (f.download && f.download.filename) || f.filename || `file-${i + 1}`;
    return `<div class="yt-fmt"><span class="yt-lbl">${esc(f.filename || fn)}${f.size_formatted ? ` • ${esc(f.size_formatted)}` : ''}</span>${f.download && f.download.proxy ? dlBtn(f.download.proxy, 'SAVE', fn) : '<span class="yt-empty">no link</span>'}</div>`;
  }).join('');

  return `
    <div class="r-hd">
      <div class="r-who">
        <b>${esc(j.title || 'Terabox')}</b>
        <span>${esc(files.length + ' file')}</span>
      </div>
      <span class="typebadge">FILE</span>
    </div>
    <div class="yt-sec"><p class="yt-h">FILES (${files.length})</p><div class="yt-grid">${rows || '<p class="yt-empty">tidak ada file</p>'}</div></div>
    <div class="r-actions">
      <button class="btn sm" id="copyAllBtn" type="button"><i class="fa-solid fa-link"></i> COPY LINKS</button>
      <a class="btn sm" href="${esc(j.source_url || '#')}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN SHARE</a>
    </div>
    <div class="r-foot">
      <span>CDN:</span>
      <span class="${ver.ok ? 'vok' : 'vbad'}">${ver.ok ? `OK • ${esc(ver.content_type || '')}` : 'CHECK FAILED'}</span>
    </div>`;
}

function renderGeneric(j) {
  const r = j.result !== undefined ? j.result : j;
  let action = '';
  if (typeof r === 'string' && /^https?:\/\//.test(r)) {
    action = `<div class="r-actions"><a class="btn grn sm" href="${esc(r)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> OPEN LINK</a><button class="btn sm" id="copyResBtn" type="button"><i class="fa-solid fa-copy"></i> COPY</button></div>`;
  }
  return `<p class="r-cap">RAW RESPONSE</p><div style="padding:0 20px 6px"><div class="ai-out-bd" style="border:1px solid var(--line);border-radius:10px;padding:14px">${hl(j)}</div></div>${action}`;
}

function renderResult(j) {
  const box = $('dlResult');
  const isThreads = j && j.url && (j.post_id || j.author || j.stats);
  const isYouTube = j && (j.kind === 'video' || j.kind === 'post') && j.success === true;
  const kind = j && j.kind;
  box.innerHTML = kind === 'tweet' ? renderTwitter(j)
    : kind === 'youtube2' ? renderYouTube2(j)
    : kind === 'youtube3' ? renderYouTube3(j)
    : kind === 'tiktok' ? renderTikTok(j)
    : kind === 'instagram' ? renderInstagram(j)
    : kind === 'terabox' ? renderTerabox(j)
    : isYouTube ? renderYouTube(j) : (isThreads ? renderThreads(j) : renderGeneric(j));
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const allLinks = [];
  box.querySelectorAll('a[download]').forEach((a) => allLinks.push(a.href));
  const cAll = $('copyAllBtn');
  if (cAll) cAll.addEventListener('click', async () => {
    if (await copyText(allLinks.join('\n'))) toast(allLinks.length + ' link disalin');
    else toast('Copy gagal — salin manual');
  });
  const cRes = $('copyResBtn');
  if (cRes) {
    const r = (j.result !== undefined ? j.result : j);
    cRes.addEventListener('click', async () => {
      if (await copyText(typeof r === 'string' ? r : JSON.stringify(r))) toast('Disalin');
      else toast('Copy gagal — salin manual');
    });
  }
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
    if (!r.ok || j.status === false || j.success === false) throw new Error(j.error || j.message || ('HTTP ' + r.status));
    renderResult(j);
  } catch (e) {
    clearInterval(stepTimer);
    prog.hidden = true;
    $('dlErrMsg').textContent = e.message;
    $('dlErr').hidden = false;
  } finally { saverBusy = false; $('dlGo').disabled = false; }
}
$('dlForm').addEventListener('submit', (e) => { e.preventDefault(); runSaver($('dlInput').value); });

/* boot */
const DL_ICON = {
  threads: 'fa-solid fa-comment-dots',
  youtube: 'fa-brands fa-youtube',
  youtube2: 'fa-solid fa-circle-play',
  youtube3: 'fa-solid fa-circle-down',
  twitter: 'fa-brands fa-x-twitter',
  tiktok: 'fa-brands fa-tiktok',
  instagram: 'fa-brands fa-instagram',
  terabox: 'fa-solid fa-box-archive'
};
const dlIcon = (f) => DL_ICON[f] || 'fa-solid fa-download';

function renderChooser(routes) {
  const grid = $('dlPickGrid');
  grid.innerHTML = '';
  if (!routes.length) {
    grid.innerHTML = '<p class="pick-empty">Belum ada downloader tersedia.</p>';
    return;
  }
  routes.forEach((r) => {
    const card = document.createElement('a');
    card.className = 'pick-card';
    card.href = '/download/' + r.filename;
    card.innerHTML = `
      <span class="pick-ic"><i class="${dlIcon(r.filename)}"></i></span>
      <span class="pick-bx">
        <b>${esc(r.name || r.filename)}</b>
        <code>${esc(r.endpoint)}</code>
      </span>
      <span class="pick-go"><i class="fa-solid fa-arrow-right"></i></span>`;
    grid.appendChild(card);
  });
}

function renderSwitch(routes, active) {
  const el = $('dlSwitch');
  el.innerHTML = '';
  const all = document.createElement('a');
  all.className = 'sw';
  all.href = '/download';
  all.innerHTML = '<i class="fa-solid fa-grip"></i> SEMUA';
  el.appendChild(all);
  routes.forEach((r) => {
    const a = document.createElement('a');
    a.className = 'sw' + (active && r.filename === active.filename ? ' on' : '');
    a.href = '/download/' + r.filename;
    a.innerHTML = `<i class="${dlIcon(r.filename)}"></i> ${esc((r.name || r.filename).split(' ')[0].toUpperCase())}`;
    el.appendChild(a);
  });
}

async function load() {
  try {
    const cfg = window.__CFG__ || {};
    if (cfg.settings?.favicon) $('favicon').href = cfg.settings.favicon;
    const apiName = cfg.settings?.apiName || 'K-APIs';
    const routes = ((cfg.tags || {}).download || []).map((r) => ({ cat: 'download', ...r }));
    const segs = location.pathname.split('/').filter(Boolean);
    const deepName = segs[0] === 'download' && segs.length >= 2 ? segs[1] : null;
    const deep = deepName ? routes.find((r) => r.filename === deepName) : null;

    if (deep) {
      document.title = `${apiName} | ${deep.name || deep.filename}`;
      $('dlPick').hidden = true;
      $('dlSaver').hidden = false;
      renderSwitch(routes, deep);
      setSaver(deep);
    } else {
      document.title = `${apiName} | Downloader`;
      $('dlPick').hidden = false;
      $('dlSaver').hidden = true;
      renderChooser(routes);
    }
    setPill(true, 'ONLINE');
  } catch (e) {
    setPill(false, 'OFFLINE');
    $('dlErrMsg').textContent = 'Gagal memuat config: ' + e.message;
    $('dlErr').hidden = false;
  }
}
load();
