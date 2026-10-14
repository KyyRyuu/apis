/*
 * YouTube Downloader
 * type: Scraper + Proxy
 * base: YouTube InnerTube (ANDROID + IOS + WEB) / Invidious / Piped fallback
 * author: wa.me/ikyykzy
 * note: download video youtube & shorts & music & post. support shorts, video biasa,
 *       music.youtube.com, youtu.be, watch, embed, live, post (image/slide).
 *       get cdn url + full stats (caption, like, comment, view, dll).
 *       tanpa yt-dlp, murni nodejs (axios).
 *       SEMUA url media di-response sudah dibungkus link proxy (field "proxy") supaya
 *       user TIDAK perlu set header (User-Agent/Referer/Range) sendiri -> tinggal klik.
 */
import { Request, Response } from 'express';
import axios from 'axios';
import { URL } from 'url';

const UA_BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const UA_ANDROID = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const UA_EMBED = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const WEB_VERSION = '2.20260923.00.00';

const ANDROID_CTX = {
    clientName: 'ANDROID',
    clientVersion: '20.10.38',
    hl: 'en',
    gl: 'US',
    androidSdkVersion: 30,
    osName: 'Android',
    osVersion: '11',
    platform: 'MOBILE',
    clientFormFactor: 'SMALL_FORM_FACTOR',
    userAgent: UA_ANDROID,
};

const IOS_CTX = {
    clientName: 'IOS',
    clientVersion: '20.10.38',
    hl: 'en',
    gl: 'US',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    osName: 'iPhone',
    osVersion: '17.5.1.21F90',
    platform: 'MOBILE',
    clientFormFactor: 'SMALL_FORM_FACTOR',
    userAgent: 'com.google.ios.youtube/20.10.38 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X)',
};

const WEB_CTX = { clientName: 'WEB', clientVersion: WEB_VERSION, hl: 'en', gl: 'US' };

const ANDROID_VR_CTX = {
    clientName: 'ANDROID_VR',
    clientVersion: '1.62.27',
    hl: 'en',
    gl: 'US',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    osName: 'Android',
    osVersion: '12',
    androidSdkVersion: 32,
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; GB) gzip',
};

const TVHTML5_CTX = { clientName: 'TVHTML5', clientVersion: '7.20250101.00.00', hl: 'en', gl: 'US' };

const MWEB_CTX = { clientName: 'MWEB', clientVersion: '2.20250101.00.00', hl: 'en', gl: 'US' };

const TV_EMBED_CTX = { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' };

const WEB_EMBED_CTX = { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '1.20250101.00.00', hl: 'en', gl: 'US' };

const UA_VR = 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; GB) gzip';
const UA_TV = 'Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15';

const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://yewtu.be',
    'https://invidious.f5.si',
    'https://iv.melmac.space',
    'https://id.420129.xyz',
    'https://invidious.reallyaweso.me',
    'https://inv.zzls.xyz',
];

const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.private.coffee',
    'https://pipedapi.reallyaweso.me',
    'https://pipedapi.ducks.party',
    'https://pipedapi.drgns.space',
];

const PROXY_URL = process.env.YOUTUBE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 1000): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err: any) {
            lastErr = err;
            const status = err.response?.status || err.status;
            const retryable = !status || status === 429 || status >= 500;
            if (!retryable || i === retries - 1) throw err;
            await sleep(baseDelay * (i + 1));
        }
    }
    throw lastErr;
}

function extractVideoId(url: string): string | null {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    const host = u.hostname.toLowerCase();

    const isYT = host.includes('youtube.com')
        || host.includes('youtu.be')
        || host.includes('youtube-nocookie.com');

    if (!isYT) return null;

    if (u.pathname.includes('/shorts/')) {
        return u.pathname.split('/shorts/')[1].split('/')[0].split('?')[0];
    }
    if (u.pathname.includes('/watch')) {
        return u.searchParams.get('v');
    }
    if (u.pathname.includes('/live/')) {
        return u.pathname.split('/live/')[1].split('/')[0].split('?')[0];
    }
    if (u.pathname.includes('/v/')) {
        return u.pathname.split('/v/')[1].split('/')[0].split('?')[0];
    }
    if (host === 'youtu.be') {
        return u.pathname.slice(1).split('?')[0].split('/')[0] || null;
    }
    if (u.pathname.includes('/embed/')) {
        return u.pathname.split('/embed/')[1].split('?')[0].split('/')[0];
    }
    const v = u.searchParams.get('v');
    if (v) return v;
    return null;
}

function isMusicSourceUrl(url: string): boolean {
    try {
        const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        return u.hostname.toLowerCase().includes('music.youtube.com');
    } catch {
        return false;
    }
}

function extractPostId(url: string): string | null {
    try {
        const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        const host = u.hostname.toLowerCase();
        if (!host.includes('youtube.com') && !host.includes('youtu.be')) return null;
        if (u.pathname.includes('/post/')) {
            const id = u.pathname.split('/post/')[1].split('/')[0].split('?')[0].trim();
            if (id && /^[A-Za-z0-9_-]{5,}$/.test(id)) return id;
        }
        return null;
    } catch {
        return null;
    }
}

function isPostUrl(url: string): boolean {
    return Boolean(extractPostId(url));
}

