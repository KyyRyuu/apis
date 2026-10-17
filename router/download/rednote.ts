/*
 * RedNote (Xiaohongshu) Downloader
 * type: Scraper
 * api: POST https://rednote.savevideodown.com/api/download { url }
 * author: wa.me/ikyykzy
 * note: ambil video/gambar dari link Xiaohongshu (RedNote).
 */
import { Request, Response } from 'express';
import axios from 'axios';

const API_URL = 'https://rednote.savevideodown.com/api/download';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function randomIp(): string {
    return Array.from({ length: 4 }, () => Math.floor(Math.random() * 255)).join('.');
}

export default async function rednoteHandler(req: Request, res: Response) {
    try {
        const input = String(req.query.url || (req.body && (req.body as any).url) || '').trim();
        if (!input) {
            return res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
        }

        const fakeIp = randomIp();
        const r = await axios.post(
            API_URL,
            { url: input },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': UA,
                    Referer: 'https://rednote.savevideodown.com/',
                    Origin: 'https://rednote.savevideodown.com',
                    'X-Forwarded-For': fakeIp,
                    'X-Real-IP': fakeIp,
                    'Client-IP': fakeIp,
                },
                timeout: 30000,
                validateStatus: (s: number) => s < 600,
            }
        );

        const d = (r.data || {}) as any;
        if (!d.success) {
            throw new Error(d.error || 'Gagal mengambil data');
        }

        const results = d.type === 'video'
            ? [d.directVideoUrl || d.downloadUrl].filter(Boolean)
            : (d.directImages || []);

        res.json({
            success: true,
            kind: 'rednote',
            title: d.title ?? null,
            author: d.author ?? null,
            type: d.type ?? null,
            results,
        });
    } catch (e) {
        res.status(500).json({ success: false, error: (e as any).message || 'Internal error' });
    }
}
