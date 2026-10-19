/*
 * xHamster Scraper
 * type: Scraper
 * base: https://xhamster.com
 * author: wa.me/ikyykzy
 * note: search + full statistik/metadata video (caption/deskripsi, rating, like,
 *       dislike, view, komentar, tags, kategori, durasi, channel/author, tanggal)
 *       + CDN URL (HLS + mp4 per kualitas) yang di-decode dari window.initials.
 *       murni nodejs (axios). output JSON.
 *
 * sumber data: objek `window.initials` yang di-inject xhamster di tiap halaman.
 *   - /search/<query>  -> initials.searchResult, initials.pagination,
 *                         initials.searchTitleSummaryComponent, initials.filters
 *   - /videos/<...>    -> initials.videoModel, initials.videoEntity,
 *                         initials.xplayerSettings.sources, initials.ratingComponent,
 *                         initials.videoTagsComponent, initials.commentsComponent,
 *                         initials.downloadDropdownComponent.sources
 *
 * CDN url:
 *   xplayerSettings.sources[].url berisi hex ter-encode. Decode:
 *     byte0 = algoId (1..7), byte1..4 = seed (LE uint32), sisa byte XOR RNG.
 *     lalu hostMap["standard.h264.<quality>.prime"] menunjuk host CDN yg dipakai.
 *   downloadDropdownComponent.sources.mp4 sudah berupa url polos (tanpa decode).
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { fetchViaProxysite, debugViaProxysite } from './proxysite-util';

const BASE = 'https://xhamster.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const DEFAULT_HEADERS: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: BASE + '/',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

function cleanText(t: any): string | null {
    if (t === null || t === undefined) return null;
    const s = String(t).replace(/\s+/g, ' ').trim();
    return s || null;
}

function formatNumber(num: any): string | null {
    if (num === null || num === undefined) return null;
    const n = Number(num);
    if (!Number.isFinite(n)) return null;
    if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}

function parseDuration(seconds: any): string | null {
    if (seconds === null || seconds === undefined) return null;
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return null;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function toIso(unix: any): string | null {
    if (unix === null || unix === undefined) return null;
    const n = Number(unix);
    if (!Number.isFinite(n) || n <= 0) return null;
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pick(obj: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = {};
    for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === undefined || v === null) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
        out[k] = v;
    }
    return out;
}

function absolute(url: any): any {
    if (!url || typeof url !== 'string') return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return BASE + url;
    return url;
}

// ---------------------------------------------------------------------------
// window.initials extractor (brace-balanced)
// ---------------------------------------------------------------------------

function extractInitials(html: string): any | null {
    const m = html.match(/window\.initials\s*=\s*/);
    if (!m || m.index === undefined) return null;
    let i = m.index + m[0].length;
    const start = i;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) { i++; break; }
        }
    }
    const raw = html.slice(start, i);
    try { return JSON.parse(raw); } catch { return null; }
}

// ---------------------------------------------------------------------------
// CDN source decoder (port dari xplayer-experimental.js module 90404 & 61778)
// ---------------------------------------------------------------------------

const IMUL = Math.imul;

function hexToBytes(hex: string): number[] {
    const n = hex.length >> 1;
    const a: number[] = new Array(n);
    for (let i = 0; i < n; i++) a[i] = parseInt(hex.substr(i * 2, 2), 16);
    return a;
}

function makeRng(algo: number, seed: number): () => number {
    let i = seed | 0;
    switch (algo) {
        case 1: return () => { i = (IMUL(i, 1664525) + 0x3c6ef35f) | 0; return i & 255; };
        case 2: return () => { i |= 0; i ^= i << 13; i ^= i >>> 17; i ^= i << 5; return (i |= 0) & 255; };
        case 3: return () => { let e = (i = (i + 0x9e3779b9) | 0); e ^= e >>> 16; e = IMUL(e, 0x85ebca77); e ^= e >>> 13; e = IMUL(e, 0xc2b2ae3d); e ^= e >>> 16; return e & 255; };
        case 4: return () => { let e = (((i = (i + 0x6d2b79f5) | 0) << 7) | (i >>> 25)); e = (e + 0x9e3779b9) | 0; e ^= e >>> 11; return IMUL(e, 0x27d4eb2d) & 255; };
        case 5: return () => { i |= 0; i ^= i << 7; i ^= i >>> 9; i ^= i << 8; i = (i + 0xa5a5a5a5) | 0; return i & 255; };
        case 6: return () => { i = (IMUL(i, 0x2c9277b5) + 0xac564b05) | 0; return ((i ^ (i >>> 18)) >>> ((i >>> 27) & 31)) & 255; };
        case 7: return () => { let e = ((i = (i + 0x9e3779b9) | 0) ^ (i << 5)); e = IMUL(e, 0x7feb352d); e ^= e >>> 15; e = IMUL(e, 0x846ca68b); return e & 255; };
    }
    throw new Error('unknown algoId: ' + algo);
}