function parseVoteTextId(text: any): number | null {
    if (text === null || text === undefined) return null;
    let s = String(text).trim().toLowerCase().replace(/\u00a0/g, ' ');
    if (!s) return null;
    s = s.replace(/\brb\b/g, 'K').replace(/\bribu\b/g, 'K')
        .replace(/\bjt\b/g, 'M').replace(/\bjuta\b/g, 'M')
        .replace(/\bmdr\b/g, 'B').replace(/\bmiliar\b/g, 'B');
    const m = s.replace(/\s+/g, '').match(/^([\d.,]+)([KMB])?$/i);
    if (!m) {
        const n = Number(String(text).replace(/[^\d]/g, ''));
        return Number.isFinite(n) ? n : null;
    }
    let numStr = m[1];
    if (numStr.includes('.') && numStr.includes(',')) {
        numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else if (numStr.includes(',') && !numStr.includes('.')) {
        const parts = numStr.split(',');
        if (parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) {
            numStr = parts.join('');
        } else {
            numStr = numStr.replace(',', '.');
        }
    } else {
        if (!m[2] && /^\d{1,3}(\.\d{3})+$/.test(numStr)) numStr = numStr.replace(/\./g, '');
    }
    let n = parseFloat(numStr);
    if (!Number.isFinite(n)) return null;
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') n *= 1e3;
    else if (suf === 'M') n *= 1e6;
    else if (suf === 'B') n *= 1e9;
    return Math.round(n);
}

function parsePostExactLike(accessibilityLabel: any): number | null {
    if (!accessibilityLabel) return null;
    const s = String(accessibilityLabel);
    const m = s.match(/bersama\s+([\d.,]+)/i) || s.match(/along with\s+([\d,.,]+)/i);
    if (!m) return null;
    let numStr = m[1];
    if (numStr.includes('.') && numStr.includes(',')) {
        numStr = m[1].replace(/\./g, '').replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(numStr)) {
        numStr = numStr.replace(/\./g, '');
    } else if (/^\d{1,3}(,\d{3})+$/.test(numStr)) {
        numStr = numStr.replace(/,/g, '');
    } else {
        numStr = numStr.replace(',', '.');
    }
    const n = Number(numStr.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
}

function pickLargestThumb(thumbs: any): any {
    if (!Array.isArray(thumbs) || !thumbs.length) return null;
    const list = thumbs.filter((t) => t && t.url).map((t) => ({
        url: String(t.url).startsWith('//') ? 'https:' + t.url : String(t.url),
        width: t.width || null,
        height: t.height || null,
        area: (Number(t.width) || 0) * (Number(t.height) || 0),
    }));
    if (!list.length) return null;
    list.sort((a, b) => b.area - a.area);
    return list[0];
}

async function fetchPostHtml(postId: string): Promise<string> {
    const url = `https://www.youtube.com/post/${postId}`;
    const res = await withRetry(() => axios.get(url, {
        headers: {
            'User-Agent': UA_BROWSER,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        ...proxyConf(),
        timeout: 20000,
    }));
    return String(res.data || '');
}

function extractBalancedJson(str: string, startIdx: number): string | null {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = startIdx; i < str.length; i++) {
        const c = str[i];
        if (inStr) {
            if (esc) esc = false;
            else if (c === '\\') esc = true;
            else if (c === '"') inStr = false;
            continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return str.slice(startIdx, i + 1);
        }
    }
    return null;
}

function parsePostInitialData(html: string): any {
    const mSingle = html.match(/ytInitialData\s*=\s*'((?:\\.|[^'])*)';/s);
    if (mSingle) {
        const raw = mSingle[1];
        let jsonStr;
        try {
            jsonStr = (new Function('return ' + "'" + raw + "'"))();
        } catch {
            throw new Error('Gagal decode ytInitialData.');
        }
        try {
            return JSON.parse(jsonStr);
        } catch {
            throw new Error('Gagal parse ytInitialData JSON.');
        }
    }
    const idx = html.indexOf('ytInitialData');
    if (idx >= 0) {
        const eq = html.indexOf('=', idx);
        const brace = eq >= 0 ? html.indexOf('{', eq) : -1;
        if (brace >= 0) {
            const jsonStr = extractBalancedJson(html, brace);
            if (jsonStr) {
                try {
                    return JSON.parse(jsonStr);
                } catch {
                    throw new Error('Gagal parse ytInitialData JSON langsung.');
                }
            }
        }
    }
    throw new Error('ytInitialData tidak ditemukan. Post mungkin privat/terhapus atau YouTube mengubah layout.');
}

function parsePostRenderer(data: any): any {
    const secs = data?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (!secs?.length) return null;
    const thread = secs[0]?.itemSectionRenderer?.contents?.[0]?.backstagePostThreadRenderer;
    const post = thread?.post?.backstagePostRenderer;
    if (!post?.postId) return null;
    return { post, microformat: data?.microformat?.microformatDataRenderer || null };
}

async function verifyImageUrl(url: string): Promise<any> {
    const out: any = { ok: false, status: null, content_type: null, bytes: 0, container: null, error: null };
    if (!url) { out.error = 'URL tidak tersedia'; return out; }
    try {
        const head = await axios.head(url, {
            ...proxyConf(),
            timeout: 15000,
            validateStatus: (s) => s < 500,
            headers: { 'User-Agent': UA_BROWSER, Referer: 'https://www.youtube.com/' },
        });
        out.status = head.status;
        out.content_type = head.headers['content-type'] || null;
    } catch (err: any) {
        out.error = err.message;
    }
    try {
        const res = await axios.get(url, {
            ...proxyConf(),
            timeout: 15000,
            validateStatus: (s) => s < 500,
            responseType: 'arraybuffer',
            headers: { 'User-Agent': UA_BROWSER, Referer: 'https://www.youtube.com/', Range: 'bytes=0-2047' },
        });
        const buf = Buffer.from(res.data || []);
        out.bytes = buf.length;
        if (!out.status) out.status = res.status;
        if (!out.content_type) out.content_type = res.headers['content-type'] || null;
        if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) out.container = 'jpeg';
        else if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) out.container = 'png';
        else if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') out.container = 'webp';
        else if (buf.slice(0, 6).toString('latin1').startsWith('GIF')) out.container = 'gif';
        const isImg = /^image\//i.test(out.content_type || '') || ['jpeg', 'png', 'webp', 'gif'].includes(out.container);
        out.ok = (res.status === 200 || res.status === 206) && buf.length > 0 && isImg;
        if (!out.ok && !out.error) out.error = !isImg ? 'isi bukan gambar' : `http ${res.status}`;
    } catch (err: any) {
        out.error = out.error || err.message;
    }
    return out;
}

// ---------- proxy link helpers ----------

function b64urlEncode(str: string): string {
    return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
    const pad = str.length % 4 ? '='.repeat(4 - (str.length % 4)) : '';
    return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('utf8');
}

const MEDIA_HOSTS = ['googlevideo.com', 'ytimg.com', 'ggpht.com', 'googleusercontent.com'];

function isAllowedMediaHost(raw: string): boolean {
    try {
        const u = new URL(raw);
        if (u.protocol !== 'https:') return false;
        const h = u.hostname.toLowerCase();
        return MEDIA_HOSTS.some((d) => h === d || h.endsWith('.' + d));
    } catch {
        return false;
    }
}

