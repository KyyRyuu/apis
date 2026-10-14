/*
 * Terabox Downloader
 * type: Scraper + Proxy
 * api: POST https://sechno.com/api/terabox { url }
 * author: wa.me/ikyykzy
 * note: ambil direct url/link akhir untuk downloader files terabox.
 *       link akhir sudah dibungkus link proxy (field "proxy") supaya
 *       user TIDAK perlu set header sendiri -> tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';

const API_URL = 'https://sechno.com/api/terabox';
const TOOL_URL = 'https://sechno.com/tools/terabox-downloader';
const UA_BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

const api = axios.create({
    timeout: 25000,
    maxRedirects: 10,
    validateStatus: (s: number) => s < 500,
    headers: {
        'User-Agent': UA_BROWSER,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json',
        'Origin': 'https://sechno.com',
        'Referer': TOOL_URL,
    },
});

const cdn = axios.create({
    timeout: 25000,
    maxRedirects: 10,
    validateStatus: (s: number) => s < 500,
    headers: { 'User-Agent': UA_BROWSER, Referer: TOOL_URL },
});

function proxyConf(): Record<string, any> {
    const raw = process.env.TERABOX_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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

// link akhir terabox berupa worker (*.workers.dev/dlink-fetch) atau cdn terabox
function isAllowedMediaHost(mediaUrl: string): boolean {
    try {
        const u = new URL(mediaUrl);
        const host = u.hostname.toLowerCase();
        if (host.endsWith('.workers.dev')) return u.pathname.startsWith('/dlink-fetch');
        const suffixes = ['terabox.com', 'teraboxcdn.com', 'teraboxapp.com', '1024terabox.com', 'mirrobox.com'];
        return suffixes.some((sfx) => host === sfx || host.endsWith('.' + sfx));
    } catch {
        return false;
    }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 1000): Promise<T> {
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

function parseInput(input: string): { input: string; host: string; surl: string | null } {
    const raw = String(input || '').trim();
    if (!raw) throw new Error('URL kosong');
    let u: URL;
    try {
        u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        throw new Error(`URL tidak valid: ${raw}`);
    }
    return { input: raw, host: u.hostname.toLowerCase(), surl: u.searchParams.get('surl') || null };
}

async function verifyDirectUrl(url: string | null): Promise<any> {
    const result: any = { url: url || null, ok: false, head_ok: false };
    if (!url) {
        result.error = 'URL tidak tersedia';
        return result;
    }
    try {
        const head = await cdn.head(url);
        result.status = head.status;
        result.content_type = head.headers['content-type'] || null;
        result.content_length = Number(head.headers['content-length'] || 0) || null;
        result.filename = /filename="?([^";]+)"?/i.exec(head.headers['content-disposition'] || '')?.[1] || null;
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

async function teraboxdl(inputUrl: string): Promise<any> {
    const target = parseInput(inputUrl);
    const startedAt = new Date().toISOString();

    const res = await withRetry(() => api.post(API_URL, { url: target.input }, { ...proxyConf() } as any));
    const data = res.data;

    if (res.status >= 400) {
        throw new Error(data?.error || data?.message || `Gagal fetch sechno (HTTP ${res.status})`);
    }
    if (!data || data.success !== true) {
        throw new Error(data?.error || data?.message || 'Gagal mengambil file (success != true)');
    }

    const files = Array.isArray(data.files) ? data.files.map((f: any) => ({
        filename: f.filename || null,
        size: f.size != null ? Number(f.size) : null,
        size_formatted: f.sizeFormatted || null,
        url: f.downloadUrl || null,
    })) : [];

    if (!files.length) {
        const err = new Error('File tidak ditemukan di share link ini (mungkin privat / terhapus / expired).') as any;
        err.detail = { title: data.title || null, short_id: data.shortId || null };
        throw err;
    }

    const directUrl = Array.isArray(data.files) ? (data.files.map((f: any) => f.downloadUrl).filter(Boolean)[0] || null) : null;

    const result: any = {
        success: true,
        scraped_at: startedAt,
        source_url: target.input,
        title: data.title || files[0]?.filename || null,
        url: directUrl,
        files,
    };

    // verifikasi HEAD ke link akhir (tanpa download full file)
    const check = await verifyDirectUrl(directUrl);
    result.verification = slimCheck(check);

    return result;
}

// ---------- proxy (header-free stream) ----------

function proxyLink(req: Request, mediaUrl: string, filename: string): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}/api/download/terabox?dl=${b64urlEncode(mediaUrl)}&fn=${encodeURIComponent(filename)}`;
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'terabox.bin');

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
        Referer: 'https://www.terabox.com/',
    };
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

export default async function teraboxHandler(req: Request, res: Response) {
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

        const r = await teraboxdl(input);
        r.files = (r.files || []).map((f: any) => {
            const fn = sanitizeName(f.filename || r.title || 'terabox');
            return { ...f, download: f.url ? { proxy: proxyLink(req, f.url, fn), filename: fn } : null };
        });
        if (r.url) {
            const fn = sanitizeName(r.title || r.files?.[0]?.filename || 'terabox');
            r.download = { proxy: proxyLink(req, r.url, fn), filename: fn };
        }

        res.json({ success: true, kind: 'terabox', ...r });
    } catch (e) {
        const err = e as any;
        res.status(500).json({ success: false, error: err.message || 'Internal error' });
    }
}
