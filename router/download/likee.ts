/*
 * Likee Downloader
 * type: Scraper
 * api: POST https://likeedownloader.com/process { id: url, locale }
 * author: wa.me/ikyykzy
 * note: ambil video likee (dengan / tanpa watermark) dengan parse HTML template.
 */
import { Request, Response } from 'express';
import axios from 'axios';

const API_URL = 'https://likeedownloader.com/process';
const UA = 'Mozilla/5.0 (Linux; Android 10)';

export default async function likeeHandler(req: Request, res: Response) {
    try {
        const input = String(req.query.url || (req.body && (req.body as any).url) || '').trim();
        if (!input) {
            return res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
        }
        if (!/likee\.(video|com)/i.test(input)) {
            return res.status(400).json({ success: false, error: 'Bukan URL Likee yang valid' });
        }

        const r = await axios.post(API_URL, new URLSearchParams({ id: input, locale: 'en' }), {
            headers: {
                'User-Agent': UA,
                Accept: 'application/json,text/javascript,*/*',
                'x-requested-with': 'XMLHttpRequest',
                'Content-Type': 'application/x-www-form-urlencoded',
                origin: 'https://likeedownloader.com',
                referer: 'https://likeedownloader.com/en',
            },
            timeout: 30000,
            validateStatus: (s: number) => s < 600,
        });

        const html = r.data && (r.data as any).template ? String((r.data as any).template) : null;
        if (!html) throw new Error('Fetch failed');

        const anchors = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
            href: m[1],
            text: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        }));

        const withWatermark =
            anchors.find((a) => /with\s*watermark/i.test(a.text))?.href ||
            anchors.find((a) => /watermark/i.test(a.text) && !/(without|no)\s*watermark/i.test(a.text))?.href ||
            null;
        const withoutWatermark =
            anchors.find((a) => /(without|no)\s*watermark/i.test(a.text))?.href || null;

        if (!withWatermark && !withoutWatermark) {
            throw new Error('Link tidak valid atau video tidak ditemukan');
        }

        const thumb = html.match(/<img[^>]+src="([^"]+)"/i)?.[1] || null;
        const stats = html.match(/(\d{1,3}(?:[.,]\d+)?\s*[KMB]?)[^<]*\b(?:views|likes?|plays?)\b/i)?.[1] || null;

        res.json({
            success: true,
            kind: 'likee',
            thumbnail: thumb,
            with_watermark: withWatermark,
            without_watermark: withoutWatermark,
            stats,
        });
    } catch (e) {
        res.status(500).json({ success: false, error: (e as any).message || 'Internal error' });
    }
}