function extFromMime(mime: string | null, isAudio: boolean): string {
    const m = (mime || '').toLowerCase();
    if (m.includes('webm')) return 'webm';
    if (m.includes('mp4')) return isAudio ? 'm4a' : 'mp4';
    if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
    if (m.includes('image/webp')) return 'webp';
    if (m.includes('image/png')) return 'png';
    if (m.includes('image/jpeg')) return 'jpg';
    return isAudio ? 'm4a' : 'mp4';
}

function safeName(text: string): string {
    return String(text || 'youtube')
        .replace(/[\\/:*?"<>|#]+/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 70) || 'youtube';
}

function proxyUrl(baseUrl: string, mediaUrl: string, filename: string, refresh?: string): string {
    const dl = b64urlEncode(mediaUrl);
    let out = `${baseUrl}/api/download/youtube?dl=${dl}&fn=${encodeURIComponent(filename)}`;
    if (refresh) out += `&refresh=${encodeURIComponent(refresh)}`;
    return out;
}

async function youtubePostDL(inputUrl: string, baseUrl?: string): Promise<any> {
    const startedAt = new Date().toISOString();
    const postId = extractPostId(inputUrl);
    if (!postId) throw new Error('Invalid YouTube Post URL. Could not extract post ID.');

    const html = await fetchPostHtml(postId);
    const data = await parsePostInitialData(html);
    const parsed = parsePostRenderer(data);
    if (!parsed) throw new Error('Post tidak ditemukan. Mungkin privat, terhapus, atau login-wall.');
    const { post, microformat } = parsed;

    const captionText = cleanCaption(post?.contentText?.runs?.map((r: any) => r.text).join('') || microformat?.description || '');
    const tags = extractTags(captionText);

    const authorName = post?.authorText?.runs?.[0]?.text || microformat?.title?.replace(/^Postingan dari\s+/i, '').replace(/\s*-\s*YouTube$/, '') || null;
    const channelId = post?.authorEndpoint?.browseEndpoint?.browseId || microformat?.externalId || null;
    const avatar = pickLargestThumb(post?.authorThumbnail?.thumbnails || []);
    const publishedText = post?.publishedTimeText?.runs?.map((r: any) => r.text).join('') || null;

    const likeLabel = post?.actionButtons?.commentActionButtonsRenderer?.likeButton?.toggleButtonRenderer?.accessibility?.label
        || post?.actionButtons?.commentActionButtonsRenderer?.likeButton?.toggleButtonRenderer?.accessibilityData?.accessibilityData?.label
        || null;
    const voteShort = post?.voteCount?.runs?.map((r: any) => r.text).join('') || null;
    const likeExact = parsePostExactLike(likeLabel) ?? parsePostExactLike(post?.voteCount?.accessibility?.accessibilityData?.label);
    const likeFromShort = parseVoteTextId(voteShort);
    const likeCount = likeExact ?? likeFromShort ?? null;

    const ba = post?.backstageAttachment || {};
    const images: string[] = [];
    let thumbsAll: any[] = [];
    if (ba.backstageImageRenderer?.image?.thumbnails?.length) {
        const best = pickLargestThumb(ba.backstageImageRenderer.image.thumbnails);
        thumbsAll = ba.backstageImageRenderer.image.thumbnails.map((t: any) => ({
            url: String(t.url).startsWith('//') ? 'https:' + t.url : t.url,
            width: t.width || null, height: t.height || null,
        }));
        if (best) images.push(best.url);
    } else if (ba.postMultiImageRenderer?.images?.length) {
        for (const im of ba.postMultiImageRenderer.images) {
            const th = im?.backstageImageRenderer?.image?.thumbnails;
            const best = pickLargestThumb(th || []);
            if (best) {
                images.push(best.url);
                thumbsAll.push(best);
            }
        }
    }
    if (!images.length && microformat?.thumbnail?.thumbnails?.length) {
        const best = pickLargestThumb(microformat.thumbnail.thumbnails);
        if (best) images.push(best.url);
    }

    const type = images.length > 1 ? 'slide' : images.length === 1 ? 'image' : 'text';
    const bestThumb = pickLargestThumb(thumbsAll.length ? thumbsAll : (images.map((u) => ({ url: u })))) || (images[0] ? { url: images[0], width: null, height: null } : null);

    const checks: any[] = [];
    for (const u of images) checks.push(await verifyImageUrl(u));
    const okCount = checks.filter((c) => c.ok).length;

    const imgList = images.map((u, i) => ({
        index: i + 1,
        url: u,
        proxy: baseUrl ? proxyUrl(baseUrl, u, `${safeName(microformat?.title || postId)}_${i + 1}.${checks[i]?.container || 'jpg'}`) : null,
        download: checks[i],
    }));

    return {
        success: true,
        scraped_at: startedAt,
        source_url: inputUrl,
        source_domain: safeDomain(inputUrl),
        kind: 'post',
        post_id: postId,
        type,
        title: microformat?.title || (captionText ? captionText.slice(0, 80) : null),
        caption: { text: captionText, hashtags: tags.hashtags, mentions: tags.mentions },
        author: {
            name: authorName,
            channel_id: channelId,
            channel_url: channelId ? `https://www.youtube.com/channel/${channelId}` : (post?.authorEndpoint?.browseEndpoint?.canonicalBaseUrl ? `https://www.youtube.com${post.authorEndpoint.browseEndpoint.canonicalBaseUrl}` : null),
            avatar: avatar?.url || null,
        },
        published_text: publishedText,
        url: {
            image: images[0] || null,
            images,
            image_list: imgList,
            ...(images.length > 1 ? { slides: images } : {}),
            thumbnail: bestThumb?.url || null,
        },
        stats: {
            like: likeCount,
            like_formatted: likeCount !== null ? formatNumber(likeCount) : (voteShort || null),
            like_short: voteShort,
            comment: null,
            comment_note: 'YouTube post comment count butuh continuation login-wall, belum di-fetch.',
            view: null,
            view_note: 'YouTube tidak mempublikasikan view untuk post komunitas.',
            dislike: null,
            dislike_note: 'YouTube menyembunyikan jumlah dislike (sejak Des 2021).',
            save: null,
            save_note: 'YouTube tidak mempublikasikan jumlah save/bookmark.',
        },
        verification: {
            images_checked: images.length,
            playable: okCount,
            all_ok: images.length > 0 && okCount === images.length,
            details: checks.map((c, i) => ({ url: images[i], ok: c.ok, status: c.status, content_type: c.content_type, container: c.container, error: c.error })),
        },
        links: { post: `https://www.youtube.com/post/${postId}` },
    };
}

function cleanCaption(text: any): string {
    if (!text) return '';
    return String(text).trim();
}

function extractTags(text: any): { hashtags: string[]; mentions: string[] } {
    const hashtags: string[] = [];
    const mentions: string[] = [];
    for (const m of String(text || '').matchAll(/#([\p{L}\p{N}_]{1,80})/gu)) {
        if (!hashtags.includes(m[1])) hashtags.push(m[1]);
    }
    for (const m of String(text || '').matchAll(/@([A-Za-z0-9._]{1,30})/g)) {
        if (!mentions.includes(m[1])) mentions.push(m[1]);
    }
    return { hashtags, mentions };
}

function formatNumber(num: any): string | null {
    if (num === null || num === undefined) return null;
    const n = Number(num);
    if (!Number.isFinite(n) || n <= 0) return n === 0 ? '0' : null;
    if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toString();
}

function parseCount(text: any): number | null {
    if (text === null || text === undefined) return null;
    const s = String(text).replace(/[^0-9.,KMBkm]/g, '').trim();
    if (!s) return null;
    const m = s.match(/^([\d.,]+)\s*([KMBkmb])?$/);
    if (!m) {
        const n = Number(String(text).replace(/[^\d]/g, ''));
        return Number.isFinite(n) ? n : null;
    }
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const suf = (m[2] || '').toUpperCase();
    if (suf === 'K') n *= 1e3;
    else if (suf === 'M') n *= 1e6;
    else if (suf === 'B') n *= 1e9;
    return Math.round(n);
}

function parseDuration(seconds: any): string | null {
    if (seconds === null || seconds === undefined) return null;
    const s = Number(seconds);
    if (!Number.isFinite(s)) return null;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function safeDomain(inputUrl: string): string | null {
    try { return new URL(/^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`).hostname; }
    catch { return null; }
}

const CLIENT_ID: Record<string, string> = {
    WEB: '1',
    MWEB: '2',
    ANDROID: '3',
    IOS: '5',
    TVHTML5: '7',
    ANDROID_VR: '28',
    WEB_EMBEDDED_PLAYER: '56',
    TVHTML5_SIMPLY_EMBEDDED_PLAYER: '85',
};

async function fetchPlayer(videoId: string, clientCtx: any, ua: string, embed = false): Promise<any> {
    const headers: Record<string, string> = {
        'User-Agent': ua,
        'Content-Type': 'application/json',
        Origin: 'https://www.youtube.com',
        Referer: `https://www.youtube.com/watch?v=${videoId}`,
    };
    if (CLIENT_ID[clientCtx.clientName]) {
        headers['X-Youtube-Client-Name'] = CLIENT_ID[clientCtx.clientName];
        headers['X-Youtube-Client-Version'] = clientCtx.clientVersion;
    }
    const context: any = { client: clientCtx };
    if (embed) context.thirdParty = { embedUrl: 'https://www.youtube.com/' };
    const res = await withRetry(() => axios.post(
        `https://www.youtube.com/youtubei/v1/player?key=${API_KEY}`,
        {
            context,
            videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
        },
        {
            headers,
            ...proxyConf(),
            timeout: 20000,
        }
    ));
    return res.data;
}

async function fetchYouTubePlayer(videoId: string, diag?: any[]): Promise<any> {
    const attempts = [
        { name: 'ANDROID_VR', ctx: ANDROID_VR_CTX, ua: UA_VR, embed: false },
        { name: 'ANDROID', ctx: ANDROID_CTX, ua: UA_ANDROID, embed: false },
        { name: 'IOS', ctx: IOS_CTX, ua: UA_BROWSER, embed: false },
        { name: 'TVHTML5', ctx: TVHTML5_CTX, ua: UA_TV, embed: false },
        { name: 'TV_EMBED', ctx: TV_EMBED_CTX, ua: UA_TV, embed: true },
        { name: 'WEB_EMBED', ctx: WEB_EMBED_CTX, ua: UA_BROWSER, embed: true },
        { name: 'MWEB', ctx: MWEB_CTX, ua: UA_BROWSER, embed: false },
        { name: 'WEB', ctx: WEB_CTX, ua: UA_BROWSER, embed: false },
    ];
    let metaOnly: any = null;
    for (const at of attempts) {
        try {
            const d = await fetchPlayer(videoId, at.ctx, at.ua, at.embed);
            const status = d?.playabilityStatus?.status || null;
            const reason = d?.playabilityStatus?.reason || null;
            const hasStream = Boolean(d?.streamingData?.formats?.length || d?.streamingData?.adaptiveFormats?.length);
            diag?.push({ step: 'innerTube', client: at.name, http: 200, play: status, reason, hasStream, hasVideoDetails: Boolean(d?.videoDetails) });
            if (hasStream) return { source: 'innerTube', client: at.name, data: d };
            if (d?.videoDetails && !metaOnly) metaOnly = { source: 'innerTube', client: at.name + '-meta', data: d, noStream: true };
        } catch (err: any) {
            diag?.push({ step: 'innerTube', client: at.name, error: err?.message, http: err?.response?.status || null, body: typeof err?.response?.data === 'string' ? err.response.data.slice(0, 180) : undefined });
        }
    }
    return metaOnly;
}

async function fetchYouTubeNext(videoId: string): Promise<any> {
    try {
        const res = await withRetry(() => axios.post(
            `https://www.youtube.com/youtubei/v1/next?key=${API_KEY}`,
            { context: { client: WEB_CTX }, videoId },
            {
                headers: {
                    'User-Agent': UA_BROWSER,
                    'Content-Type': 'application/json',
                    Origin: 'https://www.youtube.com',
                    Referer: `https://www.youtube.com/watch?v=${videoId}`,
                },
                ...proxyConf(),
                timeout: 20000,
            }
        ));
        return res.data;
    } catch {
        return null;
    }
}

async function fetchYouTubeEmbed(videoId: string): Promise<any> {
    try {
        const res = await withRetry(() => axios.get(`https://www.youtube.com/embed/${videoId}`, {
            headers: { 'User-Agent': UA_EMBED },
            ...proxyConf(),
            timeout: 15000,
        }));
        const html = String(res.data || '');
        const m1 = html.match(/ytInitialPlayerResponse\s*=\s*({[\s\S]*?});/);
        if (m1) {
            try { return JSON.parse(m1[1]); } catch { /* skip */ }
        }
        return null;
    } catch {
        return null;
    }
}

async function fetchFromInvidious(videoId: string): Promise<any> {
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const res = await withRetry(() => axios.get(`${instance}/api/v1/videos/${videoId}`, {
                headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json' },
                ...proxyConf(),
                timeout: 15000,
                transformResponse: [(data: any) => {
                    try { return typeof data === 'string' ? JSON.parse(data) : data; }
                    catch { return data; }
                }],
            }));
            const data = res.data;
            if (data && typeof data === 'object' && !Array.isArray(data) && data.videoId) {
                return { ...data, _instance: instance };
            }
        } catch { /* next */ }
    }
    return null;
}

async function fetchFromPiped(videoId: string): Promise<any> {
    for (const instance of PIPED_INSTANCES) {
        try {
            const res = await withRetry(() => axios.get(`${instance}/streams/${videoId}`, {
                headers: { 'User-Agent': UA_BROWSER, Accept: 'application/json' },
                ...proxyConf(),
                timeout: 15000,
                transformResponse: [(data: any) => {
                    try { return typeof data === 'string' ? JSON.parse(data) : data; }
                    catch { return data; }
                }],
            }));
            const data = res.data;
            if (data && typeof data === 'object' && !Array.isArray(data) && data.streams) {
                return { ...data, _instance: instance };
            }
        } catch { /* next */ }
    }
    return null;
}

function decodeCipher(cipher: string): { url: string | null; needsDecipher: boolean } {
    try {
        const p = new URLSearchParams(cipher);
        const url = p.get('url');
        const s = p.get('s');
        const sp = p.get('sp') || 'sig';
        if (!url) return { url: null, needsDecipher: true };
        return { url: s ? `${decodeURIComponent(url)}&${sp}=${s}` : decodeURIComponent(url), needsDecipher: Boolean(s) };
    } catch {
        return { url: null, needsDecipher: true };
    }
}

function parseFormats(streamingData: any): any[] {
    const formats: any[] = [];
    const push = (f: any, isProg: boolean) => {
        let url = f.url || null;
        let needsDecipher = false;
        if (!url && f.signatureCipher) {
            const dec = decodeCipher(f.signatureCipher);
            url = dec.url;
            needsDecipher = dec.needsDecipher;
        }
        if (!url || !f.mimeType) return;
        formats.push({
            itag: f.itag,
            url,
            needs_decipher: needsDecipher,
            mimeType: f.mimeType.split(';')[0].trim(),
            codecs: /codecs="([^"]+)"/.exec(f.mimeType)?.[1] || null,
            quality: f.qualityLabel || f.quality || null,
            bitrate: f.bitrate || null,
            width: f.width || null,
            height: f.height || null,
            fps: f.fps || null,
            contentLength: f.contentLength ? Number(f.contentLength) : null,
            approxDurationMs: f.approxDurationMs ? Number(f.approxDurationMs) : null,
            lastModified: f.lastModified || null,
            isVideo: /^video\//.test(f.mimeType),
            isAudio: /^audio\//.test(f.mimeType),
            progressive: Boolean(isProg),
        });
    };
    (streamingData?.formats || []).forEach((f: any) => push(f, true));
    (streamingData?.adaptiveFormats || []).forEach((f: any) => push(f, false));
    return formats;
}

function dedupeVideoFormats(videos: any[]): any[] {
    const byQuality = new Map<string, any>();
    const score = (x: any) => (/mp4/i.test(x.mimeType || '') ? 100 : 0)
        + (/avc1/i.test(x.codecs || '') ? 10 : 0)
        + (Number(x.bitrate) || 0) / 1e7;
    for (const f of videos) {
        const key = f.quality || (f.width && f.height ? `${f.width}x${f.height}` : null);
        if (!key) continue;
        const cur = byQuality.get(key);
        if (!cur || score(f) > score(cur)) byQuality.set(key, f);
    }
    return [...byQuality.values()].sort(
        (a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0))
    );
}

