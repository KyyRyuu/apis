/*
 * MediaFire Downloader
 * type: Scraper + Proxy
 * source: halaman share MediaFire
 * author: wa.me/ikyykzy
 * note: ambil direct link fileMediaFire + metadata. link akhir dibungkus
 *       link proxy (field "download.proxy") supaya user tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const UA = 'Mozilla/5.0';
const PROXY_ORIGIN = 'https://www.mediafire.com/';

const MIME_TYPES: Record<string, string> = {
    '7z': 'application/x-7z-compressed', zip: 'application/zip', rar: 'application/x-rar-compressed',
    apk: 'application/vnd.android.package-archive', exe: 'application/x-msdownload', pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    mp3: 'audio/mpeg', mp4: 'video/mp4', txt: 'text/plain', json: 'application/json',
    js: 'application/javascript', html: 'text/html', css: 'text/css',
};

function mimeFromUrl(url: string): string {
    if (!url) return 'application/octet-stream';
    const fileName = url.split('/').pop()?.split('?')[0] || '';
    const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
    return MIME_TYPES[ext] || 'application/octet-stream';
}

function proxyConf(): Record<string, any> {
    const raw = process.env.MEDIAFIRE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
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
    return String(s || 'file').replace(/[^\w\-. ]+/g, '_').replace(/\s+/g, '_').slice(0, 90) || 'file';
}

function isAllowedMediaHost(mediaUrl: string): boolean {
    try {
        const host = new URL(mediaUrl).hostname.toLowerCase();
        return host === 'mediafire.com' || host.endsWith('.mediafire.com');
    } catch {
        return false;
    }
}

function proxyLink(req: Request, mediaUrl: string, filename: string): string {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
    const host = String(req.headers['x-forwarded-host'] || req.get('host'));
    return `${proto}://${host}/api/download/mediafire?dl=${b64urlEncode(mediaUrl)}&fn=${encodeURIComponent(filename)}`;
}

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'mediafire.bin');

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

    const headers: Record<string, string> = { 'User-Agent': UA, Referer: PROXY_ORIGIN };
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

export default async function mediafireHandler(req: Request, res: Response) {
    try {
        if (req.query.dl !== undefined && req.query.dl !== '') {
            await proxyMedia(req, res);
            return;
        }

        const input = String(req.query.url || (req.body && (req.body as any).url) || '').trim();
        if (!input) {
            return res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
        }

        const { data: html } = await axios.get(input, {
            timeout: 60000,
            maxRedirects: 10,
            headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
        });

        const $ = cheerio.load(html);
        const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || 'MediaFire File';
        const images = $('meta[property="og:image"]').attr('content') || '';
        const description = $('meta[property="og:description"]').attr('content') || 'not found description.';
        const link = $('#downloadButton').attr('href') || $('a[aria-label="Download file"]').attr('href') || '';
        const sizeMatch = $('#downloadButton').text().trim().match(/\(([^)]+)\)/);
        const size = sizeMatch?.[1]?.trim() || '';
        const mimetype = mimeFromUrl(link);

        if (!link) throw new Error('MediaFire download link not found');

        const ext = (link.split('/').pop()?.split('?')[0]?.split('.').pop() || 'bin').toLowerCase();
        const filename = sanitizeName(`${title}.${ext}`);

        res.json({
            success: true,
            kind: 'mediafire',
            meta: { title, images, description },
            size,
            mimetype,
            link,
            download: { proxy: proxyLink(req, link, filename), filename },
        });
    } catch (e) {
        res.status(500).json({ success: false, error: (e as any).message || 'Internal error' });
    }
}
