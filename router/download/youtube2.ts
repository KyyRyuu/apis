/*
 * YouTube Downloader 2 (y2meta base)
 * type: Scraper + Proxy
 * base: https://y2meta.nu/en3/ -> https://y2meta.nu/convert/ -> https://api.ytmp3.tube/widgetplus/1
 * author: wa.me/ikyykzy
 * note: ambil CDN URL via y2meta (widgetplus API) + full statistik video.
 *       KEUNGGULAN vs youtube.ts: CDN di-mint oleh server y2meta (egress IP mereka),
 *       jadi tetap jalan saat IP server kita kena bot-check YouTube.
 *       Support: watch, shorts, live, embed, music, youtu.be. TIDAK support post
 *       (post tidak punya videoId -> pakai /api/download/youtube untuk post).
 *       SEMUA url CDN di-response sudah dibungkus link proxy (field "proxy") supaya
 *       user TIDAK perlu set header sendiri -> tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE_EN3 = 'https://y2meta.nu/en3/';
const BASE_CONVERT = 'https://y2meta.nu/convert/';
const WIDGET_BASE = 'https://api.ytmp3.tube/widgetplus/1';
const API_MP4 = 'https://api.ytmp3.tube/api/download/mp4';
const API_MP3 = 'https://api.ytmp3.tube/api/download/mp3';

const UA_BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const UA_ANDROID = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

const CDN_SUFFIXES = ['googlevideo.com', '123tokyo.xyz', '123tokyo.com'];

function proxyConf(): Record<string, any> {
    const raw = process.env.YOUTUBE2_PROXY || process.env.YOUTUBE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (!raw) return {};
    try {
        const u = new URL(raw);
        const conf: Record<string, any> = {
            proxy: {
                protocol: u.protocol.replace(':', ''),
                host: u.hostname,
                port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
            },
        };
        if (u.username) conf.proxy.auth = { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
        return conf;
    } catch {
        return {};
    }
}

function b64urlEncode(str: string): string {
    return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
    let pad = str.replace(/-/g, '+').replace(/_/g, '/');
    while (pad.length % 4) pad += '=';
    return Buffer.from(pad, 'base64').toString('utf8');
}

function sanitizeName(s: string): string {
    return String(s || 'file').replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '_').slice(0, 90) || 'file';
}

function isAllowedMediaHost(mediaUrl: string): boolean {
    try {
        const host = new URL(mediaUrl).hostname.toLowerCase();
        return CDN_SUFFIXES.some((sfx) => host === sfx || host.endsWith('.' + sfx));
    } catch {
        return false;
    }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 1000): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (err) {
            lastErr = err;
            const status = (err as any).response?.status || (err as any).status;
            const retryable = !status || status === 429 || status >= 500;
            if (!retryable || i === retries - 1) throw err;
            await sleep(baseDelay * (i + 1));
        }
    }
    throw lastErr;
}

function extractVideoId(url: string): string | null {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        const host = u.hostname.toLowerCase();
        const isYT = host.includes('youtube.com') || host.includes('youtu.be') || host.includes('youtube-nocookie.com');
        if (!isYT) return null;
        if (u.pathname.includes('/shorts/')) return u.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
        if (u.pathname.includes('/watch')) return u.searchParams.get('v');
        if (u.pathname.includes('/live/')) return u.pathname.split('/live/')[1].split('/')[0].split('?')[0];
        if (u.pathname.includes('/v/')) return u.pathname.split('/v/')[1].split('/')[0].split('?')[0];
        if (host === 'youtu.be') return u.pathname.slice(1).split('?')[0].split('/')[0] || null;
        if (u.pathname.includes('/embed/')) return u.pathname.split('/embed/')[1].split('?')[0].split('/')[0];
        const v = u.searchParams.get('v');
        if (v) return v;
        return null;
    } catch { return null; }
}

function isMusicSourceUrl(url: string): boolean {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        return u.hostname.toLowerCase().includes('music.youtube.com');
    } catch { return false; }
}

function cleanCaption(t: any): string { return t ? String(t).trim() : ''; }

function extractTags(text: any): { hashtags: string[]; mentions: string[] } {
    const hashtags: string[] = [], mentions: string[] = [];
    for (const m of String(text || '').matchAll(/#([\p{L}\p{N}_]{1,80})/gu)) if (!hashtags.includes(m[1])) hashtags.push(m[1]);
    for (const m of String(text || '').matchAll(/@([A-Za-z0-9._]{1,30})/g)) if (!mentions.includes(m[1])) mentions.push(m[1]);
    return { hashtags, mentions };
}

function formatNumber(num: any): string | null {
    if (num === null || num === undefined) return null;
    const n = Number(num);
    if (!Number.isFinite(n) || n <= 0) return n === 0 ? '0' : null;
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}

function parseCount(text: any): number | null {
    if (text === null || text === undefined) return null;
    const s = String(text).replace(/[^0-9.,KMBkm]/g, '').trim();
    if (!s) return null;
    const m = s.match(/^([\d.,]+)\s*([KMBkmb])?$/);
    if (!m) { const n = Number(String(text).replace(/[^\d]/g, '')); return Number.isFinite(n) ? n : null; }
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') n *= 1e3; else if (suf === 'M') n *= 1e6; else if (suf === 'B') n *= 1e9;
    return Math.round(n);
}

function parseDuration(seconds: any): string | null {
    if (seconds === null || seconds === undefined) return null;
    const s = Number(seconds);
    if (!Number.isFinite(s)) return null;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function sniffContainer(buf: any): string {
    if (!buf || buf.length < 4) return 'unknown';
    if (buf.length >= 12 && buf.slice(4, 8).toString('latin1') === 'ftyp') return 'mp4';
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
    if (buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
    return 'unknown';
}

async function checkCdnUrl(url: string | null): Promise<any> {
    const out: any = { ok: false, status: null, content_type: null, bytes: 0, container: null, error: null };
    if (!url) { out.error = 'URL tidak tersedia'; return out; }
    try {
        const res = await axios.get(url, {
            timeout: 15000, maxRedirects: 5, validateStatus: (s: number) => s < 500, responseType: 'arraybuffer',
            headers: { 'User-Agent': UA_ANDROID, Referer: 'https://www.youtube.com/', Range: 'bytes=0-2047' },
            ...proxyConf(),
        });
        const buf = Buffer.from(res.data || []);
        out.status = res.status;
        out.content_type = res.headers['content-type'] || null;
        out.bytes = buf.length;
        out.container = sniffContainer(buf);
        // mp3 dari 123tokyo kadang content-type octet-stream tapi magic ID3/ff — tetap ok
        const isMedia = out.container !== 'unknown' || /^(video|audio)\//i.test(out.content_type || '');
        out.ok = (res.status === 200 || res.status === 206) && buf.length > 0 && isMedia;
        if (!out.ok && !out.error) out.error = !isMedia ? 'isi bukan file media' : `http ${res.status}`;
    } catch (err) { out.error = (err as any).message; }
    return out;
}

// ---------- y2meta (base en3/convert -> widgetplus) ----------

async function fetchWidget(videoId: string): Promise<any> {
    const widgetUrl = `${WIDGET_BASE}?url=https://www.youtube.com/watch?v=${videoId}`;
    const res = await withRetry(() => axios.get(widgetUrl, {
        headers: { 'User-Agent': UA_BROWSER, Referer: BASE_CONVERT, Accept: 'text/html,*/*' },
        timeout: 20000,
        ...proxyConf(),
    }));
    const html = String(res.data || '');
    const $ = cheerio.load(html);
    const raw = $('#widget-data').text().trim();
    if (!raw) throw new Error('widget-data tidak ditemukan (y2meta mengubah layout / video tidak valid).');
    let w: any;
    try { w = JSON.parse(raw); } catch { throw new Error('Gagal parse widget-data y2meta.'); }
    if (!w.videoId || !w.token || !w.timestamp || !w.encryptedVideoId) {
        throw new Error('Token y2meta tidak lengkap.');
    }
    const thumb = $('img.thumbnail').attr('src') || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    return {
        videoId: w.videoId, token: w.token, timestamp: w.timestamp,
        secretToken: w.encryptedVideoId, widgetTitle: w.videoTitle || null,
        titleAvailable: Boolean(w.isTitleAvailable),
        thumbnailWidget: thumb, widgetUrl,
    };
}

