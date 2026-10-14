/*
 * TikTok Downloader
 * type: Scraper + Proxy
 * base url: snaptik.monster
 * author: wa.me/ikyykzy
 * note: buat download video, image, slide, & story.
 *       SEMUA url media di-response sudah dibungkus link proxy (field "proxy") supaya
 *       user TIDAK perlu set header (User-Agent/Referer/Range) sendiri -> tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const PARSER_URL = 'https://snaptik.monster/';
const UA_BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const htmlHeaders = (): Record<string, string> => ({
    'User-Agent': UA_BROWSER,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': PARSER_URL.slice(0, -1),
    Referer: PARSER_URL,
});

const cdnHeaders = (): Record<string, string> => ({ 'User-Agent': UA_BROWSER, Referer: 'https://www.tiktok.com/' });

const page = axios.create({ headers: htmlHeaders(), maxRedirects: 10, timeout: 25000, validateStatus: (s: number) => s < 400 });
const cdn = axios.create({ headers: cdnHeaders(), maxRedirects: 10, timeout: 25000, validateStatus: (s: number) => s < 500 });

const CDN_SUFFIXES = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'tiktokv.com', 'tiktok.com', 'muscdn.com', 'musical.ly'];

function proxyConf(): Record<string, any> {
    const raw = process.env.TIKTOK_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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
        const u = new URL(mediaUrl);
        const host = u.hostname.toLowerCase();
        // file slideshow generate-an parser (path tetap) boleh ikut di-proxy
        if (host === 'snaptik.monster') return u.pathname.startsWith('/download/slideshow/file/');
        return CDN_SUFFIXES.some((sfx) => host === sfx || host.endsWith('.' + sfx));
    } catch {
        return false;
    }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = 4, baseDelay = 1200): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const status = (err as any).response?.status || (err as any).status;
            const retryable = status === undefined || status === 429 || status >= 500;
            if (!retryable || i === retries - 1) throw err;
            await sleep(baseDelay * (i + 1));
        }
    }
    throw lastErr;
}

function directUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        const enc = new URL(url).searchParams.get('u');
        if (!enc) return url;
        const decoded = Buffer.from(enc, 'base64').toString('utf8');
        return /^https?:\/\//i.test(decoded) ? decoded : url;
    } catch {
        return url;
    }
}

function describe(loc: string, input: string): any {
    const query = loc.includes('?') ? loc.slice(loc.indexOf('?')) : '';
    const pathId = /(?:\/video|\/photo|\/note)\/(\d+)/.exec(loc);
    const itemId = /[?&]item_id=(\d+)/.exec(query);

    return {
        input,
        finalUrl: loc,
        cleanUrl: loc.split('?')[0],
        id: pathId ? pathId[1] : (itemId ? itemId[1] : null),
        author: /tiktok\.com\/@([^/?]+)/.exec(loc)?.[1] || null,
        storyUid: /[?&]story_uid=(\d+)/.exec(query)?.[1] || null,
        isStory: /\/story\/|[?&]story_type=1|[?&]aweme_type=40/i.test(loc),
        isPhoto: /\/photo\/|[?&]aweme_type=68/.test(loc),
    };
}

async function resolveUrl(input: string): Promise<any> {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('URL kosong');

    try {
        const r = await axios.get(raw, {
            maxRedirects: 0,
            validateStatus: (s: number) => s < 400,
            headers: { 'User-Agent': UA_BROWSER },
            ...proxyConf(),
        });
        return describe((r.headers.location as string) || (r.request as any)?.res?.responseUrl || raw, raw);
    } catch {
        return describe(raw, raw);
    }
}

async function getCsrf(): Promise<string> {
    const res = await page.get(PARSER_URL, { ...proxyConf() } as any);
    const csrf = String(cheerio.load(res.data)('input[name="_csrf"]').val() || '');
    if (!csrf) throw new Error('CSRF token not found');
    return csrf;
}

async function submitUrl(ttUrl: string, csrf: string): Promise<cheerio.CheerioAPI> {
    const body = new URLSearchParams({ url: ttUrl, _csrf: csrf });
    const res = await page.post(PARSER_URL, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        ...proxyConf(),
    } as any);
    return cheerio.load(res.data);
}

function parseResult($: cheerio.CheerioAPI): any {
    const images: string[] = [];
    const videos: string[] = [];

    $('a[data-media-download]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const label = $(el).text().trim().replace(/\s+/g, ' ');
        const url = directUrl(href);
        if (!url) return;
        const isImage = /\b(image|photo|slide|thumbnail)\b/i.test(label)
            || /\.(jpe?g|png|webp)(\?|$)/i.test(url)
            || /photomode/i.test(url);

        if (isImage) {
            if (!images.includes(url)) images.push(url);
        } else if (!videos.includes(url)) {
            videos.push(url);
        }
    });

    const description = $('p.res-desc').text().trim();

    return {
        nickname: $('h2.res-author').text().trim(),
        description,
        hashtags: [...new Set((description.match(/#([\p{L}\p{N}_]{1,80})/gu) || []).map((m) => m.slice(1)))],
        downloadName: $('div.res-actions').attr('data-download-name') || '',
        video: videos[0] || null,
        videos,
        audio: directUrl($('a[data-audio-download]').attr('href')),
        thumbnail: directUrl($('img.res-cover').attr('src')),
        images,
    };
}

function detectType(target: any, parsed: any): string {
    if (parsed.images.length > 1 || parsed.videos.length > 1) return 'slide';
    if (parsed.images.length === 1 || target.isPhoto) return 'image';
    if (parsed.video) return target.isStory ? 'story' : 'video';
    if (parsed.audio) return 'audio';
    return 'unknown';
}

function abs(path: string | null | undefined): string | null {
    if (!path) return null;
    return path.startsWith('http') ? path : PARSER_URL.replace(/\/$/, '') + path;
}

async function fetchSlideshow($: cheerio.CheerioAPI): Promise<any> {
    const ss = $('[data-server-slideshow]');
    if (!ss.length) return null;

    const ticket = ss.attr('data-ticket') || '';
    const startEndpoint = ss.attr('data-start-endpoint') || '/download/slideshow/start/';
    const statusEndpoint = ss.attr('data-status-endpoint') || '/download/slideshow/status/';

    let payload: any = await withRetry(async () => {
        const res = await page.post(abs(startEndpoint) as string, new URLSearchParams({ token: ticket }).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        });
        return res.data;
    });

    let attempts = 0;
    while (payload.state !== 'ready' && payload.state !== 'failed' && attempts < 30) {
        await sleep(1200);
        payload = await withRetry(async () => {
            const res = await page.get(`${abs(statusEndpoint)}?token=${encodeURIComponent(ticket)}`, {
                headers: { Accept: 'application/json' },
            });
            return res.data;
        }, 10, 500);
        attempts++;
    }

    const urls: Record<string, string> = {};
    for (const [type, url] of Object.entries(payload.urls || {})) {
        const a = abs(String(url));
        if (a) urls[type] = a;
    }

    return {
        state: payload.state,
        error: payload.error || '',
        video: urls.video || null,
        photos: urls.photos || null,
        bundle: urls.bundle || null,
    };
}

function detectContainer(buf: any): { is_container: boolean; format: string | null; brand: string | null } {
    if (!buf || buf.length < 12) return { is_container: false, format: null, brand: null };

    const box = buf.slice(4, 8).toString('latin1');
    if (box === 'ftyp') {
        const brand = buf.slice(8, 12).toString('latin1').replace(/\0/g, '').trim();
        return { is_container: true, format: 'ISO-BMFF (mp4 / m4a / mov)', brand: brand || null };
    }
    if (buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
        return { is_container: true, format: 'MPEG audio (mp3)', brand: null };
    }
    if (buf[0] === 0x89 && buf.slice(1, 4).toString('latin1') === 'PNG') {
        return { is_container: true, format: 'PNG image', brand: null };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
        return { is_container: true, format: 'JPEG image', brand: null };
    }
    if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') {
        return { is_container: true, format: 'WebP image', brand: null };
    }
    return { is_container: false, format: null, brand: box };
}

async function verifyMediaUrl(url: string | null): Promise<any> {
    const result: any = { url: url || null, ok: false, head_ok: false, download_ok: false };

    if (!url) {
        result.error = 'URL tidak tersedia';
        return result;
    }

    try {
        const head = await cdn.head(url);
        result.status = head.status;
        result.content_type = head.headers['content-type'] || null;
        if (/^(video|audio|image)\//i.test(result.content_type || '')) {
            result.content_length = Number(head.headers['content-length'] || 0) || null;
        }
        result.head_ok = head.status === 200 || head.status === 206;
    } catch (err) {
        result.error = (err as any).message;
    }

    try {
        const res = await cdn.get(url, {
            headers: { Range: 'bytes=0-2047' },
            responseType: 'arraybuffer',
        });
        const buf = Buffer.from(res.data || []);
        result.range_status = res.status;
        result.bytes_sampled = buf.length;
        result.container = detectContainer(buf);
        if (result.container.is_container && !/^(video|audio|image)\//i.test(result.content_type || '')) {
            result.content_type = result.container.format;
        }
        result.download_ok = (res.status === 200 || res.status === 206) && buf.length > 0;
    } catch (err) {
        result.error = result.error || (err as any).message;
    }

    result.ok = Boolean((result.head_ok || result.download_ok) && result.container?.is_container);
    return result;
}

function slimCheck(result: any): any {
    if (!result) return null;
    return {
        ok: Boolean(result.ok),
        status: result.status ?? null,
        content_type: result.content_type ?? null,
        content_length: result.content_length ?? null,
        error: result.error ?? null,
    };
}

async function tiktokdl(inputUrl: string): Promise<any> {
    const target = await resolveUrl(inputUrl);
    const startedAt = new Date().toISOString();

    const csrf = await getCsrf();
    const $ = await submitUrl(target.input, csrf);

    const parsed = parseResult($);
    const type = detectType(target, parsed);

    if (!parsed.video && !parsed.images.length && !parsed.audio) {
        const err = new Error('Data media tidak ditemukan. Post mungkin privat, terhapus, atau TikTok membatasi akses tanpa login.') as any;
        err.detail = {
            final_url: target.cleanUrl,
            type,
        };
        throw err;
    }

    const videos = parsed.videos;
    const images = parsed.images;
    const video = videos[0] || null;
    const audio = parsed.audio || null;
    const thumbnail = images.length ? null : parsed.thumbnail;

    let slideshow = null;
    if (type === 'slide') {
        try {
            slideshow = await fetchSlideshow($);
        } catch (err) {
            slideshow = { state: 'failed', error: (err as any).message, video: null, photos: null, bundle: null };
        }
    }

    const result: any = {
        success: true,
        scraped_at: startedAt,
        source_url: target.input,
        id: target.id,
        type,
        final_url: target.cleanUrl,
        url: {
            video,
            audio,
            thumbnail,
            images,
            ...(videos.length > 1 ? { videos } : {}),
        },
        caption: {
            text: parsed.description,
            hashtags: parsed.hashtags,
            mentions: [],
        },
        author: {
            nickname: parsed.nickname || target.author || null,
            url: target.author ? `https://www.tiktok.com/@${target.author}` : null,
        },
        media: {
            item_count: images.length || (video ? 1 : 0),
            is_slideshow: type === 'slide',
            is_story: type === 'story',
            story_uid: target.storyUid,
        },
        slideshow,
    };

    const videoCheck = video ? await verifyMediaUrl(video) : null;
    const audioCheck = audio ? await verifyMediaUrl(audio) : null;
    const imageUrls = [...images, thumbnail].filter(Boolean);
    const imageCheck = imageUrls.length ? await verifyMediaUrl(imageUrls[0]) : null;

    result.verification = {
        video: slimCheck(videoCheck),
        audio: slimCheck(audioCheck),
        image: slimCheck(imageCheck),
        images_checked: imageUrls.length,
        all_cdn_ok: Boolean(
            (videoCheck ? videoCheck.ok : true)
            && (audioCheck ? audioCheck.ok : true)
            && (imageCheck ? imageCheck.ok : true)
        ),
    };

    return result;
}

// ---------- proxy (header-free stream) ----------

function proxyLink(req: Request, mediaUrl: string, filename: string): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}/api/download/tiktok?dl=${b64urlEncode(mediaUrl)}&fn=${encodeURIComponent(filename)}`;
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'tiktok.bin');

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
        'User-Agent': UA_BROWSER,
        Referer: 'https://www.tiktok.com/',
    };
    if (range) headers.Range = String(range);

    const upstream = await axios.get(mediaUrl, {
        responseType: 'stream',
        ...proxyConf(),
        timeout: 30000,
        decompress: false,
        validateStatus: (s: number) => s < 400,
        maxRedirects: 10,
        headers,
    });

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

export default async function tiktokHandler(req: Request, res: Response) {
    try {
        if (req.query.dl !== undefined && req.query.dl !== '') {
            await proxyMedia(req, res);
            return;
        }

        const input = String(req.query.url || (req.body && (req.body as any).url) || '');
        if (!input) {
            res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
            return;
        }

        const r = await tiktokdl(input);
        const tag = sanitizeName(r.author?.nickname || r.id || 'tiktok');
        const extOf = (u: string | null, fallback: string): string => {
            const m = /\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(String(u || ''));
            return m ? '.' + m[1].toLowerCase() : fallback;
        };
        const wrap = (u: string | null, fn: string): any =>
            u ? { url: u, proxy: proxyLink(req, u, fn), filename: fn } : null;

        r.download = {
            video: wrap(r.url.video, sanitizeName(`tiktok_${tag}_${r.id || 'video'}.mp4`)),
            audio: wrap(r.url.audio, sanitizeName(`tiktok_${tag}_${r.id || 'audio'}.mp3`)),
            thumbnail: wrap(r.url.thumbnail, sanitizeName(`tiktok_${tag}_${r.id || 'thumb'}.jpg`)),
            images: (r.url.images || []).map((u: string, i: number) =>
                wrap(u, sanitizeName(`tiktok_${tag}_${r.id || 'img'}_${i + 1}${extOf(u, '.jpg')}`))),
            slideshow: r.slideshow ? {
                state: r.slideshow.state,
                video: wrap(r.slideshow.video, sanitizeName(`tiktok_${tag}_slideshow.mp4`)),
                photos: wrap(r.slideshow.photos, sanitizeName(`tiktok_${tag}_slideshow_photos.zip`)),
                bundle: wrap(r.slideshow.bundle, sanitizeName(`tiktok_${tag}_slideshow.zip`)),
            } : null,
        };

        res.json({ success: true, kind: 'tiktok', ...r });
    } catch (e) {
        const err = e as any;
        res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
}
