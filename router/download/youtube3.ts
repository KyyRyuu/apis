/*
 * YouTube Downloader 3 (ytultra base)
 * type: Scraper + Proxy
 * base: https://www.ytultra.com/en/youtube-video-downloader/
 * api : https://api.ytultra.com/ikool/youtube (/download, /engagement, /descriptionExtractor, /tags, /profile)
 * author: wa.me/ikyykzy
 * note: CDN + statistik full bawaan ytultra saja (tanpa InnerTube/oEmbed).
 *       CDN di-mint server ytultra -> tetap jalan saat IP kita kena bot-check YouTube.
 *       SEMUA url CDN di-response dibungkus link proxy (field "download.proxy").
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { cdnLink } from '../../src/cdn';

const BASE = 'https://www.ytultra.com/en/youtube-video-downloader/';
const API = 'https://api.ytultra.com/ikool/youtube';

const UA_BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const UA_ANDROID = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';

const CDN_SUFFIXES = ['googlevideo.com'];

function proxyConf(): Record<string, any> {
    const raw = process.env.YOUTUBE3_PROXY || process.env.YOUTUBE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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
        const isMedia = out.container !== 'unknown' || /^(video|audio)\//i.test(out.content_type || '');
        out.ok = (res.status === 200 || res.status === 206) && buf.length > 0 && isMedia;
        if (!out.ok && !out.error) out.error = !isMedia ? 'isi bukan file media' : `http ${res.status}`;
    } catch (err) { out.error = (err as any).message; }
    return out;
}

const ytultraHeaders = (): Record<string, string> => ({
    'User-Agent': UA_BROWSER,
    'Content-Type': 'application/json',
    Origin: 'https://www.ytultra.com',
    Referer: BASE,
});

async function ytultraPost(path: string, body: any): Promise<any> {
    const res = await withRetry(() => axios.post(`${API}${path}`, body, {
        headers: ytultraHeaders(), timeout: 30000, ...proxyConf(),
    }));
    const d = res.data || {};
    if (d.code !== '0000') throw new Error(`ytultra ${path} gagal: ${d.msg || d.message || d.code || 'unknown'}`);
    return d.data;
}

function parseMedia(m: any): any {
    const format = m.format || '';
    const ext = ((format.match(/\[\.(\w+)\]/i) || [])[1] || '').toLowerCase() || null;
    const quality = (format.match(/^(\d{3,4}p)/i) || [])[1] || null;
    const isAudioExt = ['m4a', 'weba', 'mp3', 'aac', 'opus', 'ogg', 'flac'].includes(ext || '');
    const isVideo = !isAudioExt && /^\d{3,4}p/i.test(format);
    const itag = (/[?&]itag=(\d+)/.exec(m.url || '') || [])[1] || null;
    return {
        quality: isVideo ? quality : null,
        format: format || null,
        extension: ext,
        size: typeof m.fileSize === 'number' ? m.fileSize : null,
        itag: itag ? Number(itag) : null,
        url: m.url || null,
        isVideo,
    };
}

async function youtube3DL(inputUrl: string, opts: any = {}): Promise<any> {
    const startedAt = new Date().toISOString();
    const videoId = extractVideoId(inputUrl);
    if (!videoId) throw new Error('Invalid YouTube URL. (support: watch, shorts, live, embed, music, youtu.be)');
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const fromMusic = isMusicSourceUrl(inputUrl);
    const verify = opts.verify !== false;

    const [dlRes, engRes, descRes, profRes, tagsRes] = await Promise.allSettled([
        ytultraPost('/download', { url: watchUrl }),
        ytultraPost('/engagement', { url: watchUrl }),
        ytultraPost('/descriptionExtractor', { url: watchUrl }),
        ytultraPost('/profile', { url: watchUrl }),
        ytultraPost('/tags', { url: watchUrl }),
    ]);

    if (dlRes.status !== 'fulfilled') throw new Error(`ytultra /download gagal: ${(dlRes.reason as any)?.message || dlRes.reason}`);
    const dl = dlRes.value || {};
    const medias = Array.isArray(dl.medias) ? dl.medias : [];
    if (!medias.length) throw new Error('ytultra tidak mengembalikan CDN apapun.');

    const eng = engRes.status === 'fulfilled' ? engRes.value : null;
    const desc = descRes.status === 'fulfilled' ? descRes.value : null;
    const prof = profRes.status === 'fulfilled' ? profRes.value : null;
    let tagsList: string[] = [];
    if (tagsRes.status === 'fulfilled') {
        const arr = Array.isArray(tagsRes.value) ? tagsRes.value : [];
        for (const item of arr) {
            if (Array.isArray(item?.tags) && item.tags.length && item.title !== 'No Tags Found') tagsList.push(...item.tags);
        }
        if (!tagsList.length && Array.isArray(desc?.tags) && desc.tags.length) tagsList = desc.tags;
    }

    const parsed = medias.map(parseMedia).filter((x: any) => x.url);
    const videos = parsed.filter((x: any) => x.isVideo);
    const audios = parsed.filter((x: any) => !x.isVideo);

    const title = dl.title || eng?.title || desc?.title || null;
    const durationSec = (dl.duration !== null && dl.duration !== undefined) ? Number(dl.duration) : null;
    const description = (typeof desc?.description === 'string') ? desc.description : '';
    const captionText = cleanCaption(description) || cleanCaption(title || '');
    const autoTags = extractTags(`${title || ''}\n${description}`);
    const publishedAt = eng?.publishedAt || desc?.publishedAt || null;
    const type = /\/shorts\//i.test(inputUrl) ? 'short' : fromMusic ? 'music' : 'video';

    const pick = (o: any): any => { const r: any = {}; for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') r[k] = v; return r; };

    const stats = pick({
        view: eng?.views !== undefined && eng?.views !== null ? Number(eng.views) : null,
        view_formatted: eng?.views ? formatNumber(eng.views) : null,
        like: eng?.likes !== undefined && eng?.likes !== null ? Number(eng.likes) : null,
        like_formatted: eng?.likes ? formatNumber(eng.likes) : null,
        comment: eng?.comments !== undefined && eng?.comments !== null ? Number(eng.comments) : null,
        comment_formatted: eng?.comments !== null && eng?.comments !== undefined ? formatNumber(eng.comments) : null,
        engagement_rate: eng?.engagementRate !== undefined && eng?.engagementRate !== null ? String(eng.engagementRate) : null,
    });

    const caption: any = pick({ text: captionText || null, source: cleanCaption(description) ? 'description' : 'title' });
    const hashtags = [...new Set([...(tagsList || []), ...autoTags.hashtags])];
    if (hashtags.length) caption.hashtags = hashtags;
    if (autoTags.mentions.length) caption.mentions = autoTags.mentions;

    const author = pick({
        name: eng?.channelTitle || prof?.channelName || null,
        avatar: prof?.profileUrl || null,
        banner: prof?.logoUrl || null,
    });

    let verification: any = { checked: 0, playable: 0, all_ok: false, details: [] };
    if (verify) {
        const all = [...videos.map((x: any) => ({ kind: 'video', label: x.quality || x.extension || `itag${x.itag}`, itag: x.itag, url: x.url })),
        ...audios.map((x: any) => ({ kind: 'audio', label: x.format || x.extension || `itag${x.itag}`, itag: x.itag, url: x.url }))];
        const details: any[] = [];
        for (const item of all) {
            const c = await checkCdnUrl(item.url);
            details.push({ kind: item.kind, label: item.label, itag: item.itag, url: item.url, ...c });
        }
        const ok = details.filter((d) => d.ok).length;
        verification = { checked: details.length, playable: ok, all_ok: details.length > 0 && ok === details.length, details };
        for (const m of videos) { const f = details.find((d) => d.itag === m.itag); if (f) m.download = { ok: f.ok, status: f.status, content_type: f.content_type, bytes: f.bytes, container: f.container, error: f.error }; }
        for (const m of audios) { const f = details.find((d) => d.itag === m.itag); if (f) m.download = { ok: f.ok, status: f.status, content_type: f.content_type, bytes: f.bytes, container: f.container, error: f.error }; }
    }

    return {
        success: true,
        scraped_at: startedAt,
        base: BASE,
        api: API,
        source_url: inputUrl,
        source_domain: (() => { try { return new URL(inputUrl.startsWith('http') ? inputUrl : `https://${inputUrl}`).hostname; } catch { return null; } })(),
        is_music_source: fromMusic,
        video_id: videoId,
        type,
        title,
        duration_seconds: durationSec,
        duration: durationSec !== null ? parseDuration(durationSec) : null,
        published_at: publishedAt,
        links: {
            watch: watchUrl,
            shorts: `https://www.youtube.com/shorts/${videoId}`,
            embed: `https://www.youtube.com/embed/${videoId}`,
            music: `https://music.youtube.com/watch?v=${videoId}`,
        },
        thumbnail: dl.imageUrl || null,
        cdn: {
            video: videos.map((v: any) => pick({ quality: v.quality, extension: v.extension, itag: v.itag, size: v.size, format: v.format, url: v.url })),
            audio: audios.map((a: any) => pick({ format: a.format, extension: a.extension, itag: a.itag, size: a.size, url: a.url })),
        },
        caption,
        author,
        stats,
        verification,
    };
}

// ---------- proxy (header-free stream + refresh) ----------

function proxyLink(req: Request, mediaUrl: string, filename: string, extra: string): string {
    void extra;
    return cdnLink(req, mediaUrl, filename, { 'User-Agent': UA_BROWSER, Referer: 'https://www.youtube.com/' });
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

async function refreshCdnUrl(videoId: string, itag: number): Promise<string | null> {
    try {
        const dl = await ytultraPost('/download', { url: `https://www.youtube.com/watch?v=${videoId}` });
        const medias = Array.isArray(dl?.medias) ? dl.medias : [];
        for (const m of medias) {
            const it = Number((/[?&]itag=(\d+)/.exec(m.url || '') || [])[1] || 0);
            if (it === itag && m.url) return m.url;
        }
        return null;
    } catch {
        return null;
    }
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'youtube3.bin');
    const refresh = req.query.refresh ? String(req.query.refresh) : null;
    const ritag = req.query.ritag ? Number(req.query.ritag) : null;

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
    const headers: Record<string, string> = { 'User-Agent': UA_ANDROID, Referer: 'https://www.youtube.com/' };
    if (range) headers.Range = String(range);

    let upstream: any = null;
    let lastErr: any = null;
    try {
        upstream = await fetchUpstream(mediaUrl, headers);
    } catch (err: any) {
        lastErr = err;
    }

    if (!upstream && refresh && ritag) {
        const fresh = await refreshCdnUrl(refresh, ritag);
        if (fresh && isAllowedMediaHost(fresh)) {
            try { upstream = await fetchUpstream(fresh, headers); }
            catch (err: any) { lastErr = err; }
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

export default async function youtube3Handler(req: Request, res: Response) {
    try {
        if (req.query.dl !== undefined && req.query.dl !== '') {
            await proxyMedia(req, res);
            return;
        }

        const input = String(req.query.url || (req.body && (req.body as any).url) || '');
        if (!input) {
            res.status(400).json({ success: false, error: 'Parameter url wajib diisi (watch/shorts/live/embed/music/youtu.be)' });
            return;
        }

        const r = await youtube3DL(input);
        const vid = String(r.video_id || 'video');
        const tag = sanitizeName((r.title || vid).slice(0, 40));

        const linkItem = (m: any): void => {
            if (!m.url) { m.download = { ...(m.download || {}), proxy: null }; return; }
            const label = m.quality ? `${m.quality}p` : (m.extension || 'audio');
            const ext = m.extension || (m.quality ? 'mp4' : 'm4a');
            const fn = sanitizeName(`youtube3_${tag}_${vid}_${label}.${ext}`);
            const extra = `&refresh=${vid}&ritag=${m.itag || 0}`;
            const link = proxyLink(req, m.url, fn, extra);
            m.url = link;
            m.download = { ...(m.download || {}), proxy: link, filename: fn };
        };
        (r.cdn.video || []).forEach(linkItem);
        (r.cdn.audio || []).forEach(linkItem);

        const itagMap = new Map<number, string>();
        [...(r.cdn.video || []), ...(r.cdn.audio || [])].forEach((m: any) => {
            if (m.url && m.itag) itagMap.set(Number(m.itag), m.url);
        });
        for (const d of r.verification?.details || []) {
            d.url = itagMap.get(Number(d.itag)) || null;
        }

        res.json({ success: true, kind: 'youtube3', ...r });
    } catch (e) {
        const err = e as any;
        res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
}
