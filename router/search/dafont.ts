/*
 * DaFont Search
 * type: Scraper
 * source: https://www.dafont.com/search.php
 * author: wa.me/ikyykzy
 * note: cari font gratis dari DaFont (nama, author, jumlah download,
 *       lisensi, link download .zip, dan preview).
 */
import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

const BASE = 'https://www.dafont.com';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

export default async function dafontHandler(req: Request, res: Response) {
    const query = String(req.query.q || req.query.query || '').trim();

    if (!query) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'q' diperlukan."
        });
    }

    const { data } = await axios.get(`${BASE}/search.php`, {
        params: { q: query },
        timeout: 20000,
        maxRedirects: 5,
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });

    const $ = cheerio.load(data);
    const results: any[] = [];

    $('.lv1left.dfbg').each((_i, el) => {
        const base = $(el);
        const lv2 = base.nextAll('.lv2right').first();
        const dlbox = base.nextAll('.dlbox').first();
        const previewBox = base.nextAll('.preview').first();

        const raw = base.text().replace(/\s+/g, ' ').trim();
        const author = base.find('a').first().text().trim();
        const name = raw.replace(/\s*by\s*.+$/i, '').trim();

        const info = lv2.find('.light').text().trim();
        const downloads = info.match(/[\d,]+ downloads/)?.[0] || null;
        const yesterday = info.match(/\((.*?)\)/)?.[1] || null;
        const license = lv2.find('a.help').first().text().trim();

        const dl = dlbox.find('a.dl').attr('href');
        const download = dl ? `https:${dl}` : null;

        const style = previewBox.attr('style');
        const preview = style
            ? BASE + (style.match(/url\((.*?)\)/)?.[1] || '')
            : null;

        results.push({ name, author, downloads, yesterday, license, download, preview });
    });

    if (results.length === 0) {
        return res.json({
            status: true,
            query,
            count: 0,
            result: []
        });
    }

    return res.json({
        status: true,
        query,
        count: results.length,
        result: results
    });
}