async function fetchMp4Quality(widget: any, quality: string): Promise<string> {
    const body = {
        id: widget.videoId, videoQuality: String(quality),
        token: widget.token, timestamp: widget.timestamp, secretToken: widget.secretToken,
    };
    const res = await withRetry(() => axios.post(API_MP4, body, {
        headers: {
            'User-Agent': UA_BROWSER, Referer: BASE_CONVERT,
            Origin: 'https://y2meta.nu', 'Content-Type': 'application/json',
        },
        timeout: 30000,
        ...proxyConf(),
    }));
    const d = res.data || {};
    if (d.status !== 'ok' || !d.link) throw new Error(`y2meta mp4 ${quality}p gagal: ${d.msg || d.message || d.status || 'no link'}`);
    return d.link;
}

async function fetchMp3Bitrate(widget: any, bitrate: string, maxWaitMs = 45000, intervalMs = 2500): Promise<any> {
    const body = {
        id: widget.videoId, audioBitrate: String(bitrate),
        token: widget.token, timestamp: widget.timestamp, secretToken: widget.secretToken,
    };
    const headers = {
        'User-Agent': UA_BROWSER, Referer: BASE_CONVERT,
        Origin: 'https://y2meta.nu', 'Content-Type': 'application/json',
    };
    const t0 = Date.now();
    let last: any = null;
    while (Date.now() - t0 < maxWaitMs) {
        const res = await withRetry(() => axios.post(API_MP3, body, { headers, timeout: 30000, ...proxyConf() }));
        const d = res.data || {};
        last = d;
        if (d.status === 'ok' && d.link) return d;
        if (d.status === 'fail') throw new Error(`y2meta mp3 ${bitrate}kbps gagal: ${d.msg || 'fail'}`);
        await sleep(intervalMs);
    }
    throw new Error(`y2meta mp3 ${bitrate}kbps timeout (terakhir: ${JSON.stringify(last).slice(0, 200)})`);
}

