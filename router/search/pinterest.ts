import { Request, Response } from 'express';
import axios from 'axios';

const HOST = 'www.pinterest.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
const TARGET_COUNT = 25;
const MAX_CALLS = 4;

const HEADERS = {
    accept: 'application/json, text/javascript, */*; q=0.01',
    'x-pinterest-appstate': 'active',
    'x-pinterest-pws-handler': 'www/search/[scope].js',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': UA,
    referer: 'https://www.pinterest.com/',
    'accept-language': 'en-US,en;q=0.9',
};

function buildUrl(query: string, bookmark?: string | null): string {
    const options: Record<string, any> = {
        query,
        rs: 'rs',
        scope: 'pins',
        redux_normalize_feed: true,
        source_url: `/search/pins/?q=${encodeURIComponent(query)}&rs=rs`,
    };
    if (bookmark) options.bookmarks = [bookmark];

    const data = { options, context: {} };
    return `https://${HOST}/resource/BaseSearchResource/get/?source_url=/search/pins/?q=${encodeURIComponent(query)}&rs=rs&data=${encodeURIComponent(JSON.stringify(data))}`;
}

async function fetchPage(query: string, bookmark?: string | null) {
    const response = await axios.get(buildUrl(query, bookmark), {
        timeout: 25000,
        maxRedirects: 5,
        headers: HEADERS,
    });
    const rr = response.data?.resource_response || {};
    return {
        results: rr.data?.results || [],
        bookmark: rr.bookmark || null,
    };
}

function imageOf(pin: any): string | null {
    return pin?.images?.['474x']?.url ||
        pin?.images?.['236x']?.url ||
        pin?.images?.orig?.url ||
        null;
}

export default async function pinterestHandler(req: Request, res: Response) {
    const query = String(req.query.q || req.query.query || '').trim();

    if (!query) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'q' diperlukan."
        });
    }

    const seen = new Set<string>();
    const merged: any[] = [];
    let bookmark: string | null = null;

    for (let i = 0; i < MAX_CALLS && merged.length < TARGET_COUNT; i++) {
        const page = await fetchPage(query, bookmark);
        for (const pin of page.results) {
            if (pin && pin.id && !seen.has(pin.id) && imageOf(pin)) {
                seen.add(pin.id);
                merged.push(pin);
            }
        }
        bookmark = page.bookmark;
        if (!bookmark) break;
    }

    const formatted = merged
        .map((pin: any) => ({
            id: pin.id,
            title: pin.seo_alt_text || pin.title || 'No Title',
            image: imageOf(pin),
            board: pin.board?.name || '-',
            username: pin.pinner?.username || '-',
            source: `https://id.pinterest.com/pin/${pin.id}/`
        }))
        .slice(0, TARGET_COUNT);

    return res.json({
        status: true,
        result: formatted
    });
}
