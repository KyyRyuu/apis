/*
 * Dailymotion Downloader
 * type: Scraper + Proxy
 * api: POST https://vidomon.com/wp-json/aio-dl/video-data/ { url }
 * author: wa.me/ikyykzy
 * note: ambil direct url video dailymotion (mp4) lewat AIO Downloader.
 *       link akhir dibungkus link proxy (field "download.proxy") supaya
 *       user tidak perlu set header sendiri -> tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { cdnLink } from '../../src/cdn';

const API_URL = 'https://vidomon.com/wp-json/aio-dl/video-data/';
const TOOL_URL = 'https://vidomon.com/dailymotion-video-downloader/';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36';

const api = axios.create({
    timeout: 30000,
    maxRedirects: 10,
    validateStatus: (s: number) => s < 600,
});

const cdn = axios.create({
    timeout: 30000,
    maxRedirects: 10,
    validateStatus: (s: number) => s < 500,
    headers: { 'User-Agent': UA, Referer: 'https://www.dailymotion.com/' },
});

function proxyConf(): Record<string, any> {
    const raw = process.env.DAILYMOTION_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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

function randomIp(): string {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 255)).join('.');
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
    return String(s || 'video').replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '_').slice(0, 90) || 'video';
}

// media dailymotion di-serve dari *.dmcdn.net
function isAllowedMediaHost(mediaUrl: string): boolean {
    try {
        const host = new URL(mediaUrl).hostname.toLowerCase();
        return host === 'dmcdn.net' || host.endsWith('.dmcdn.net');
    } catch {
        return false;
    }
}

function parseInput(input: string): string {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('URL kosong');
    let u: URL;
    try {
        u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        throw new Error(`URL tidak valid: ${raw}`);
    }
    const host = u.hostname.toLowerCase();
    if (!(host === 'dailymotion.com' || host.endsWith('.dailymotion.com') || host === 'dai.ly')) {
        throw new Error('Bukan URL Dailymotion yang valid');
    }
    return raw;
}

async function verifyDirectUrl(url: string | null): Promise<any> {
    const result: any = { url: url || null, ok: false, head_ok: false };
    if (!url) {
        result.error = 'URL tidak tersedia';
        return result;
    }
    try {
        const head = await cdn.head(url, { ...proxyConf() });
        result.status = head.status;
        result.content_type = head.headers['content-type'] || null;
        result.content_length = Number(head.headers['content-length'] || 0) || null;
        result.head_ok = head.status === 200 || head.status === 206;
        result.ok = result.head_ok;
    } catch (err) {
        result.error = (err as any).message;
    }
    return result;
}

function slimCheck(r: any): any {
    if (!r) return null;
    return {
        ok: Boolean(r.ok),
        status: r.status ?? null,
        content_type: r.content_type ?? null,
        content_length: r.content_length ?? null,
        error: r.error ?? null,
    };
}

async function dailymotiondl(inputUrl: string): Promise<any> {
    const target = parseInput(inputUrl);
    const startedAt = new Date().toISOString();
    const fakeIp = randomIp();

    const res = await api.post(
        API_URL,
        `url=${encodeURIComponent(target)}`,
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': UA,
                'Referer': `${TOOL_URL}#url=${target}`,
                'X-Forwarded-For': fakeIp,
                'X-Real-IP': fakeIp,
            },
            ...proxyConf(),
        }
    );

    const data = res.data || {};
    if (res.status >= 400) {
        throw new Error(data?.error || data?.message || `Gagal fetch vidomon (HTTP ${res.status})`);
    }
    if (!Array.isArray(data.medias) || data.medias.length === 0) {
        throw new Error(data?.error || data?.message || 'Tidak ada media yang tersedia');
    }

    const mp4 = data.medias.filter((m: any) => m.videoAvailable && m.extension === 'mp4');
    const best = (mp4.length ? mp4 : data.medias)
        .slice()
        .sort((a: any, b: any) => (parseInt(b.quality) || 0) - (parseInt(a.quality) || 0))[0];

    const medias = data.medias.map((m: any) => ({
        extension: m.extension ?? null,
        quality: m.quality ?? null,
        videoAvailable: Boolean(m.videoAvailable),
        audioAvailable: Boolean(m.audioAvailable),
        size: m.size ?? null,
        url: m.url ?? null,
    }));

    return {
        success: true,
        scraped_at: startedAt,
        source_url: target,
        title: data.title ?? null,
        thumbnail: data.thumbnail ?? null,
        duration: data.duration ?? null,
        source: data.source ?? 'dailymotion',
        quality: best?.quality ?? null,
        url: best?.url ?? null,
        medias,
        verification: slimCheck(await verifyDirectUrl(best?.url ?? null)),
    };
}

// ---------- proxy (header-free stream) ----------

function proxyLink(req: Request, mediaUrl: string, filename: string): string {
    return cdnLink(req, mediaUrl, filename, { 'User-Agent': UA, Referer: 'https://www.dailymotion.com/' });
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'video.mp4');

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
    const headers: Record<string, string> = { 'User-Agent': UA, Referer: 'https://www.dailymotion.com/' };
    if (range) headers.Range = String(range);

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

// ---------- handler ----------

export default async function dailymotionHandler(req: Request, res: Response) {
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

        const r = await dailymotiondl(input);
        const fn = sanitizeName(String(r.title || 'video'));

        r.medias = (r.medias || []).map((m: any) => {
            const name = `${fn}_${m.quality || 'src'}.${m.extension || 'mp4'}`;
            const link = m.url ? proxyLink(req, m.url, name) : null;
            return { ...m, url: link || m.url, download: link ? { proxy: link } : null };
        });
        if (r.url) {
            const name = `${fn}_${r.quality || 'video'}.mp4`;
            const link = proxyLink(req, r.url, name);
            r.url = link;
            r.download = { proxy: link, filename: name };
        }

        res.json({ kind: 'dailymotion', ...r });
    } catch (e) {
        const err = e as any;
        res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
}