function decodeHex(str: string): string | null {
    const len = str.length;
    if (!(len >= 12 && (len & 1) === 0 && /^[0-9a-fA-F]+$/.test(str))) return null;
    const bytes = hexToBytes(str);
    if (bytes.length < 5) return null;
    const algo = bytes[0] | 0;
    if (algo < 1 || algo > 7) return null;
    const seed = (bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24)) | 0;
    const rng = makeRng(algo, seed);
    const out: number[] = new Array(bytes.length - 5);
    for (let a = 5, l = 0; a < bytes.length; a++, l++) out[l] = (bytes[a] ^ rng()) & 255;
    let pct = '';
    for (const b of out) { let s = b.toString(16); if (s.length < 2) s = '0' + s; pct += '%' + s; }
    let res: string;
    try { res = decodeURIComponent(pct); } catch { res = ''; for (const b of out) res += String.fromCharCode(b); }
    return (typeof res === 'string' && res.length > 0 && /^[\x20-\x7E]+$/.test(res)) ? res : null;
}

function decodeSourceValue(val: any): any {
    if (typeof val !== 'string' || !val.length) return val;
    const whole = decodeHex(val);
    if (whole !== null) return whole;
    const scheme = val.indexOf('://');
    const slash = scheme !== -1 ? val.indexOf('/', scheme + 3) : val.indexOf('/');
    if (slash === -1) return val;
    const n = slash + 1;
    if (n >= val.length) return val;
    const r = val.indexOf('/', n);
    const o = val.indexOf(',', n);
    let a = -1;
    if (r !== -1 && o !== -1) a = Math.min(r, o);
    else if (r !== -1) a = r;
    else if (o !== -1) a = o;
    if (a === -1 || a <= n) return val;
    const dec = decodeHex(val.substring(n, a));
    if (dec !== null) return val.substring(0, n) + dec + val.substring(a);
    return val;
}

function replaceHost(url: any, host: any): any {
    if (!url || typeof url !== 'string' || !host || typeof host !== 'string') return url;
    const rel = url.startsWith('//');
    const s = rel ? 'https:' + url : url;
    try {
        const u = new URL(s);
        const parts = u.hostname.split('.');
        if (parts.length < 2) return url;
        parts[0] = host;
        u.hostname = parts.join('.');
        const out = u.toString();
        return rel ? out.replace(/^https:/, '') : out;
    } catch { return url; }
}

function walkReplace(node: any, fn: (v: any) => any): any {
    if (!node || typeof node !== 'object') return node;
    const out: any = Array.isArray(node) ? [] : {};
    for (const k of Object.keys(node)) {
        if (node[k] && typeof node[k] === 'object') out[k] = walkReplace(node[k], fn);
        else if (k === 'url' || k === 'fallback') out[k] = fn(node[k]);
        else out[k] = node[k];
    }
    return out;
}

function applyHostMap(node: any, hostMap: any, path: string[] = []): any {
    if (!node || typeof node !== 'object' || !hostMap || typeof hostMap !== 'object') return node;
    const out: any = Array.isArray(node) ? [] : {};
    for (const key of Object.keys(node)) {
        const val = node[key];
        const p = [...path, key];
        if (val && typeof val === 'object') { out[key] = applyHostMap(val, hostMap, p); continue; }
        if ((key === 'url' || key === 'fallback') && typeof val === 'string') {
            let mapKey: string | null = null;
            const p0 = p[0];
            const p1 = p[1];
            if (p0 === 'hls') mapKey = key === 'url' ? `hls.${p1}` : `hls.${p1}.fallback`;
            else if (p0 === 'standard') {
                const q = (node.quality && String(node.quality)) || (p[2] != null ? String(p[2]) : '');
                if (q) mapKey = `standard.${p1}.${q}.${key === 'url' ? 'prime' : 'fallback'}`;
            }
            const host = mapKey ? hostMap[mapKey] : null;
            out[key] = replaceHost(val, host);
        } else out[key] = val;
    }
    return out;
}