function dedupeAudioFormats(audios: any[]): any[] {
    const byItag = new Map<number, any>();
    for (const f of audios) {
        const cur = byItag.get(f.itag);
        if (!cur || (Number(f.bitrate) || 0) > (Number(cur.bitrate) || 0)) byItag.set(f.itag, f);
    }
    return [...byItag.values()].sort((a, b) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
}

function sniffContainer(buf: Buffer): string {
    if (!buf || buf.length < 4) return 'unknown';
    if (buf.length >= 12 && buf.slice(4, 8).toString('latin1') === 'ftyp') return 'mp4';
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
    if (buf.slice(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
    return 'unknown';
}

async function checkFormatUrl(url: string): Promise<any> {
    const out: any = { ok: false, status: null, content_type: null, bytes: 0, container: null, error: null };
    if (!url) { out.error = 'URL tidak tersedia'; return out; }
    try {
        const res = await axios.get(url, {
            ...proxyConf(),
            timeout: 15000,
            validateStatus: (s) => s < 500,
            responseType: 'arraybuffer',
            headers: { 'User-Agent': UA_ANDROID, Referer: 'https://www.youtube.com/', Range: 'bytes=0-2047' },
        });
        const buf = Buffer.from(res.data || []);
        out.status = res.status;
        out.content_type = res.headers['content-type'] || null;
        out.bytes = buf.length;
        out.container = sniffContainer(buf);
        out.ok = (res.status === 200 || res.status === 206) && buf.length > 0 && out.container !== 'unknown';
        if (!out.ok && !out.error) out.error = out.container === 'unknown' ? 'isi bukan file media' : `http ${res.status}`;
    } catch (err: any) {
        out.error = err.message;
    }
    return out;
}

async function checkAllUrls(items: { itag: number; url: string }[], concurrency = 5): Promise<Map<number, any>> {
    const map = new Map<number, any>();
    let i = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
        while (i < items.length) {
            const item = items[i++];
            map.set(item.itag, await checkFormatUrl(item.url));
        }
    });
    await Promise.all(workers);
    return map;
}

function findLikeNode(node: any, depth = 0): any {
    if (!node || typeof node !== 'object' || depth > 12) return null;
    if (node.segmentedLikeDislikeButtonViewModel) return node.segmentedLikeDislikeButtonViewModel;
    if (Array.isArray(node)) {
        for (const v of node) {
            const f = findLikeNode(v, depth + 1);
            if (f) return f;
        }
        return null;
    }
    for (const v of Object.values(node)) {
        if (v && typeof v === 'object') {
            const f = findLikeNode(v, depth + 1);
            if (f) return f;
        }
    }
    return null;
}

function parseLikeFromNext(nextData: any): { short: string | null; exact: number | null } {
    try {
        const seg = findLikeNode(nextData);
        const likeVm = seg?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel;
        const btn = likeVm?.defaultButtonViewModel?.buttonViewModel || likeVm?.toggledButtonViewModel?.buttonViewModel;
        const title = btn?.title || null;
        const acc = btn?.accessibilityText || '';
        const exact = /along with ([\d,]+)/.exec(acc)?.[1]?.replace(/[^\d]/g, '');
        return {
            short: typeof title === 'string' ? title : null,
            exact: exact ? Number(exact) : parseCount(title),
        };
    } catch {
        return { short: null, exact: null };
    }
}

function parseNextPrimary(nextData: any): any {
    const out: any = {};
    try {
        const contents = nextData?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
        const prim = contents.find((c: any) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer;
        if (prim) {
            out.title = prim.title?.runs?.map((r: any) => r.text).join('') || null;
            out.viewText = prim.viewCount?.videoViewCountRenderer?.viewCount?.simpleText || null;
            out.viewShort = prim.viewCount?.videoViewCountRenderer?.shortViewCount?.simpleText || null;
            out.viewCount = parseCount(out.viewText);
            out.dateText = prim.dateText?.simpleText || null;
        }
        const sec = contents.find((c: any) => c.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer;
        if (sec?.owner?.videoOwnerRenderer) {
            const o = sec.owner.videoOwnerRenderer;
            out.owner = {
                name: o.title?.runs?.[0]?.text || null,
                channelId: o.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId
                    || o.navigationEndpoint?.browseEndpoint?.browseId || null,
                channelUrl: o.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
                    ? `https://www.youtube.com${o.title.runs[0].navigationEndpoint.browseEndpoint.canonicalBaseUrl}` : null,
                avatar: o.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || null,
                subsText: o.subscriberCountText?.simpleText || null,
                subs: parseCount(o.subscriberCountText?.simpleText),
            };
        }
    } catch { /* ignore */ }
    return out;
}

function parseCommentCount(nextData: any): number | null {
    try {
        const panels = nextData?.engagementPanels || [];
        const cm = panels.find((p: any) => String(p.engagementPanelSectionListRenderer?.panelIdentifier || '').includes('comment'));
        const runs = cm?.engagementPanelSectionListRenderer?.header?.engagementPanelTitleHeaderRenderer?.contextualInfo?.runs || [];
        const txt = runs.map((r: any) => r.text).join('');
        return parseCount(txt);
    } catch {
        return null;
    }
}

export async function youtubeDL(inputUrl: string, baseUrl?: string, diag?: any[]): Promise<any> {
    if (isPostUrl(inputUrl)) return youtubePostDL(inputUrl, baseUrl);

    const startedAt = new Date().toISOString();
    const videoId = extractVideoId(inputUrl);
    if (!videoId) throw new Error('Invalid YouTube URL. Could not extract video ID. (support: watch, shorts, live, embed, music, youtu.be, post)');

    const fromMusic = isMusicSourceUrl(inputUrl);
    const cleanUrl = `https://www.youtube.com/shorts/${videoId}`;
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const embedUrl = `https://www.youtube.com/embed/${videoId}`;
    const musicUrl = `https://music.youtube.com/watch?v=${videoId}`;

    const [playerRes, nextRes] = await Promise.allSettled([
        fetchYouTubePlayer(videoId, diag),
        fetchYouTubeNext(videoId),
    ]);
    const player: any = playerRes.status === 'fulfilled' ? playerRes.value : null;
    const nextData: any = nextRes.status === 'fulfilled' ? nextRes.value : null;

    let fallback: any = null;
    if (!player) {
        const inv = await fetchFromInvidious(videoId);
        diag?.push({ step: 'fallback', source: 'invidious', ok: Boolean(inv) });
        if (inv) fallback = { source: 'invidious', data: inv };
        else {
            const pip = await fetchFromPiped(videoId);
            diag?.push({ step: 'fallback', source: 'piped', ok: Boolean(pip) });
            if (pip) fallback = { source: 'piped', data: pip };
        }
        if (!fallback) {
            const emb = await fetchYouTubeEmbed(videoId);
            diag?.push({ step: 'fallback', source: 'embed', ok: Boolean(emb?.streamingData || emb?.videoDetails) });
            if (emb?.streamingData || emb?.videoDetails) fallback = { source: 'embed', data: emb };
        }
    }
    if (!player && !fallback) {
        throw new Error('Failed to fetch video info from all sources. Video may be private, deleted, or region-locked.');
    }

    let formats: any[] = [];
    let videoDetails: any = {};
    let captions: any[] = [];
    let thumbnails: any[] = [];
    let playStatus: string | null = null;
    let playReason: string | null = null;

    if (player) {
        const d = player.data;
        playStatus = d.playabilityStatus?.status || null;
        playReason = d.playabilityStatus?.reason || null;
        videoDetails = d.videoDetails || {};
        formats = parseFormats(d.streamingData);
        thumbnails = videoDetails.thumbnail?.thumbnails || [];
        captions = d.captions?.playerCaptionsTracklistRenderer?.captionTracks?.map((c: any) => ({
            lang: c.languageCode, name: c.name?.simpleText || c.name?.runs?.[0]?.text || null,
            baseUrl: c.baseUrl, kind: c.kind || null,
        })) || [];
        if (videoDetails.shortDescription) videoDetails.description = videoDetails.shortDescription;
        if (videoDetails.channelId && !videoDetails.authorUrl) {
            videoDetails.authorUrl = `https://www.youtube.com/channel/${videoDetails.channelId}`;
        }
        if (!d.microformat) {
            try {
                const web = await fetchPlayer(videoId, WEB_CTX, UA_BROWSER);
                const mf = web?.microformat?.playerMicroformatRenderer;
                if (mf) {
                    videoDetails.uploaded = mf.publishDate || mf.uploadDate || videoDetails.uploaded || null;
                    videoDetails.category = mf.category || null;
                    videoDetails.keywords = typeof mf.keywords === 'string'
                        ? mf.keywords.split(',').map((s: string) => s.trim()).filter(Boolean)
                        : (Array.isArray(mf.keywords) ? mf.keywords : videoDetails.keywords);
                    if (!videoDetails.author && mf.ownerChannelName) videoDetails.author = mf.ownerChannelName;
                    d._likeCount = mf.likeCount ? Number(mf.likeCount) : null;
                    d._viewCount = mf.viewCount ? Number(mf.viewCount) : null;
                }
            } catch { /* ignore */ }
        } else {
            const mf = d.microformat.playerMicroformatRenderer;
            videoDetails.uploaded = mf.publishDate || mf.uploadDate || null;
            videoDetails.category = mf.category || null;
            d._likeCount = mf.likeCount ? Number(mf.likeCount) : null;
            d._viewCount = mf.viewCount ? Number(mf.viewCount) : null;
        }
        player._extraLike = d._likeCount ?? null;
        player._extraView = d._viewCount ?? null;
    } else if (fallback?.source === 'invidious') {
        const d = fallback.data;
        videoDetails = {
            videoId: d.videoId, title: d.title, author: d.author, authorId: d.authorId,
            authorUrl: d.authorUrl, lengthSeconds: d.lengthSeconds, viewCount: d.viewCount,
            description: d.description, keywords: d.keywords, allowRatings: d.allowRatings,
            isLive: d.liveNow, isShort: true,
        };
        thumbnails = (d.videoThumbnails || []).map((t: any) => ({ url: t.url, width: t.width, height: t.height }));
        formats = [];
        (d.adaptiveFormats || []).forEach((f: any) => {
            if (!f.url) return;
            formats.push({
                itag: f.itag, url: f.url, needs_decipher: false, mimeType: String(f.type || '').split(';')[0],
                codecs: null, quality: f.quality || null, bitrate: f.bitrate || null,
                width: f.width || null, height: f.height || null, fps: f.fps || null,
                contentLength: f.contentLength ? Number(f.contentLength) : null,
                isVideo: String(f.type || '').includes('video'), isAudio: String(f.type || '').includes('audio'),
            });
        });
    } else if (fallback?.source === 'piped') {
        const d = fallback.data;
        videoDetails = {
            videoId: d.id || videoId, title: d.title, author: d.uploader, authorId: d.uploaderId,
            authorUrl: d.uploaderUrl, lengthSeconds: d.duration, viewCount: d.views,
            description: d.description, uploaded: d.uploaded, isShort: true,
        };
        thumbnails = d.thumbnails || [];
    } else if (fallback?.source === 'embed') {
        videoDetails = fallback.data.videoDetails || {};
        formats = parseFormats(fallback.data.streamingData);
        thumbnails = videoDetails.thumbnail?.thumbnails || [];
    }

    const prim = nextData ? parseNextPrimary(nextData) : {};
    const likeInfo = nextData ? parseLikeFromNext(nextData) : { short: null, exact: null };
    const commentCount = nextData ? parseCommentCount(nextData) : null;

    const likeCount = likeInfo.exact ?? player?._extraLike ?? (Number(videoDetails.likeCount || 0) || null);
    const viewCount = Number(videoDetails.viewCount || 0)
        || prim.viewCount
        || player?._extraView
        || null;

    const authorName = videoDetails.author || prim.owner?.name || null;
    const channelId = videoDetails.channelId || videoDetails.authorId || prim.owner?.channelId || null;

    const description = videoDetails.description || '';
    const captionText = cleanCaption(description) || cleanCaption(videoDetails.title || prim.title || '');
    const captionSource = cleanCaption(description) ? 'description' : 'title';
    const tags = extractTags(`${videoDetails.title || ''}\n${description}`);

    const progressiveList = formats.filter((f) => f.isVideo && f.progressive);
    const progressive = progressiveList.find((f) => /mp4/i.test(f.mimeType || ''))
        || [...progressiveList].sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))[0]
        || null;

    const videos = dedupeVideoFormats(formats.filter((f) => f.isVideo && !f.progressive));
    const audios = dedupeAudioFormats(formats.filter((f) => f.isAudio));

    const bestThumb = thumbnails.filter((t) => t.url)
        .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];

    const toCheck = [
        ...(progressive ? [{ itag: progressive.itag, url: progressive.url }] : []),
        ...videos.map((f) => ({ itag: f.itag, url: f.url })),
        ...audios.map((f) => ({ itag: f.itag, url: f.url })),
    ];
    const checkMap = await checkAllUrls(toCheck, 5);
    const dl = (itag: number) => checkMap.get(itag) || { ok: false, status: null, content_type: null, bytes: 0, container: null, error: 'tidak dicek' };

    const title = videoDetails.title || prim.title || null;
    const safeTitle = safeName(title || videoId);

    const withProxy = (check: any, f: any, isAudio: boolean) => {
        if (!baseUrl || !f?.url) return check;
        const ext = extFromMime(f.mimeType, isAudio);
        const tag = (!isAudio && f.quality) ? `_${String(f.quality).replace(/\s+/g, '')}` : `_${f.itag}`;
        return { ...check, proxy: proxyUrl(baseUrl, f.url, `${safeTitle}${tag}.${ext}`, videoId) };
    };

    const fmtVideo = (f: any) => ({
        itag: f.itag,
        quality: f.quality,
        resolution: f.width && f.height ? `${f.width}x${f.height}` : null,
        mime: f.mimeType,
        codec: f.codecs,
        fps: f.fps ?? null,
        bitrate: f.bitrate ?? null,
        size: f.contentLength ?? null,
        url: f.url,
        download: withProxy(dl(f.itag), f, false),
    });
    const fmtAudio = (f: any) => ({
        itag: f.itag,
        mime: f.mimeType,
        codec: f.codecs,
        bitrate: f.bitrate ?? null,
        size: f.contentLength ?? null,
        url: f.url,
        download: withProxy(dl(f.itag), f, true),
    });

    const allChecks = [...checkMap.values()];
    const okCount = allChecks.filter((c) => c.ok).length;

    const durationSec = videoDetails.lengthSeconds ? Number(videoDetails.lengthSeconds) : null;
    const category = videoDetails.category || null;
    const isMusic = fromMusic || category === 'Music';
    const type = /\/shorts\//i.test(inputUrl) ? 'short'
        : isMusic ? 'music'
        : (durationSec !== null && durationSec > 182 ? 'video' : 'short');

    const findAudio = (itag: number) => audios.find((a) => Number(a.itag) === Number(itag)) || null;
    const musicBest = findAudio(140) || findAudio(251) || audios[0] || null;
    const musicHigh = findAudio(251) || findAudio(140) || audios[0] || null;

    return {
        success: true,
        scraped_at: startedAt,
        source_url: inputUrl,
        source_domain: safeDomain(inputUrl),
        kind: 'video',
        is_music_source: fromMusic,
        video_id: videoId,
        type,
        title,
        duration_seconds: durationSec,
        duration: durationSec !== null ? parseDuration(durationSec) : null,
        published_at: videoDetails.uploaded || null,
        category,
        playability: { status: playStatus, reason: playReason },
        links: { watch: watchUrl, shorts: cleanUrl, embed: embedUrl, music: musicUrl },
        music: musicBest ? {
            title,
            artist: authorName,
            duration_seconds: durationSec,
            best_m4a: musicBest ? fmtAudio(musicBest) : null,
            best_quality: musicHigh ? fmtAudio(musicHigh) : null,
            note: 'best_m4a (itag 140) paling kompatibel (MP4/AAC). best_quality (itag 251 opus) kualitas tertinggi.',
        } : null,
        video: {
            progressive: progressive ? fmtVideo(progressive) : null,
            adaptive: videos.map(fmtVideo),
        },
        audio: audios.map(fmtAudio),
        thumbnail: bestThumb ? { url: bestThumb.url, width: bestThumb.width, height: bestThumb.height } : null,
        caption: {
            text: captionText, source: captionSource,
            hashtags: tags.hashtags, mentions: tags.mentions,
        },
        author: {
            name: authorName,
            channel_id: channelId,
            channel_url: channelId ? `https://www.youtube.com/channel/${channelId}` : (videoDetails.authorUrl || prim.owner?.channelUrl || null),
            handle_url: prim.owner?.channelUrl || null,
            avatar: prim.owner?.avatar || null,
            subscribers_text: prim.owner?.subsText || null,
            subscribers: prim.owner?.subs ?? null,
        },
        stats: {
            view: viewCount || null,
            view_formatted: viewCount ? formatNumber(viewCount) : null,
            like: likeCount || null,
            like_formatted: likeCount ? formatNumber(likeCount) : null,
            comment: commentCount,
            comment_formatted: commentCount !== null ? formatNumber(commentCount) : null,
            dislike: null,
            dislike_note: 'YouTube menyembunyikan jumlah dislike (sejak Des 2021).',
            save: null,
            save_note: 'YouTube tidak mempublikasikan jumlah save/bookmark.',
        },
        subtitle: captions[0] ? { language: captions[0].lang, name: captions[0].name, url: captions[0].baseUrl } : null,
        verification: {
            checked: toCheck.length,
            playable: okCount,
            all_ok: toCheck.length > 0 && okCount === toCheck.length,
            cdn_expires_in_seconds: player?.data?.streamingData?.expiresInSeconds
                ? Number(player.data.streamingData.expiresInSeconds) : null,
        },
    };
}

