/*
 * Douyin Downloader
 * type: Scraper
 * api: POST https://snapvideotools.com/api/snap { text: url }
 * author: wa.me/ikyykzy
 * note: ambil video + audio (url langsung) dari link Douyin/TikTok CN.
 */
import { Request, Response } from 'express';
import axios from 'axios';

const API_URL = 'https://snapvideotools.com/api/snap';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export default async function douyinHandler(req: Request, res: Response) {
    try {
        const input = String(req.query.url || (req.body && (req.body as any).url) || '').trim();
        if (!input) {
            return res.status(400).json({ success: false, error: 'Parameter url wajib diisi' });
        }

        const r = await axios.post(
            API_URL,
            { text: input },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json, text/javascript, */*; q=0.01',
                    'X-Requested-With': 'XMLHttpRequest',
                    'User-Agent': UA,
                    Referer: 'https://snapvideotools.com/',
                    Origin: 'https://snapvideotools.com',
                },
                timeout: 30000,
                validateStatus: (s: number) => s < 600,
            }
        );

        const data = r.data && (r.data as any).data;
        if (!data || !Array.isArray(data.mediaUrls) || data.mediaUrls.length === 0) {
            throw new Error((r.data && ((r.data as any).message || (r.data as any).error)) || 'Data tidak ditemukan');
        }

        const video = data.mediaUrls.find((m: any) => m.type === 'video');
        const audio = data.mediaUrls.find((m: any) => m.type === 'audio');

        res.json({
            success: true,
            kind: 'douyin',
            title: data.title ?? null,
            platform: data.platformName ?? 'douyin',
            video: video ? video.url : null,
            audio: audio ? audio.url : null,
            medias: data.mediaUrls,
        });
    } catch (e) {
        res.status(500).json({ success: false, error: (e as any).message || 'Internal error' });
    }
}
