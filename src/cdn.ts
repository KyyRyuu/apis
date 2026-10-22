/*
 * CDN cache sederhana untuk hasil downloader.
 * - Link yang dibagikan ke client: /cdn/<id>-<filename>
 * - File diunduh on-demand ke disk (bukan RAM), lalu disajikan dgn Range.
 * - TTL 30 menit (env CDN_TTL_MS), sweeper otomatis menghapus file + entri.
 * - Batas ukuran per file & total (env CDN_MAX_FILE_BYTES / CDN_MAX_BYTES).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import axios from 'axios';
import { Request, Response } from 'express';

const TTL_MS = Math.max(60_000, Number(process.env.CDN_TTL_MS) || 30 * 60_000);
const MAX_FILE_BYTES = Math.max(1_000_000, Number(process.env.CDN_MAX_FILE_BYTES) || 400 * 1024 * 1024);
const MAX_TOTAL_BYTES = Math.max(MAX_FILE_BYTES, Number(process.env.CDN_MAX_BYTES) || 800 * 1024 * 1024);
const DOWNLOAD_TIMEOUT_MS = Math.max(30_000, Number(process.env.CDN_DOWNLOAD_TIMEOUT_MS) || 5 * 60_000);
const CDN_DIR = process.env.CDN_DIR || path.join(os.tmpdir(), 'kapis-cdn');

const PROXY_URL = process.env.CDN_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

type CdnEntry = {
    id: string;
    url: string;
    filename: string;
    headers: Record<string, string>;
    createdAt: number;
    expiresAt: number;
    ready: boolean;
    diskPath: string;
    size: number;
    contentType: string | null;
    promise: Promise<void> | null;
};

const registry = new Map<string, CdnEntry>();

function proxyConf(): any {
    if (!PROXY_URL) return {};
    try {
        const u = new URL(PROXY_URL);
        const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
        return {
            proxy: {
                protocol: u.protocol.replace(':', ''),
                host: u.hostname,
                port,
                ...(u.username ? { auth: { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } } : {}),
            },
        };
    } catch {
        return {};
    }
}

function ensureDir(): void {
    fs.mkdirSync(CDN_DIR, { recursive: true });
}

ensureDir();
try {
    for (const f of fs.readdirSync(CDN_DIR)) {
        fs.rmSync(path.join(CDN_DIR, f), { recursive: true, force: true });
    }
} catch { /* abaikan */ }

function safeName(name: string): string {
    const raw = String(name || 'file');
    const extMatch = /^\.[A-Za-z0-9]{1,6}$/.exec(path.extname(raw));
    const ext = extMatch ? extMatch[0] : '';
    let base = raw.slice(0, raw.length - ext.length)
        .replace(/[^\w.\-]+/g, '_')
        .replace(/_{2,}/g, '_')
        .slice(0, 70)
        .replace(/^[._]+/, '');
    if (!base) base = 'file';
    return `${base}${ext}`;
}