function decodeSources(sources: any, hostMap: any): any {
    if (!sources) return null;
    const decoded = walkReplace(sources, decodeSourceValue);
    return hostMap ? applyHostMap(decoded, hostMap) : decoded;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function httpGet(url: string, opts: { headers?: Record<string, string>; retries?: number } = {}) {
    const { headers = {}, retries = 3 } = opts;
    let lastErr: any;
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, {
                headers: { ...DEFAULT_HEADERS, ...headers },
                maxRedirects: 5,
                timeout: 45000,
                validateStatus: (s: number) => s >= 200 && s < 400,
            });
            return res;
        } catch (err: any) {
            lastErr = err;
            const st = err.response?.status;
            const retryable = !st || st === 429 || st >= 500;
            if (!retryable || i === retries - 1) throw err;
            await sleep(1000 * (i + 1));
        }
    }
    throw lastErr;
}

// ---------------------------------------------------------------------------
// normalizers
// ---------------------------------------------------------------------------

function normalizeVideoItem(item: any): any | null {
    if (!item || typeof item !== 'object') return null;
    const durationSec = item.duration ?? null;
    return pick({
        id: item.id ?? null,
        title: cleanText(item.title),
        type: item.videoType || 'video',
        url: item.pageURL || null,
        duration_seconds: durationSec,
        duration: durationSec !== null ? parseDuration(durationSec) : null,
        created: item.created ?? null,
        published_at: toIso(item.created),
        views: item.views ?? null,
        views_text: item.views !== undefined ? formatNumber(item.views) : null,
        rating: item.rating && item.rating.value !== undefined ? item.rating.value : (item.rating ?? null),
        is_hd: item.isHD ?? null,
        is_hd_1080: item.isHD1080 ?? null,
        is_uhd: item.isUHD ?? null,
        is_vr: item.isVR ?? null,
        channel: item.channelModel ? pick({
            id: item.channelModel.id,
            name: item.channelModel.channelName,
            url: item.channelModel.channelURL,
            logo: absolute(item.channelModel.siteLogoURL),
        }) : (item.landing ? pick({
            type: item.landing.type,
            id: item.landing.id,
            name: item.landing.name,
            url: item.landing.link,
            logo: absolute(item.landing.logo),
            subscribers: item.landing.subscribers,
        }) : null),
        author: item.author ? pick({
            id: item.author.id,
            name: item.author.name,
            url: item.author.pageURL,
            verified: item.author.verified,
        }) : null,
        thumbnail: absolute(item.thumbURL || item.imageURL || null),
        image: absolute(item.imageURL || null),
        preview: absolute(item.previewThumbURL || null),
        sprite: absolute(item.spriteURL || null),
        trailer: absolute(item.trailerURL || null),
        trailer_fallback: absolute(item.trailerFallbackUrl || null),
    });
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

function normalizeFilters(filters: any): any {
    if (!filters || typeof filters !== 'object') return null;
    const out: any = {};
    const orient = filters.orientationsSelectorProps;
    if (orient) out.orientations = (orient.items || []).map((i: any) => i.value);
    const sort = filters.sortSelectorProps;
    if (sort) out.sorts = (sort.options || []).map((i: any) => i.value);
    const quality = filters.qualitySelectorProps;
    if (quality) out.min_qualities = (quality.items || []).map((i: any) => i.value);
    return Object.keys(out).length ? out : null;
}

async function search(query: string, opts: { page?: any; sort?: any; minQuality?: any; orientation?: any } = {}) {
    const startedAt = new Date().toISOString();
    const page = Math.max(1, parseInt(String(opts.page || ''), 10) || 1);
    const q = encodeURIComponent(String(query || '').trim()).replace(/%20/g, '+');
    const params: Record<string, string> = {};
    if (page > 1) params.page = String(page);
    if (opts.sort) params.sort = String(opts.sort);
    if (opts.minQuality) params.quality = String(opts.minQuality);
    if (opts.orientation) params.orientation = String(opts.orientation);
    const qs = Object.keys(params).length
        ? '?' + new URLSearchParams(params).toString()
        : '';
    const url = `${BASE}/search/${q}${qs}`;

    const res = await httpGet(url);
    let o = extractInitials(res.data);
    if (!o) throw new Error('window.initials not found (layout changed or blocked)');

    let sr = o.searchResult;
    let items: any[] = [];
    if (Array.isArray(sr)) items = sr;

    let via = 'direct';
    // searchResult tidak ada sama sekali -> wall (consent/geo, biasanya IP datacenter).
    // Coba bypass via proxysite (egress IP berbeda) sebelum menyerah.
    if (sr === undefined) {
        const px = await fetchViaProxysite(url);
        if (px) {
            const o2 = extractInitials(px.html);
            const sr2 = o2?.searchResult;
            if (o2 && sr2 !== undefined) {
                o = o2;
                sr = o.searchResult;
                items = Array.isArray(sr) ? sr : [];
                via = `proxysite:${px.server}`;
            }
        }
    }
    if (sr === undefined) throw new Error('xhamster wall terdeteksi & fallback proxysite gagal');
    else if (sr && typeof sr === 'object' && !Array.isArray(sr)) {
        for (const k of Object.keys(sr)) if (Array.isArray(sr[k])) { items = sr[k]; break; }
    }

    const videos = items.map(normalizeVideoItem).filter(Boolean);
    const pg = o.pagination || {};
    const summary = o.searchTitleSummaryComponent || {};
    const suggestions = (o.searchVideoSuggestions?.tags || [])
        .map((t: any) => cleanText(t.plainText || t.text))
        .filter(Boolean);

    return pick({
        success: true,
        scraped_at: startedAt,
        type: 'search',
        base: BASE,
        query: String(query || '').trim(),
        source_url: url,
        via,
        result_count: summary.resultCount || null,
        page_title: cleanText(summary.title),
        page: {
            active: pg.active ?? page,
            next: pg.next ?? null,
            prev: pg.prev ?? null,
            max_page: pg.maxPage ?? null,
            max_pages: pg.maxPages ?? null,
            per_page: items.length,
        },
        filters: normalizeFilters(o.filters),
        suggestions: suggestions.length ? suggestions : undefined,
        total_on_page: videos.length,
        videos,
    });
}

// ---------------------------------------------------------------------------
// video
// ---------------------------------------------------------------------------

function normalizeComments(commentsComponent: any): any | null {
    if (!commentsComponent || !commentsComponent.commentsList) return null;
    const cl = commentsComponent.commentsList;
    const counters = cl.counters || {};
    const items = (cl.items || []).map((c: any) => pick({
        id: c.id ?? null,
        author: c.author ? cleanText(c.author.name) : null,
        author_url: c.author ? c.author.pageURL : null,
        text: cleanText(c.body || c.text || c.message),
        likes: c.rating != null ? c.rating : (c.likes ?? null),
        created: c.created ?? c.date ?? null,
        created_at: toIso(c.created ?? c.date),
    }));
    return pick({
        total: counters.total ?? null,
        pages: counters.pages ?? null,
        is_enabled_timecodes: commentsComponent.isEnabledTimeCodes ?? null,
        count_returned: items.length,
        items,
    });
}

function normalizeTags(videoTagsComponent: any): any | null {
    if (!videoTagsComponent || !Array.isArray(videoTagsComponent.tags)) return null;
    const categories: string[] = [];
    const tags: string[] = [];
    const pornstars: string[] = [];
    const channels: string[] = [];
    for (const t of videoTagsComponent.tags) {
        const name = cleanText(t.name);
        if (!name) continue;
        if (t.isPornstar && !pornstars.includes(name)) pornstars.push(name);
        else if (t.isChannel && !channels.includes(name)) channels.push(name);
        else if (t.isCategory && !categories.includes(name)) categories.push(name);
        else if (t.isTag && !tags.includes(name)) tags.push(name);
    }
    return pick({ categories, tags, pornstars, channels });
}

async function getVideo(inputUrl: string, _opts: Record<string, any> = {}) {
    const startedAt = new Date().toISOString();
    let url = String(inputUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) url = `${BASE}/videos/${url.replace(/^\/+/, '')}`;

    const res = await httpGet(url);
    const finalUrl = (res.request?.res as any)?.responseUrl || url;
    let o = extractInitials(res.data);
    if (!o) throw new Error('window.initials not found (layout changed or blocked)');

    let via = 'direct';
    let vm = o.videoModel || {};
    let ve = o.videoEntity || {};
    let xp = o.xplayerSettings || {};

    // videoModel + xplayerSettings dua-duanya kosong -> wall (consent/geo, biasanya
    // IP datacenter). Coba bypass via proxysite (egress IP berbeda) sebelum menyerah.
    if (!vm.id && !ve.id && !xp.sources) {
        const px = await fetchViaProxysite(url);
        if (px) {
            const o2 = extractInitials(px.html);
            if (o2 && ((o2.videoModel?.id || o2.videoEntity?.id) || o2.xplayerSettings?.sources)) {
                o = o2;
                vm = o.videoModel || {};
                ve = o.videoEntity || {};
                xp = o.xplayerSettings || {};
                via = `proxysite:${px.server}`;
            }
        }
    }
    if (!vm.id && !ve.id && !xp.sources) throw new Error('xhamster wall terdeteksi & fallback proxysite gagal');

    const durationSec = vm.duration ?? ve.duration ?? null;
    const ratingModel = o.ratingComponent?.ratingModel || {};

    const streams: any = {};
    const decoded = decodeSources(xp.sources, o.hostMap);
    if (decoded) {
        if (decoded.hls?.h264?.url) streams.hls = decoded.hls.h264.url;
        if (Array.isArray(decoded.standard?.h264)) {
            // buang entry "auto" (itu master HLS .m3u8, bukan file mp4 langsung)
            streams.mp4 = decoded.standard.h264
                .filter((s: any) => s && s.url && !/\.m3u8(\?|$)/i.test(s.url))
                .map((s: any) => pick({ quality: s.quality || s.label, url: s.url }));
        }
    }

    const downloadSources = o.downloadDropdownComponent?.sources || null;
    const dlMp4 = downloadSources?.mp4 || null;
    const dlLinks = downloadSources?.download || null;
    const dlKeys: string[] = dlMp4
        ? Object.keys(dlMp4)
        : (dlLinks ? Object.keys(dlLinks) : []);
    const download = dlKeys.length
        ? dlKeys.map((q) => {
            const info = dlLinks?.[q];
            return pick({
                quality: q,
                size_bytes: typeof info === 'object' ? info?.size ?? null : null,
                url: dlMp4?.[q] || (typeof info === 'object' ? info?.link : null),
                link: typeof info === 'object' ? info?.link ?? null : null,
            });
        })
        : null;

    const relatedProps = o.relatedVideosComponent?.videoTabInitialData?.videoListProps?.videoThumbProps;
    const related = Array.isArray(relatedProps)
        ? relatedProps.map(normalizeVideoItem).filter(Boolean)
        : [];

    const thumbs = ve.thumbs ? Object.keys(ve.thumbs).map((k) => ({
        frame: Number(k),
        url: absolute(ve.thumbs[k]),
    })) : [];

    const subscriberCount = o.subscriptionComponent?.subscribeButtonsProps?.subscribeButtonProps?.subscribers
        ?? o.videoTagsComponent?.subscriptionModel?.subscribers
        ?? null;

    const bestMp4 = streams.mp4 && streams.mp4.length
        ? streams.mp4.slice().sort((a: any, b: any) => (parseInt(String(b.quality), 10) || 0) - (parseInt(String(a.quality), 10) || 0))[0]
        : null;

    return pick({
        success: true,
        scraped_at: startedAt,
        type: 'video',
        base: BASE,
        source_url: inputUrl,
        final_url: finalUrl,
        via,
        source_domain: (() => { try { return new URL(finalUrl).hostname; } catch { return null; } })(),
        id: vm.id ?? ve.id ?? null,
        id_slug: vm.idHashSlug ?? ve.idHashSlug ?? null,
        title: cleanText(vm.title || ve.title || o.videoTitle?.pageTitle),
        description: cleanText(vm.description || ve.description || vm.title),
        duration_seconds: durationSec,
        duration: durationSec !== null ? parseDuration(durationSec) : null,
        orientation: o.videoTagsComponent?.orientation
            || (typeof ve.orientation === 'object' ? ve.orientation : null)
            || (vm.orientation === 0 ? 'straight' : null),
        published_at: toIso(vm.created ?? ve.created),
        created: vm.created ?? ve.created ?? null,
        date_text: ve.dateAgo ?? null,
        links: pick({
            watch: vm.pageURL || ve.pageURL || finalUrl,
            embed: (vm.idHashSlug || ve.idHashSlug)
                ? `${BASE}/embed/${vm.idHashSlug || ve.idHashSlug}`
                : null,
            channel: vm.channelModel?.channelURL || vm.landing?.link || null,
            author: vm.author?.pageURL || null,
        }),
        thumbnail: absolute(vm.thumbURL || ve.thumbBig || null),
        preview: absolute(vm.previewThumbURL || null),
        sprite: absolute(vm.spriteURL || null),
        trailer: absolute(vm.trailerURL || null),
        thumbnails: thumbs.length ? thumbs : undefined,
        flags: {
            is_hd: vm.isHD ?? ve.isHD ?? null,
            is_fhd: vm.isFHD ?? null,
            is_uhd: vm.isUHD ?? null,
            is_vr: vm.isVR ?? ve.isVr ?? null,
            is_downloadable: ve.isDownloadable ?? null,
            is_geo_blocked: ve.isGeoBlocked ?? null,
            max_resolution: ve.maxResolution ?? null,
            resolution: vm.resolution ?? null,
        },
        stats: pick({
            views: vm.views ?? ve.views ?? o.videoTitle?.views ?? null,
            views_text: formatNumber(vm.views ?? ve.views ?? o.videoTitle?.views),
            comments: ve.commentsCount ?? o.commentsComponent?.commentsList?.counters?.total ?? null,
            likes: ratingModel.likes ?? null,
            dislikes: ratingModel.dislikes ?? null,
            rating_percent: ratingModel.value ?? (typeof vm.rating === 'object' ? vm.rating.value : vm.rating) ?? o.videoTitle?.rating ?? null,
        }),
        channel: vm.channelModel ? pick({
            id: vm.channelModel.id,
            name: vm.channelModel.channelName,
            url: vm.channelModel.channelURL,
            logo: absolute(vm.channelModel.siteLogoURL),
            subscribers: subscriberCount,
        }) : (vm.landing ? pick({
            type: vm.landing.type,
            id: vm.landing.id,
            name: vm.landing.name,
            url: vm.landing.link,
            logo: absolute(vm.landing.logo),
            subscribers: vm.landing.subscribers ?? subscriberCount,
        }) : null),
        author: vm.author ? pick({
            id: vm.author.id,
            name: vm.author.name,
            url: vm.author.pageURL,
            verified: vm.author.verified,
            retired: vm.author.retired,
        }) : null,
        tags: normalizeTags(o.videoTagsComponent),
        comments: normalizeComments(o.commentsComponent),
        cdn: pick({
            hls_master: streams.hls || null,
            mp4: streams.mp4 && streams.mp4.length ? streams.mp4 : undefined,
            download: download || undefined,
        }),
        url: {
            hls: streams.hls || null,
            mp4_best: bestMp4 ? bestMp4.url : null,
        },
        related_count: related.length,
        related: related.length ? related : undefined,
    });
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

export default async function xhamsterHandler(req: Request, res: Response) {
    try {
        const videoUrl = String(req.query.url || '').trim();
        const q = String(req.query.q || '').trim();
        const target = videoUrl || q;

        if (!target) {
            return res.status(400).json({
                success: false,
                error: "Parameter wajib: 'url' (video) atau 'q' (search)",
                usage: '/api/nsfw/xhamster?q=<query>[&page&sort&min_quality&orientation] | /api/nsfw/xhamster?url=<video_url>',
            });
        }

        // debug: /api/nsfw/xhamster?q=...&debug=ps -> traceback tiap server proxysite
        if (req.query.debug === 'ps') {
            const servers = String(req.query.servers || 'us8,eu19,us4').split(',').map((s) => s.trim()).filter(Boolean);
            const diagnostics = await debugViaProxysite(target, servers);
            return res.json({ success: true, type: 'proxysite-debug', diagnostics });
        }

        // auto-detect: url -> video | q -> search
        const isVideo = videoUrl
            ? true
            : (/^https?:\/\//i.test(q) || /xhamster\.com\/(videos|embed)\//i.test(q));

        const opts = {
            page: req.query.page,
            sort: req.query.sort,
            minQuality: req.query.min_quality || req.query.minQuality,
            orientation: req.query.orientation,
        };

        const result = isVideo
            ? await getVideo(target)
            : await search(target, opts);

        res.json(result);
    } catch (err: any) {
        res.status(500).json({
            success: false,
            error: err?.message || 'Internal error',
            status: err?.response?.status ?? null,
        });
    }
}
