/*
 * Pinterest Downloader
 * type: Scraper + Proxy
 * api: GET https://ilovepin.net/id (cookie) -> POST https://ilovepin.net/proxy.php { url }
 * author: wa.me/ikyykzy
 * note: ambil video/gambar (semua resolusi) dari pin Pinterest.
 *       link media dibungkus link proxy (field "download.proxy").
 */
import { Request, Response } from 'express';
import axios from 'axios';

const HOME = 'https://ilovepin.net/id';
const API = 'https://ilovepin.net/proxy.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BASE_HEADERS = {
    'User-Agent': UA,
    Accept: '*/*',
    'Accept-Language': 'id,en;q=0.9,en-GB;q=0.8,en-US;q=0.7',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: 'https://ilovepin.net',
    Referer: 'https://ilovepin.net/id',
};

function proxyConf(): Record<string, any> {
    const raw = process.env.PINTEREST_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (!raw) return {};
    try {
        const u = new URL(raw);
        const conf: Record<string, any> = {
            proxy: { protocol: u.protocol.replace(':', ''), host: u.hostname, port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)) },
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
    return String(s || 'pin').replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'pin';
}

// media pinterest di-serve dari mcontent.app / pinimg.com
function isAllowedMediaHost(mediaUrl: string): boolean {
    try {
        const host = new URL(mediaUrl).hostname.toLowerCase();
        return host === 'mcontent.app' || host.endsWith('.mcontent.app')
            || host === 'pinimg.com' || host.endsWith('.pinimg.com');
    } catch {
        return false;
    }
}

function proxyLink(req: Request, mediaUrl: string, filename: string): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}/api/download/pinterest?dl=${b64urlEncode(mediaUrl)}&fn=${encodeURIComponent(filename)}`;
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'pin');

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

    const headers: Record<string, string> = { 'User-Agent': UA, Referer: 'https://www.pinterest.com/' };
    if (req.headers.range) headers.Range = String(req.headers.range);

    const upstream = await axios.get(mediaUrl, {
        responseType: 'stream',
        ...proxyConf(),
        timeout: 60000,
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

async function scrapePinterest(pinUrl: string) {
    const mainPage = await axios.get(HOME, { headers: { 'User-Agent': UA }, timeout: 30000, ...proxyConf() });
    const rawCookies = mainPage.headers['set-cookie'];
    const cookieString = rawCookies ? rawCookies.join('; ') : '';

    const { data } = await axios.post(API, new URLSearchParams({ url: pinUrl }).toString(), {
        headers: {
            ...BASE_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Cookie: cookieString,
        },
        timeout: 30000,
        ...proxyConf(),
    });

    if (!data || !data.api || data.api.status !== 'OK') {
        throw new Error('Gagal mengambil data atau URL tidak valid.');
    }

    const api = data.api;
    const items = api.mediaItems || [];
    const videos = items.filter((i: any) => i.type === 'Video');
    const images = items.filter((i: any) => i.type === 'Image');

    const media: any[] = [];
    if (videos.length > 0) {
        videos.sort((a: any, b: any) => {
            const sizeA = parseFloat(a.mediaFileSize) * (String(a.mediaFileSize).includes('MB') ? 1024 : 1);
            const sizeB = parseFloat(b.mediaFileSize) * (String(b.mediaFileSize).includes('MB') ? 1024 : 1);
            return sizeB - sizeA;
        });
        for (const v of videos) {
            media.push({ type: 'video', quality: v.mediaQuality === 'HD' ? 'HD' : `SD (${v.mediaRes})`, extension: v.mediaExtension, size: v.mediaFileSize, url: v.mediaUrl });
        }
    } else if (images.length > 0) {
        for (const img of images) {
            media.push({ type: 'image', quality: 'Original', extension: img.mediaExtension, size: img.mediaFileSize, url: img.mediaUrl });
        }
    }

    return {
        title: api.title,
        description: api.description?.trim() || '-',
        author: {
            name: api.userInfo?.name ?? null,
            username: api.userInfo?.username ?? null,
            avatar: api.userInfo?.userAvatar ?? null,
        },
        stats: {
            likes: api.mediaStats?.likesCount ?? null,
            shares: api.mediaStats?.sharesCount ?? null,
        },
        media,
    };
}

export default async function pinterestHandler(req: Request, res: Response) {
    try {
        if (req.query.dl !== undefined && req.query.dl !== '') {
            await proxyMedia(req, res);
            return;
        }

        const input = String(req.query.url || (req.body && (req.body as any).url) || '').trim();
        if (!input) {
            return res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
        }

        const r = await scrapePinterest(input);
        const fnBase = sanitizeName(r.title || 'pin');

        (r as any).media = r.media.map((m: any, i: number) => ({
            ...m,
            download: m.url
                ? { proxy: proxyLink(req, m.url, `${fnBase}_${i + 1}.${(m.extension || 'jpg').toLowerCase()}`) }
                : null,
        }));

        res.json({ success: true, kind: 'pinterest', ...r });
    } catch (e) {
        res.status(500).json({ success: false, error: (e as any).message || 'Internal error' });
    }
}