// ---------- proxy stream (inject header otomatis) ----------

async function proxyMedia(req: Request, res: Response): Promise<void> {
    const dlParam = String(req.query.dl || '');
    const filename = String(req.query.fn || 'youtube.bin');
    const refresh = req.query.refresh ? String(req.query.refresh) : null;

    let mediaUrl: string;
    try {
        mediaUrl = b64urlDecode(dlParam);
    } catch {
        res.status(400).json({ status: false, creator: 'IkyyKzy', message: 'Parameter dl tidak valid' });
        return;
    }

    if (!isAllowedMediaHost(mediaUrl)) {
        res.status(400).json({ status: false, creator: 'IkyyKzy', message: 'Host media tidak diizinkan' });
        return;
    }

    const range = req.headers.range;
    const headers: Record<string, string> = {
        'User-Agent': UA_ANDROID,
        Referer: 'https://www.youtube.com/',
        Origin: 'https://www.youtube.com',
    };
    if (range) headers.Range = String(range);

    const upstream = await axios.get(mediaUrl, {
        responseType: 'stream',
        ...proxyConf(),
        timeout: 30000,
        decompress: false,
        validateStatus: (s) => s < 400,
        maxRedirects: 5,
        headers,
    });

    const h: any = upstream.headers || {};
    if (h['content-type']) res.setHeader('Content-Type', String(h['content-type']));
    if (h['content-length']) res.setHeader('Content-Length', String(h['content-length']));
    if (h['content-range']) res.setHeader('Content-Range', String(h['content-range']));
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/["\\]/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store');
    void refresh;

    res.status(upstream.status);
    upstream.data.on('error', () => { try { res.end(); } catch { /* noop */ } });
    upstream.data.pipe(res);
}

// ---------- handler ----------

export default async function youtubeHandler(req: Request, res: Response) {
    const hasDl = req.query.dl !== undefined && req.query.dl !== '';
    const diag: any[] = [];

    try {
        if (hasDl) {
            await proxyMedia(req, res);
            return;
        }

        const url = String(req.query.url || (req.body as any)?.url || '').trim();
        if (!url) {
            return res.status(400).json({
                status: false,
                message: "Parameter 'url' is required (YouTube URL: watch/shorts/live/embed/music/youtu.be/post)",
            });
        }

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const result = await youtubeDL(url, baseUrl, diag);
        if (req.query.debug) result.debug = diag;
        return res.json(result);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Internal Server Error';
        const bad = /invalid|tidak ditemukan|could not extract|required/i.test(message);
        return res.status(bad ? 400 : 500).json({
            status: false, message,
            ...(req.query.debug ? { debug: diag } : {}),
        });
    }
}
