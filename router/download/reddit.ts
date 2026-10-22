/*
 * Reddit Downloader
 * type: Scraper
 * api: POST https://redvid.io/fetch { url, lang }
 * author: wa.me/ikyykzy
 * note: ambil media (video/gambar) dari post Reddit via redvid.io.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { cdnLink } from '../../src/cdn';

const API_URL = 'https://redvid.io/fetch';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export default async function redditHandler(req: Request, res: Response) {
    try {
        const input = String(req.query.url || (req.body && (req.body as any).url) || '').trim();
        if (!input) {
            return res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
        }

        const { data } = await axios.post(
            `${API_URL}?_=${Date.now()}`,
            { url: input, lang: 'en' },
            {
                headers: {
                    authority: 'redvid.io',
                    accept: 'application/json, text/plain, */*',
                    'content-type': 'application/json',
                    origin: 'https://redvid.io',
                    referer: 'https://redvid.io/',
                    'user-agent': UA,
                    'x-requested-with': 'XMLHttpRequest',
                },
                timeout: 30000,
                validateStatus: (s: number) => s < 600,
            }
        );

        if (!data || !data.success || !data.view) {
            throw new Error('Gagal mengambil data dari redvid.io');
        }

        const $ = cheerio.load(String(data.view));
        const results: any[] = [];

        $('.response-cinema-gallery-item').each((i, el) => {
            const thumb = $(el).find('img.thumbnail-image').attr('src');
            const downloadBtn = $(el).find('a[href*="/download?token="]');
            const href = downloadBtn.attr('href');
            const typeText = downloadBtn.text().trim();

            if (href) {
                results.push({
                    item: i + 1,
                    type: typeText.toLowerCase().includes('video') ? 'video' : 'image',
                    thumbnail: thumb || null,
                    download_url: href.startsWith('http') ? href : `https://redvid.io${href}`,
                });
            }
        });

        if (results.length === 0) {
            throw new Error('Tidak ada media yang ditemukan pada post ini');
        }

        const mediaHeaders = { 'User-Agent': UA, Referer: 'https://redvid.io/' };
        const cdnResults = results.map((r: any) => ({
            ...r,
            thumbnail: r.thumbnail
                ? cdnLink(req, r.thumbnail, `reddit_${r.item}_thumb.jpg`, mediaHeaders)
                : null,
            download_url: cdnLink(req, r.download_url, `reddit_${r.item}.${r.type === 'video' ? 'mp4' : 'jpg'}`, mediaHeaders),
        }));

        res.json({
            success: true,
            kind: 'reddit',
            title: $('.response-cinema-title').text().trim() || null,
            results: cdnResults,
        });
    } catch (e) {
        res.status(500).json({ success: false, error: (e as any).message || 'Internal error' });
    }
}