function originOf(req: Request): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}`;
}

function mimeFromName(name: string): string {
    const ext = path.extname(name).toLowerCase();
    const map: Record<string, string> = {
        '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
        '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.ogg': 'audio/ogg',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
        '.zip': 'application/zip', '.pdf': 'application/pdf', '.bin': 'application/octet-stream',
    };
    return map[ext] || 'application/octet-stream';
}

function totalBytes(): number {
    let total = 0;
    for (const e of registry.values()) total += e.size;
    return total;
}

function evict(entry: CdnEntry): void {
    try {
        fs.rmSync(entry.diskPath, { force: true });
    } catch { /* abaikan */ }
    registry.delete(entry.id);
}

function enforceCap(): void {
    if (totalBytes() <= MAX_TOTAL_BYTES) return;
    const oldest = [...registry.values()]
        .filter((e) => e.ready)
        .sort((a, b) => a.createdAt - b.createdAt);
    for (const e of oldest) {
        if (totalBytes() <= MAX_TOTAL_BYTES) break;
        evict(e);
    }
}

async function fetchToDisk(entry: CdnEntry): Promise<void> {
    const tmp = `${entry.diskPath}.part`;
    const upstream = await axios.get(entry.url, {
        responseType: 'stream',
        ...proxyConf(),
        timeout: 60000,
        decompress: false,
        validateStatus: (s) => s >= 200 && s < 400,
        maxRedirects: 10,
        headers: { ...entry.headers },
    });

    const declared = Number(upstream.headers['content-length'] || 0);
    if (declared && declared > MAX_FILE_BYTES) {
        try { upstream.data.destroy(); } catch { /* abaikan */ }
        throw new Error('File terlalu besar untuk CDN');
    }

    entry.contentType = String(upstream.headers['content-type'] || '').split(';')[0].trim() || null;

    await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(tmp);
        let written = 0;
        let settled = false;

        const fail = (err: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            try { upstream.data.destroy(); } catch { /* abaikan */ }
            try { ws.destroy(); } catch { /* abaikan */ }
            try { fs.rmSync(tmp, { force: true }); } catch { /* abaikan */ }
            reject(err instanceof Error ? err : new Error(String(err)));
        };

        const deadline = setTimeout(() => fail(new Error('Timeout mengunduh media')), DOWNLOAD_TIMEOUT_MS);
        deadline.unref?.();

        upstream.data.on('data', (chunk: Buffer) => {
            written += chunk.length;
            if (written > MAX_FILE_BYTES) fail(new Error('File terlalu besar untuk CDN'));
        });
        upstream.data.on('error', fail);
        ws.on('error', fail);
        ws.on('finish', () => {
            if (settled) return;
            settled = true;
            clearTimeout(deadline);
            entry.size = written;
            resolve();
        });

        upstream.data.pipe(ws);
    });

    fs.renameSync(tmp, entry.diskPath);
}

function ensureDownload(entry: CdnEntry): Promise<void> {
    if (entry.ready) return Promise.resolve();
    if (!entry.promise) {
        entry.promise = fetchToDisk(entry)
            .then(() => {
                entry.ready = true;
                enforceCap();
            })
            .catch((err) => {
                entry.promise = null;
                throw err;
            });
    }
    return entry.promise;
}

export function cdnLinkAt(origin: string, mediaUrl: string, filename: string, headers: Record<string, string> = {}): string {
    if (!/^https?:\/\//i.test(mediaUrl)) return mediaUrl;

    const id = crypto.randomBytes(6).toString('hex');
    const now = Date.now();
    const safe = safeName(filename);
    const entry: CdnEntry = {
        id,
        url: mediaUrl,
        filename: safe,
        headers,
        createdAt: now,
        expiresAt: now + TTL_MS,
        ready: false,
        diskPath: path.join(CDN_DIR, `${id}-${safe}`),
        size: 0,
        contentType: null,
        promise: null,
    };

    registry.set(id, entry);
    return `${origin}/cdn/${id}-${encodeURIComponent(safe)}`;
}

export function cdnLink(req: Request, mediaUrl: string, filename: string, headers: Record<string, string> = {}): string {
    return cdnLinkAt(originOf(req), mediaUrl, filename, headers);
}

export async function cdnHandler(req: Request, res: Response): Promise<void> {
    const file = String(req.params.file || '');
    const m = /^([a-f0-9]{12})-(.+)$/.exec(file);
    if (!m) {
        res.status(404).json({ status: false, message: 'CDN link tidak valid' });
        return;
    }

    const entry = registry.get(m[1]);
    if (!entry || Date.now() > entry.expiresAt) {
        if (entry) evict(entry);
        res.status(404).json({ status: false, message: 'CDN link tidak ditemukan atau sudah kedaluwarsa' });
        return;
    }

    try {
        await ensureDownload(entry);
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal mengunduh media';
        res.status(502).json({ status: false, message: msg });
        return;
    }

    if (!fs.existsSync(entry.diskPath)) {
        evict(entry);
        res.status(404).json({ status: false, message: 'File CDN sudah dihapus' });
        return;
    }

    res.sendFile(entry.diskPath, {
        acceptRanges: true,
        headers: {
            'Content-Type': entry.contentType || mimeFromName(entry.filename),
            'Content-Disposition': `inline; filename="${entry.filename.replace(/["\\]/g, '')}"`,
            'Cache-Control': 'public, max-age=1500',
        },
    }, (err) => {
        if (err && !res.headersSent) {
            res.status(500).json({ status: false, message: 'Gagal mengirim file' });
        }
    });
}

const sweeper = setInterval(() => {
    const now = Date.now();
    for (const e of [...registry.values()]) {
        if (now > e.expiresAt) evict(e);
    }
}, 60_000);
sweeper.unref?.();