// ---------- stats (oEmbed + InnerTube, CDN tetap dari y2meta) ----------

async function fetchOEmbed(videoId: string): Promise<any> {
    try {
        const r = await withRetry(() => axios.get(
            `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
            { headers: { 'User-Agent': UA_BROWSER }, timeout: 15000, ...proxyConf() }
        ));
        return r.data || null;
    } catch { return null; }
}

async function fetchPlayer(videoId: string): Promise<any> {
    const res = await withRetry(() => axios.post(
        `https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`,
        {
            context: {
                client: {
                    clientName: 'ANDROID', clientVersion: '20.10.38', hl: 'en', gl: 'US',
                    androidSdkVersion: 30, osName: 'Android', osVersion: '11',
                    platform: 'MOBILE', clientFormFactor: 'SMALL_FORM_FACTOR',
                    userAgent: UA_ANDROID,
                },
            },
            videoId, racyCheckOk: true, contentCheckOk: true,
        },
        {
            headers: { 'User-Agent': UA_ANDROID, 'Content-Type': 'application/json', Origin: 'https://www.youtube.com', Referer: `https://www.youtube.com/watch?v=${videoId}` },
            timeout: 20000,
            ...proxyConf(),
        }
    ));
    return res.data;
}

async function fetchNext(videoId: string): Promise<any> {
    try {
        const res = await withRetry(() => axios.post(
            `https://www.youtube.com/youtubei/v1/next?key=${API_KEY}`,
            { context: { client: { clientName: 'WEB', clientVersion: '2.20260923.00.00', hl: 'en', gl: 'US' } }, videoId },
            {
                headers: { 'User-Agent': UA_BROWSER, 'Content-Type': 'application/json', Origin: 'https://www.youtube.com', Referer: `https://www.youtube.com/watch?v=${videoId}` },
                timeout: 20000,
                ...proxyConf(),
            }
        ));
        return res.data;
    } catch { return null; }
}

function findLikeNode(node: any, depth = 0): any {
    if (!node || typeof node !== 'object' || depth > 12) return null;
    if (node.segmentedLikeDislikeButtonViewModel) return node.segmentedLikeDislikeButtonViewModel;
    if (Array.isArray(node)) { for (const v of node) { const f = findLikeNode(v, depth + 1); if (f) return f; } return null; }
    for (const v of Object.values(node)) { if (v && typeof v === 'object') { const f = findLikeNode(v, depth + 1); if (f) return f; } }
    return null;
}

function parseLikeFromNext(nextData: any): { short: string | null; exact: number | null } {
    try {
        const seg = findLikeNode(nextData);
        const likeVm = seg?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel;
        const btn = likeVm?.defaultButtonViewModel?.buttonViewModel || likeVm?.toggledButtonViewModel?.buttonViewModel;
        const title = btn?.title || null;
        const acc = btn?.accessibilityText || '';
        const exact = /along with ([\d,]+)/.exec(acc)?.[1]?.replace(/[^\d]/g, '');
        return { short: typeof title === 'string' ? title : null, exact: exact ? Number(exact) : parseCount(title) };
    } catch { return { short: null, exact: null }; }
}

function parseNextPrimary(nextData: any): any {
    const out: any = {};
    try {
        const contents = nextData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
        const prim = contents.find((c: any) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
        if (prim) {
            out.title = prim.title?.runs?.map((r: any) => r.text).join('') || null;
            out.viewText = prim.viewCount?.videoViewCountRenderer?.viewCount?.simpleText || null;
            out.viewShort = prim.viewCount?.videoViewCountRenderer?.shortViewCount?.simpleText || null;
            out.viewCount = parseCount(out.viewText);
            out.dateText = prim.dateText?.simpleText || null;
        }
        const sec = contents.find((c: any) => c.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
        if (sec?.owner?.videoOwnerRenderer) {
            const o = sec.owner.videoOwnerRenderer;
            out.owner = {
                name: o.title?.runs?.[0]?.text || null,
                channelId: o.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || o.navigationEndpoint?.browseEndpoint?.browseId || null,
                channelUrl: o.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl ? `https://www.youtube.com${o.title.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl}` : null,
                avatar: o.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null,
                subsText: o.subscriberCountText?.simpleText || null,
                subs: parseCount(o.subscriberCountText?.simpleText),
            };
        }
    } catch { /* abaikan */ }
    return out;
}

function parseCommentCount(nextData: any): number | null {
    try {
        const panels = nextData?.engagementPanels || [];
        const cm = panels.find((p: any) => String(p.engagementPanelSectionListRenderer?.panelIdentifier || '').includes('comment'));
        const runs = cm?.engagementPanelSectionListRenderer?.header?.engagementPanelTitleHeaderRenderer?.contextualInfo?.runs || [];
        return parseCount(runs.map((r: any) => r.text).join(''));
    } catch { return null; }
}

// ---------- main ----------

async function youtube2DL(inputUrl: string, opts: any = {}): Promise<any> {
    const startedAt = new Date().toISOString();
    const videoId = extractVideoId(inputUrl);
    if (!videoId) throw new Error('Invalid YouTube URL atau tipe post (post tidak punya videoId — pakai /api/download/youtube untuk post). Support: watch, shorts, live, embed, music, youtu.be');
    const fromMusic = isMusicSourceUrl(inputUrl);

    const qualities: string[] = opts.qualities || ['360', '480', '720', '1080'];
    const bitrates: string[] = opts.bitrates || ['128', '320'];
    const verify = opts.verify !== false;

    const widget = await fetchWidget(videoId);

    const mp4Results = await Promise.all(qualities.map(async (q) => {
        try {
            const link = await fetchMp4Quality(widget, q);
            const itag = (/[?&]itag=(\d+)/.exec(link) || [])[1] || null;
            return { quality: `${q}p`, videoQuality: String(q), itag: itag ? Number(itag) : null, format: 'mp4', url: link, error: null };
        } catch (e) { return { quality: `${q}p`, videoQuality: String(q), itag: null, format: 'mp4', url: null, error: (e as any).message }; }
    }));
    const mp4Ok = mp4Results.filter((x) => x.url);

    const mp3Results = await Promise.all(bitrates.map(async (b) => {
        try {
            const d = await fetchMp3Bitrate(widget, b);
            return { bitrate: `${b} kbps`, audioBitrate: String(b), format: 'mp3', url: d.link || null, title: d.title || null, duration_seconds: d.duration ? Number(d.duration) : null, filesize: d.filesize ? Number(d.filesize) : null, error: null };
        } catch (e) { return { bitrate: `${b} kbps`, audioBitrate: String(b), format: 'mp3', url: null, title: null, duration_seconds: null, filesize: null, error: (e as any).message }; }
    }));
    const mp3Ok = mp3Results.filter((x) => x.url);

    if (!mp4Ok.length && !mp3Ok.length) {
        throw new Error('y2meta tidak mengembalikan CDN apapun (mp4 & mp3 gagal semua).');
    }

    const [oembed, playerRes, nextRes] = await Promise.allSettled([
        fetchOEmbed(videoId), fetchPlayer(videoId), fetchNext(videoId),
    ]);
    const oe = oembed.status === 'fulfilled' ? oembed.value : null;
    const player = playerRes.status === 'fulfilled' ? playerRes.value : null;
    const nextData = nextRes.status === 'fulfilled' ? nextRes.value : null;
    const vd = player?.videoDetails || {};
    let mf = player?.microformat?.playerMicroformatRenderer || null;
    if (!mf) {
        try {
            const webRes = await axios.post(
                `https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`,
                { context: { client: { clientName: 'WEB', clientVersion: '2.20260923.00.00', hl: 'en', gl: 'US' } }, videoId },
                { headers: { 'User-Agent': UA_BROWSER, 'Content-Type': 'application/json', Origin: 'https://www.youtube.com', Referer: `https://www.youtube.com/watch?v=${videoId}` }, timeout: 20000, ...proxyConf() }
            );
            mf = webRes.data?.microformat?.playerMicroformatRenderer || null;
        } catch { /* abaikan */ }
    }

    const prim = nextData ? parseNextPrimary(nextData) : {};
    const likeInfo = nextData ? parseLikeFromNext(nextData) : { short: null, exact: null };
    const commentCount = nextData ? parseCommentCount(nextData) : null;

    const likeCount = likeInfo.exact ?? (mf?.likeCount ? Number(mf.likeCount) : null) ?? (Number(vd.likeCount || 0) || null);
    const viewCount = Number(vd.viewCount || 0) || prim.viewCount || (mf?.viewCount ? Number(mf.viewCount) : null) || null;

    const title = vd.title || prim.title || oe?.title || null;
    const description = vd.shortDescription || '';
    const captionText = cleanCaption(description) || cleanCaption(title || '');
    const captionSource = cleanCaption(description) ? 'description' : 'title';
    const tags = extractTags(`${title || ''}\n${description}`);

    const authorName = vd.author || prim.owner?.name || oe?.author_name || null;
    const channelId = vd.channelId || prim.owner?.channelId || null;
    const durationSec = vd.lengthSeconds ? Number(vd.lengthSeconds) : (mp3Ok[0]?.duration_seconds ?? null);
    const category = mf?.category || vd.category || null;
    const publishedAt = mf?.publishDate || mf?.uploadDate || null;
    const isMusic = fromMusic || category === 'Music';
    const type = /\/shorts\//i.test(inputUrl) ? 'short' : isMusic ? 'music' : (durationSec !== null && durationSec > 182 ? 'video' : 'short');

    const thumbs = vd.thumbnail?.thumbnails || [];
    const bestThumb = thumbs.filter((t: any) => t.url).sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
    const thumbnail = bestThumb?.url || oe?.thumbnail_url || widget.thumbnailWidget || null;

    let verification: any = { checked: 0, playable: 0, all_ok: false, details: [] };
    if (verify) {
        const all = [...mp4Ok.map((x) => ({ kind: 'mp4', label: x.quality, url: x.url })), ...mp3Ok.map((x) => ({ kind: 'mp3', label: x.bitrate, url: x.url }))];
        const details: any[] = [];
        for (const item of all) {
            const c = await checkCdnUrl(item.url);
            details.push({ kind: item.kind, label: item.label, url: item.url, ...c });
        }
        const ok = details.filter((d) => d.ok).length;
        verification = { checked: details.length, playable: ok, all_ok: details.length > 0 && ok === details.length, details };
        for (const m of mp4Results) { const f = details.find((d) => d.kind === 'mp4' && d.label === m.quality); if (f) (m as any).download = { ok: f.ok, status: f.status, content_type: f.content_type, bytes: f.bytes, container: f.container, error: f.error }; }
        for (const m of mp3Results) { const f = details.find((d) => d.kind === 'mp3' && d.label === m.bitrate); if (f) (m as any).download = { ok: f.ok, status: f.status, content_type: f.content_type, bytes: f.bytes, container: f.container, error: f.error }; }
    }

    const pick = (o: any): any => { const r: any = {}; for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') r[k] = v; return r; };

    const stats = pick({
        view: viewCount || null,
        view_formatted: viewCount ? formatNumber(viewCount) : null,
        like: likeCount || null,
        like_formatted: likeCount ? formatNumber(likeCount) : null,
        comment: commentCount,
        comment_formatted: commentCount !== null ? formatNumber(commentCount) : null,
    });

    const caption: any = pick({ text: captionText || null, source: captionSource });
    if (tags.hashtags.length) caption.hashtags = tags.hashtags;
    if (tags.mentions.length) caption.mentions = tags.mentions;

    const author = pick({
        name: authorName, channel_id: channelId,
        channel_url: channelId ? `https://www.youtube.com/channel/${channelId}` : (oe?.author_url || prim.owner?.channelUrl || null),
        handle_url: prim.owner?.channelUrl || null,
        avatar: prim.owner?.avatar || null,
        subscribers_text: prim.owner?.subsText || null,
        subscribers: prim.owner?.subs ?? null,
    });

    return {
        success: true,
        scraped_at: startedAt,
        base: BASE_EN3,
        base_convert: BASE_CONVERT,
        widget: widget.widgetUrl,
        source_url: inputUrl,
        source_domain: (() => { try { return new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`).hostname; } catch { return null; } })(),
        is_music_source: fromMusic,
        video_id: videoId,
        type,
        title,
        duration_seconds: durationSec,
        duration: durationSec !== null ? parseDuration(durationSec) : null,
        published_at: publishedAt,
        date_text: prim.dateText || null,
        category,
        links: {
            watch: `https://www.youtube.com/watch?v=${videoId}`,
            shorts: `https://www.youtube.com/shorts/${videoId}`,
            embed: `https://www.youtube.com/embed/${videoId}`,
            music: `https://music.youtube.com/watch?v=${videoId}`,
        },
        thumbnail,
        cdn: { mp4: mp4Results, mp3: mp3Results },
        url: {
            mp4_best: ((mp4Ok[mp4Ok.length - 1] as any)?.url || (mp4Ok[0] as any)?.url) || null,
            mp3_best: ((mp3Ok[mp3Ok.length - 1] as any)?.url || (mp3Ok[0] as any)?.url) || null,
        },
        caption,
        author,
        stats,
        verification,
    };
}

// ---------- proxy (header-free stream + refresh) ----------

function proxyLink(req: Request, mediaUrl: string, filename: string, extra: string): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}/api/download/youtube2?dl=${b64urlEncode(mediaUrl)}&fn=${encodeURIComponent(filename)}${extra}`;
}

async function fetchUpstream(mediaUrl: string, headers: Record<string, string>): Promise<any> {
    return axios.get(mediaUrl, {
        responseType: 'stream',
        ...proxyConf(),
        timeout: 30000,
        decompress: false,
        validateStatus: (s: number) => s < 400,
        maxRedirects: 5,
        headers,
    });
}

// Link y2meta kedaluwarsa cepat (terutama mp3 123tokyo, ±beberapa jam).
// refresh=videoId + qkind(mp4|mp3) + q(quality|bitrate): minta link baru, 1x retry.
async function refreshCdnUrl(videoId: string, qkind: string, q: string): Promise<string | null> {
    try {
        const widget = await fetchWidget(videoId);
        if (qkind === 'mp4') return await fetchMp4Quality(widget, q);
        const d = await fetchMp3Bitrate(widget, q);
        return d.link || null;
    } catch {
        return null;
    }
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'youtube2.bin');
    const refresh = req.query.refresh ? String(req.query.refresh) : null;
    const qkind = req.query.qkind ? String(req.query.qkind) : null;
    const q = req.query.q ? String(req.query.q) : null;

    let mediaUrl: string;
    try {
        mediaUrl = b64urlDecode(dlParam);
    } catch {
        res.status(400).json({ success: false, error: 'Parameter dl tidak valid' });
        return;
    }

    if (!isAllowedMediaHost(mediaUrl)) {
        res.status(400).json({ success: false, error: 'Host media tidak diizinkan' });
        return;
    }

    const range = req.headers.range;
    const headers: Record<string, string> = {
        'User-Agent': UA_ANDROID,
        Referer: 'https://www.youtube.com/',
    };
    if (range) headers.Range = String(range);

    let upstream: any = null;
    let lastErr: any = null;
    try {
        upstream = await fetchUpstream(mediaUrl, headers);
    } catch (err: any) {
        lastErr = err;
    }

    if (!upstream && refresh && qkind && q) {
        const fresh = await refreshCdnUrl(refresh, qkind, q);
        if (fresh && isAllowedMediaHost(fresh)) {
            try {
                upstream = await fetchUpstream(fresh, headers);
            } catch (err: any) {
                lastErr = err;
            }
        }
    }

    if (!upstream) throw lastErr || new Error('Gagal mengambil media');

    const h: any = upstream.headers || {};
    if (h['content-type']) res.setHeader('Content-Type', String(h['content-type']));
    if (h['content-length']) res.setHeader('Content-Length', String(h['content-length']));
    if (h['content-range']) res.setHeader('Content-Range', String(h['content-range']));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\\]/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');

    res.status(upstream.status);
    upstream.data.on('error', () => { try { res.end(); } catch { /* noop */ } });
    upstream.data.pipe(res);
}

// ---------- handler ----------

export default async function youtube2Handler(req: Request, res: Response) {
    try {
        if (req.query.dl !== undefined && req.query.dl !== '') {
            await proxyMedia(req, res);
            return;
        }

        const input = String(req.query.url || (req.body && (req.body as any).url) || '');
        if (!input) {
            res.status(400).json({ success: false, error: 'Parameter url wajib diisi (watch/shorts/live/embed/music/youtu.be; post tidak didukung)' });
            return;
        }

        const r = await youtube2DL(input);
        const vid = String(r.video_id || 'video');
        const tag = sanitizeName((r.title || vid).slice(0, 40));

        const linkMp4 = (m: any): void => {
            if (!m.url) { m.download = { ...(m.download || {}), proxy: null }; return; }
            const q = String(m.videoQuality || '360');
            const fn = sanitizeName(`youtube2_${tag}_${vid}_${q}p.mp4`);
            m.download = { ...(m.download || {}), proxy: proxyLink(req, m.url, fn, `&refresh=${vid}&qkind=mp4&q=${q}`), filename: fn };
        };
        const linkMp3 = (m: any): void => {
            if (!m.url) { m.download = { ...(m.download || {}), proxy: null }; return; }
            const b = String(m.audioBitrate || '128');
            const fn = sanitizeName(`youtube2_${tag}_${vid}_${b}kbps.mp3`);
            m.download = { ...(m.download || {}), proxy: proxyLink(req, m.url, fn, `&refresh=${vid}&qkind=mp3&q=${b}`), filename: fn };
        };
        (r.cdn.mp4 || []).forEach(linkMp4);
        (r.cdn.mp3 || []).forEach(linkMp3);

        res.json({ success: true, kind: 'youtube2', ...r });
    } catch (e) {
        const err = e as any;
        res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
}
